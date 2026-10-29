import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export type TerminalResult = { ok: true; output: string } | { ok: false; error: string };
export type CommandProposal = { id: string; command: string; cwd: string; timeoutMs: number };
const ALLOWED = new Set(["bun", "npm", "pnpm", "yarn", "node", "git", "python", "python3", "py", "pytest", "cargo", "go", "dotnet"]);
const BLOCKED_ARGS = /(?:^|\s)(?:--force|--hard|clean\s+-[a-z]*f|rm\s+-rf|rmdir\s+\/s|format\s+[a-z]:|shutdown|restart-computer|remove-item\s+.*-recurse|del\s+\/s)(?:\s|$)/i;
const MAX_OUTPUT = 24_000;

function parseCommand(input: string): { executable: string; args: string[] } | string {
  if (!input.trim()) return "Provide a command to preview.";
  if (input.length > 1000) return "Command is too long (maximum 1000 characters).";
  if (/[\n\r\0;&|<>`]/.test(input) || input.includes("$(") || input.includes("${")) return "Shell operators, redirection, multiline commands, and command substitution are blocked. Propose one executable plus arguments.";
  if (((input.match(/"/g) ?? []).length % 2) !== 0 || ((input.match(/'/g) ?? []).length % 2) !== 0) return "Unclosed quote. Close all quotes and preview the command again.";
  const tokens: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s"']+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["\\])/g, "$1"));
  if (!tokens.length) return "Provide a command to preview.";
  const executable = tokens[0].replace(/\.exe$/i, "").toLowerCase();
  if (!ALLOWED.has(executable)) return `Executable '${tokens[0]}' is not allowed. Allowed programs: ${[...ALLOWED].join(", ")}.`;
  if (["bun", "node", "python", "python3", "py"].includes(executable) && tokens.slice(1).some((arg) => ["-e", "--eval", "-c"].includes(arg))) return "Inline code execution flags are blocked. Use a reviewed project script or test command instead.";
  if (BLOCKED_ARGS.test(tokens.slice(1).join(" "))) return "This command matches a blocked destructive pattern.";
  return { executable, args: tokens.slice(1) };
}

export class ApprovedTerminal {
  readonly root: string;
  private pending = new Map<string, { proposal: CommandProposal; executable: string; args: string[] }>();
  constructor(root: string) { this.root = root; }

  async propose(command: string, cwd = ".", timeoutMs = 120_000): Promise<{ ok: true; proposal: CommandProposal } | { ok: false; error: string }> {
    const parsed = parseCommand(command);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    const candidateCwd = resolve(this.root, cwd || ".");
    let absoluteCwd: string;
    try {
      absoluteCwd = await realpath(candidateCwd);
      if (!(await stat(absoluteCwd)).isDirectory()) return { ok: false, error: "Working directory must be an existing directory." };
    } catch { return { ok: false, error: "Working directory does not exist or cannot be accessed." }; }
    const rel = relative(this.root, absoluteCwd);
    if (rel === ".." || rel.startsWith(`..${sep}`) || requireAbsolute(rel)) return { ok: false, error: "Working directory must remain inside the configured workspace." };
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) return { ok: false, error: "Timeout must be between 1000 and 120000 milliseconds." };
    const id = randomUUID().slice(0, 8);
    const proposal = { id, command: command.trim(), cwd: rel || ".", timeoutMs };
    this.pending.set(id, { proposal, executable: parsed.executable, args: parsed.args });
    return { ok: true, proposal };
  }

  reject(id: string): boolean { return this.pending.delete(id); }

  async runApproved(id: string): Promise<TerminalResult> {
    const item = this.pending.get(id);
    if (!item) return { ok: false, error: "No pending command with that ID. Preview a command first." };
    this.pending.delete(id); // single-use approval
    const cwd = resolve(this.root, item.proposal.cwd);
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTHORIZATION|PRIVATE[_-]?KEY)/i.test(key)));
      child = Bun.spawn([item.executable, ...item.args], { cwd, stdout: "pipe", stderr: "pipe", env: safeEnv });
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => { child?.kill(); reject(new Error(`Command timed out after ${item.proposal.timeoutMs} ms.`)); }, item.proposal.timeoutMs); });
      let result: number;
      try { result = await Promise.race([child.exited, timeout]); } finally { if (timeoutHandle) clearTimeout(timeoutHandle); }
      const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      const combined = `${stdout}${stderr ? `${stdout ? "\n" : ""}[stderr]\n${stderr}` : ""}`.slice(0, MAX_OUTPUT);
      return result === 0
        ? { ok: true, output: `Command succeeded (exit 0): ${item.proposal.command}\nWorking directory: ${item.proposal.cwd}\n\n${combined || "(no output)"}` }
        : { ok: false, error: `Command failed (exit ${result}): ${item.proposal.command}\nWorking directory: ${item.proposal.cwd}\n\n${combined || "(no output)"}` };
    } catch (error) {
      try { child?.kill(); } catch { /* process already exited */ }
      return { ok: false, error: error instanceof Error ? error.message : "Command execution failed." };
    }
  }
}
function requireAbsolute(path: string): boolean { return path.startsWith("/") || /^[A-Za-z]:/.test(path); }
