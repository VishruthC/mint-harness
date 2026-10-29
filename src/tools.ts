import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

export type ToolResult = { ok: true; output: string } | { ok: false; error: string };
export type WorkspaceEntry = { name: string; type: "file" | "directory"; size?: number };
export type WriteProposal = { id: string; path: string; preview: string };
type PendingWrite = { id: string; path: string; absolutePath: string; content: string; originalHash: string | null };

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage", ".mint"]);
const SENSITIVE_NAMES = new Set([".env", ".env.local", ".env.production", ".env.development", "id_rsa", "id_ed25519"]);
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".md", ".mdx", ".txt",
  ".html", ".css", ".scss", ".sass", ".less", ".py", ".pyi", ".go", ".rs", ".java", ".kt",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".sh", ".bash", ".zsh", ".fish",
  ".yaml", ".yml", ".toml", ".xml", ".sql", ".graphql", ".gql", ".vue", ".svelte", ".astro",
  ".dockerfile", ".gitignore", ".editorconfig", ".example", ".conf", ".ini", ".properties",
]);
const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_FILES = 1500;
const MAX_SEARCH_MATCHES = 100;
const MAX_DIFF_LINES = 240;
const PROJECT_MARKERS = ["package.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json", "Gemfile", "Makefile", "Dockerfile"];
const DOC_MARKERS = ["README.md", "README", "readme.md", "AGENTS.md", "CONTRIBUTING.md"];

