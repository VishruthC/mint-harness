import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PermissionRule = {
  scopeKey: string;
  kind: "command" | "file";
  createdAt: string;
};

function defaultPermissionsPath() {
  const root = process.env.MINT_DATA_DIR || join(homedir(), ".mint");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return join(root, "permissions.json");
}

function normalizeRules(raw: unknown): PermissionRule[] {
  if (!Array.isArray(raw)) return [];
  const out: PermissionRule[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const scopeKey = typeof record.scopeKey === "string" ? record.scopeKey : "";
    const kind = record.kind === "command" || record.kind === "file" ? record.kind : null;
    if (!scopeKey || !kind || seen.has(scopeKey)) continue;
    seen.add(scopeKey);
    out.push({
      scopeKey,
      kind,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

export class PermissionStore {
  private path: string;
  private rules: PermissionRule[];
  private allowed = new Set<string>();

  constructor(path = defaultPermissionsPath()) {
    this.path = path;
    this.rules = this.load();
    this.allowed = new Set(this.rules.map((rule) => rule.scopeKey));
  }

  private load(): PermissionRule[] {
    try {
      if (!existsSync(this.path)) return [];
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return normalizeRules(parsed);
    } catch {
      return [];
    }
  }

  private save(): void {
    const payload = JSON.stringify(this.rules, null, 2) + "\n";
    const tmp = `${this.path}.tmp.${crypto.randomUUID()}`;
    writeFileSync(tmp, payload, "utf8");
    try {
      renameSync(tmp, this.path);
    } catch {
      writeFileSync(this.path, payload, "utf8");
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* ignore */
    }
  }

  isAllowed(scopeKey: string): boolean {
    return this.allowed.has(scopeKey);
  }

  allow(scopeKey: string, kind: "command" | "file"): void {
    if (!scopeKey || this.allowed.has(scopeKey)) return;
    this.rules.push({ scopeKey, kind, createdAt: new Date().toISOString() });
    this.allowed.add(scopeKey);
    this.save();
  }

  list(): PermissionRule[] {
    return [...this.rules];
  }
}