function isSensitive(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_NAMES.has(lower) || lower.startsWith(".env.") || lower.endsWith(".pem") || lower.endsWith(".key");
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function makePreview(path: string, oldContent: string | null, newContent: string): string {
  const oldLines = (oldContent ?? "").replace(/\r\n/g, "\n").split("\n");
  const newLines = newContent.replace(/\r\n/g, "\n").split("\n");
  const lines = [`--- ${oldContent === null ? "/dev/null" : `a/${path}`}`, `+++ b/${path}`, "@@ proposed full-file replacement @@"];
  if (oldContent !== null) lines.push(...oldLines.map((line) => `-${line}`));
  lines.push(...newLines.map((line) => `+${line}`));
  const visible = lines.slice(0, MAX_DIFF_LINES);
  if (lines.length > MAX_DIFF_LINES) visible.push(`… preview truncated (${lines.length - MAX_DIFF_LINES} additional lines)`);
  return visible.join("\n");
}

export class WorkspaceTools {
  readonly root: string;
  private pendingWrites = new Map<string, PendingWrite>();
  private gitignoreCache: { mtimeMs: number; rules: string[] } | undefined;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(root = process.env.MINT_WORKSPACE || process.cwd()): Promise<WorkspaceTools> {
    const canonicalRoot = await realpath(resolve(root));
    const info = await stat(canonicalRoot);
    if (!info.isDirectory()) throw new Error("MINT workspace must be a directory.");
    return new WorkspaceTools(canonicalRoot);
  }

  private async resolveExisting(userPath = "."): Promise<string> {
    if (userPath.includes("\0")) throw new Error("Invalid path.");
    const candidate = resolve(this.root, userPath || ".");
    if (!insideRoot(this.root, candidate)) throw new Error("Path is outside the MINT workspace.");
    const canonical = await realpath(candidate);
    if (!insideRoot(this.root, canonical)) throw new Error("Symlink target is outside the MINT workspace.");
    return canonical;
  }

  private displayPath(absolutePath: string): string {
    const rel = relative(this.root, absolutePath);
    return (rel || ".").replace(/\\/g, "/").split(sep).join("/");
  }

  private async ignoreRules(): Promise<string[]> {
    try {
      const info = await stat(resolve(this.root, ".gitignore"));
      if (this.gitignoreCache?.mtimeMs === info.mtimeMs) return this.gitignoreCache.rules;
      const rules = (await readFile(resolve(this.root, ".gitignore"), "utf8"))
        .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
      this.gitignoreCache = { mtimeMs: info.mtimeMs, rules };
      return rules;
    } catch { return []; }
  }

  private async isIgnored(path: string, isDirectory = false): Promise<boolean> {
    const rel = relative(this.root, path).replace(/\\/g, "/").split(sep).join("/");
    if (!rel || rel === ".." || rel.startsWith("../")) return true;
    if (rel.split("/").some((part) => IGNORED_DIRS.has(part) || isSensitive(part))) return true;
    const rules = await this.ignoreRules();
    let ignored = false;
    for (let raw of rules) {
      const negated = raw.startsWith("!");
      if (negated) raw = raw.slice(1);
      const anchored = raw.startsWith("/");
      const directoryOnly = raw.endsWith("/");
      raw = raw.replace(/^\//, "").replace(/\/$/, "");
      const escaped = raw.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§DOUBLESTAR§").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/§DOUBLESTAR§/g, ".*");
      const pattern = anchored || raw.includes("/") ? `^${escaped}(?:/.*)?$` : `(?:^|/)${escaped}(?:/.*)?$`;
      const matches = new RegExp(pattern).test(rel) && (!directoryOnly || isDirectory || rel.includes("/"));
      if (matches) ignored = !negated;
    }
    return ignored;
  }

  async projectContext(): Promise<ToolResult> {
    const found: string[] = [];
    for (const name of [...DOC_MARKERS, ...PROJECT_MARKERS, ".gitignore"]) {
      try {
        const file = resolve(this.root, name);
        const info = await lstat(file);
        if (!info.isFile() || info.size > 24 * 1024 || isSensitive(name)) continue;
        const content = await readFile(file, "utf8");
        if (content.includes("\0")) continue;
        found.push(`--- ${name} ---\n${content.slice(0, 6000)}`);
      } catch { /* optional project marker */ }
    }
    const packageText = found.find((part) => part.startsWith("--- package.json ---"));
    let projectType = "Unknown / no common manifest found";
    if (packageText) {
      try {
        const pkg = JSON.parse(packageText.slice(packageText.indexOf("\n") + 1));
        projectType = `Node.js project${pkg.name ? ` (${pkg.name})` : ""}; package manager inferred from lockfile when present`;
      } catch { projectType = "Node.js project (package.json found but could not parse)"; }
    } else if (found.some((x) => x.startsWith("--- pyproject.toml ---") || x.startsWith("--- requirements.txt ---"))) projectType = "Python project";
    else if (found.some((x) => x.startsWith("--- Cargo.toml ---"))) projectType = "Rust project";
    else if (found.some((x) => x.startsWith("--- go.mod ---"))) projectType = "Go project";
    else if (found.some((x) => x.startsWith("--- build.gradle") || x.startsWith("--- pom.xml ---"))) projectType = "Java/JVM project";
    return { ok: true, output: `Workspace: ${this.root}\nDetected project: ${projectType}\nDiscovered ${found.length} project documents/manifests.\n\n${found.join("\n\n") || "No common project documentation or manifests found."}` };
  }

  async proposePatch(path: string, edits: Array<{ find: string; replace: string }>): Promise<{ ok: true; proposal: WriteProposal } | { ok: false; error: string }> {
    if (!Array.isArray(edits) || edits.length < 1 || edits.length > 50) return { ok: false, error: "Provide between 1 and 50 targeted edits." };
    const current = await this.read(path);
    if (!current.ok) return current;
    const marker = `--- ${this.displayPath(resolve(this.root, path.trim()))} ---\n`;
    const original = current.output.startsWith(marker) ? current.output.slice(marker.length) : current.output.slice(current.output.indexOf("\n") + 1);
    let updated = original;
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (!edit || typeof edit.find !== "string" || !edit.find || typeof edit.replace !== "string") return { ok: false, error: `Edit ${i + 1} needs non-empty find text and string replacement.` };
      const first = updated.indexOf(edit.find);
      if (first < 0) return { ok: false, error: `Edit ${i + 1}: exact find text was not found; no proposal created.` };
      if (updated.indexOf(edit.find, first + edit.find.length) >= 0) return { ok: false, error: `Edit ${i + 1}: find text matches more than once. Add more surrounding context so the patch is unambiguous.` };
      updated = updated.slice(0, first) + edit.replace + updated.slice(first + edit.find.length);
    }
    const proposal = await this.proposeWrite(path, updated);
    if (!proposal.ok) return proposal;
    const targetedPreview = edits.map((edit, index) => [
      `@@ targeted edit ${index + 1} @@`,
      ...edit.find.split("\n").map((line) => `-${line}`),
      ...edit.replace.split("\n").map((line) => `+${line}`),
    ].join("\n")).join("\n");
    return { ok: true, proposal: { ...proposal.proposal, preview: `${proposal.proposal.path}\n\n${targetedPreview}\n\nOnly these exact-text regions are targeted. The final file is staged atomically after /apply.` } };
  }

  async list(path = "."): Promise<ToolResult> {
    try {
      const directory = await this.resolveExisting(path);
      const info = await stat(directory);
      if (!info.isDirectory()) return { ok: false, error: `Not a directory: ${path}` };
      const children = await readdir(directory, { withFileTypes: true });
      const entries: WorkspaceEntry[] = [];
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = resolve(directory, child.name);
        if (await this.isIgnored(fullPath, child.isDirectory())) continue;
        try {
          const canonical = await realpath(fullPath);
          if (!insideRoot(this.root, canonical)) continue;
          if (child.isDirectory()) entries.push({ name: child.name, type: "directory" });
          else if (child.isFile()) {
            const fileInfo = await stat(canonical);
            entries.push({ name: child.name, type: "file", size: fileInfo.size });
          }
        } catch {
          // Ignore entries that disappear or cannot be resolved during listing.
        }
      }
      const output = entries.slice(0, 200).map((entry) =>
        `${entry.type === "directory" ? "dir " : "file"}  ${entry.name}${entry.type === "file" ? ` (${entry.size} bytes)` : "/"}`,
      );
      if (entries.length > 200) output.push(`… ${entries.length - 200} more entries omitted`);
      return { ok: true, output: `${this.displayPath(directory)}\n${output.join("\n") || "(empty directory)"}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not list directory." };
    }
  }

  async read(path: string): Promise<ToolResult> {
    try {
      if (!path.trim()) return { ok: false, error: "Usage: /read <relative-path>" };
      if (isSensitive(path.split(/[\\/]/).pop() ?? path)) return { ok: false, error: "Refusing to read a sensitive file." };
      const filePath = await this.resolveExisting(path);
      const info = await stat(filePath);
      if (!info.isFile()) return { ok: false, error: "The requested path is not a file." };
      if (info.size > MAX_READ_BYTES) return { ok: false, error: `File is ${info.size} bytes; the read limit is ${MAX_READ_BYTES} bytes.` };
      const content = await readFile(filePath, "utf8");
      if (content.includes("\0")) return { ok: false, error: "Refusing to display a binary file." };
      return { ok: true, output: `--- ${this.displayPath(filePath)} ---\n${content}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not read file." };
    }
  }

  async proposeWrite(path: string, content: string): Promise<{ ok: true; proposal: WriteProposal } | { ok: false; error: string }> {
    try {
      const requested = path.trim();
      if (!requested) return { ok: false, error: "Usage: /propose <relative-path>, then enter the full file contents." };
      if (requested.includes("\0")) return { ok: false, error: "Invalid path." };
      const target = resolve(this.root, requested);
      if (!insideRoot(this.root, target)) return { ok: false, error: "Path is outside the MINT workspace." };
      const name = basename(target);
      if (isSensitive(name)) return { ok: false, error: "Refusing to write a sensitive file." };
      if (!this.isTextFile(name)) return { ok: false, error: "Only recognized text-file types can be edited in this phase." };
      if (content.includes("\0")) return { ok: false, error: "Refusing to write content containing binary NUL bytes." };
      if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) return { ok: false, error: `Content exceeds the ${MAX_WRITE_BYTES}-byte write limit.` };

      const parentPath = dirname(target);
      const canonicalParent = await this.resolveExisting(this.displayPath(parentPath));
      const safeTarget = resolve(canonicalParent, name);
      if (!insideRoot(this.root, safeTarget)) return { ok: false, error: "Target is outside the MINT workspace." };

      let originalContent: string | null = null;
      let originalHash: string | null = null;
      try {
        const info = await lstat(safeTarget);
        if (info.isSymbolicLink()) return { ok: false, error: "Refusing to replace a symbolic link." };
        if (!info.isFile()) return { ok: false, error: "Target exists but is not a regular file." };
        if (info.size > MAX_WRITE_BYTES) return { ok: false, error: `Existing file exceeds the ${MAX_WRITE_BYTES}-byte edit limit.` };
        originalContent = await readFile(safeTarget, "utf8");
        if (originalContent.includes("\0")) return { ok: false, error: "Refusing to replace a binary file." };
        originalHash = hash(originalContent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }

      const id = randomUUID().slice(0, 8);
      const display = this.displayPath(safeTarget);
      const proposal: PendingWrite = { id, path: display, absolutePath: safeTarget, content, originalHash };
      this.pendingWrites.set(id, proposal);
      return { ok: true, proposal: { id, path: display, preview: makePreview(display, originalContent, content) } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not prepare file change." };
    }
  }

  async applyWrite(id: string): Promise<ToolResult> {
    const proposal = this.pendingWrites.get(id);
    if (!proposal) return { ok: false, error: "No pending proposal with that ID. Create a new proposal first." };
    const temporaryPath = resolve(dirname(proposal.absolutePath), `.mint-${proposal.id}.tmp`);
    try {
      const canonicalParent = await this.resolveExisting(this.displayPath(dirname(proposal.absolutePath)));
      if (canonicalParent !== dirname(proposal.absolutePath)) return { ok: false, error: "Target directory changed since the proposal was created." };
      if (!insideRoot(this.root, proposal.absolutePath)) return { ok: false, error: "Target is outside the MINT workspace." };

      let currentHash: string | null = null;
      try {
        const info = await lstat(proposal.absolutePath);
        if (info.isSymbolicLink() || !info.isFile()) return { ok: false, error: "Target changed type; proposal was not applied." };
        const current = await readFile(proposal.absolutePath, "utf8");
        currentHash = hash(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (currentHash !== proposal.originalHash) return { ok: false, error: "File changed since the preview. Proposal was not applied; create a fresh preview." };

      await writeFile(temporaryPath, proposal.content, { encoding: "utf8", flag: "wx" });
      // Preserve existing mode bits (including executable bit) when replacing a file.
      try {
        const existingStat = await lstat(proposal.absolutePath);
        if (existingStat.isFile() && !existingStat.isSymbolicLink()) await chmod(temporaryPath, existingStat.mode & 0o777);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      // Re-check the target after writing the temporary file to reduce stale-write risk.
      let checkHash: string | null = null;
      try {
        const info = await lstat(proposal.absolutePath);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("Target changed type during approval.");
        checkHash = hash(await readFile(proposal.absolutePath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (checkHash !== proposal.originalHash) throw new Error("File changed during approval. Temporary change discarded.");
      await rename(temporaryPath, proposal.absolutePath);
      this.pendingWrites.delete(id);
      return { ok: true, output: `Applied approved change to ${proposal.path}.` };
    } catch (error) {
      try { await unlink(temporaryPath); } catch { /* Temporary file may not exist. */ }
      return { ok: false, error: error instanceof Error ? error.message : "Could not apply approved change." };
    }
  }

  rejectWrite(id: string): ToolResult {
    if (!this.pendingWrites.delete(id)) return { ok: false, error: "No pending proposal with that ID." };
    return { ok: true, output: `Rejected proposal ${id}; no file was changed.` };
  }

  async search(query: string): Promise<ToolResult> {
    const needle = query.trim();
    if (!needle) return { ok: false, error: "Usage: /search <text>" };
    if (needle.length > 200) return { ok: false, error: "Search query must be 200 characters or fewer." };
    const matches: string[] = [];
    let scanned = 0;
    let truncated = false;

    const walk = async (directory: string): Promise<void> => {
      if (truncated) return;
      let children;
      try { children = await readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const child of children) {
        if (truncated) return;
        const fullPath = resolve(directory, child.name);
        if (await this.isIgnored(fullPath, child.isDirectory())) continue;
        let canonical: string;
        try {
          canonical = await realpath(fullPath);
          if (!insideRoot(this.root, canonical)) continue;
        } catch { continue; }
        if (child.isDirectory()) {
          await walk(canonical);
          continue;
        }
        if (!child.isFile() || !this.isTextFile(child.name)) continue;
        let info;
        try { info = await stat(canonical); } catch { continue; }
        if (info.size > MAX_SEARCH_FILE_BYTES) continue;
        scanned++;
        if (scanned > MAX_SEARCH_FILES) { truncated = true; return; }
        let content: string;
        try { content = await readFile(canonical, "utf8"); } catch { continue; }
        if (content.includes("\0")) continue;
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          if (lines[index].toLowerCase().includes(needle.toLowerCase())) {
            matches.push(`${this.displayPath(canonical)}:${index + 1}: ${lines[index].trim().slice(0, 240)}`);
            if (matches.length >= MAX_SEARCH_MATCHES) { truncated = true; return; }
          }
        }
      }
    };

    await walk(this.root);
    const suffix = truncated ? `\n(search capped at ${MAX_SEARCH_FILES} files or ${MAX_SEARCH_MATCHES} matches)` : "";
    return { ok: true, output: `Workspace: ${this.root}\nQuery: ${needle}\n${matches.join("\n") || "No matches found."}${suffix}` };
  }

  private isTextFile(name: string): boolean {
    if (isSensitive(name)) return false;
    const lower = name.toLowerCase();
    return TEXT_EXTENSIONS.has(extname(lower)) || ["dockerfile", "makefile", ".gitignore", ".editorconfig"].includes(lower);
  }
}
