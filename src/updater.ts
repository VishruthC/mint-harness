/**
 * MINT update checking and self-update support.
 *
 * This module is intentionally UI-agnostic so the registry, semver, persistence,
 * and process behavior can be tested without starting the terminal UI. MINT's
 * TUI only formats the results and asks the existing approval queue for consent.
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PACKAGE_NAME = "mint-harness";
export const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
export const UPDATE_COMMAND = `npm install -g ${PACKAGE_NAME}@latest`;
export const UPDATE_INSTALL_ARGS = ["install", "-g", `${PACKAGE_NAME}@latest`] as const;

export const DEFAULT_REGISTRY_TIMEOUT_MS = 4_000;
export const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
export const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
export const DEFAULT_RECHECK_COOLDOWN_MS = 15_000;
export const MAX_INSTALL_OUTPUT = 12_000;

// ---------------------------------------------------------------------------
// Semver
// ---------------------------------------------------------------------------

export type Semver = {
  major: number;
  minor: number;
  patch: number;
  /** Empty for stable releases. Numeric identifiers are stored as numbers. */
  prerelease: Array<string | number>;
};

const SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC_IDENTIFIER = /^\d+$/;

function parseCore(value: string): number | null {
  if (value.length > 1 && value.startsWith("0")) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Parse a semver string. Returns null for invalid or unsafe versions. */
export function parseVersion(value: string): Semver | null {
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  const major = parseCore(match[1]);
  const minor = parseCore(match[2]);
  const patch = parseCore(match[3]);
  if (major === null || minor === null || patch === null) return null;

  const prerelease: Array<string | number> = [];
  if (match[4]) {
    for (const identifier of match[4].split(".")) {
      if (NUMERIC_IDENTIFIER.test(identifier)) {
        if (identifier.length > 1 && identifier.startsWith("0")) return null;
        const numeric = Number(identifier);
        if (!Number.isSafeInteger(numeric)) return null;
        prerelease.push(numeric);
      } else {
        prerelease.push(identifier);
      }
    }
  }

  return { major, minor, patch, prerelease };
}

function compareIdentifier(left: string | number, right: string | number): number {
  const leftNumeric = typeof left === "number";
  const rightNumeric = typeof right === "number";
  if (leftNumeric && rightNumeric) return left < right ? -1 : left > right ? 1 : 0;
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareParsedVersions(left: Semver, right: Semver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const result = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (result !== 0) return result;
  }
  if (left.prerelease.length === right.prerelease.length) return 0;
  return left.prerelease.length < right.prerelease.length ? -1 : 1;
}

/**
 * Compare two semver strings. Returns -1, 0, 1, or null when either value is
 * invalid. Build metadata is ignored, as required by semver.
 */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  return compareParsedVersions(a, b);
}

export function isPrereleaseVersion(value: string): boolean {
  const parsed = parseVersion(value);
  return parsed !== null && parsed.prerelease.length > 0;
}

/** True only when latest is a valid stable release newer than installed. */
export function isNewerStableVersion(installed: string, latest: string): boolean {
  const parsedLatest = parseVersion(latest);
  if (!parsedLatest || parsedLatest.prerelease.length > 0) return false;
  const result = compareVersions(installed, latest);
  return result !== null && result < 0;
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/npm_[A-Za-z0-9]{20,}/g, "npm_[redacted]"],
  [/nvapi-[A-Za-z0-9_-]{8,}/g, "nvapi-[redacted]"],
  [/(\/\/[^:\s]+\/:_authToken\s*=\s*)\S+/gi, "$1[redacted]"],
  [/(\bAuthorization\s*[:=]\s*)(?!\[redacted\])[^\r\n]+/gi, "$1[redacted]"],
  [/\b(Bearer)\s+(?!\[redacted\])[A-Za-z0-9._~+\/=-]+/gi, "$1 [redacted]"],
  [
    /(?<![A-Za-z0-9])(api[_-]?key|access[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)(\s*[:=]\s*)(?!\[redacted\])([^\s,;"']+)/gi,
    "$1$2[redacted]",
  ],
];

/** Remove common credential shapes from process output before displaying it. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) result = result.replace(pattern, replacement);
  return result;
}

/** Strip ANSI/terminal control sequences so child output cannot move the cursor. */
export function stripTerminalSequences(text: string): string {
  return text
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message).replace(/\s+/g, " ").trim().slice(0, 300);
}

// ---------------------------------------------------------------------------
// Registry checking
// ---------------------------------------------------------------------------

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RegistryResult = { ok: true; version: string } | { ok: false; error: string };

export type RegistryOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  url?: string;
};

/**
 * Query the npm `latest` dist-tag and validate the returned stable semver.
 * Every failure mode is returned as data; this function never throws.
 */
export async function fetchLatestStableVersion(options: RegistryOptions = {}): Promise<RegistryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_REGISTRY_TIMEOUT_MS);
  const url = options.url ?? REGISTRY_LATEST_URL;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const timeoutFailure = (): RegistryResult => ({
    ok: false,
    error: `npm registry request timed out after ${timeoutMs} ms.`,
  });

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { ok: false, error: `npm registry returned HTTP ${response.status}.` };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return timedOut ? timeoutFailure() : { ok: false, error: "npm registry returned invalid JSON." };
    }

    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "npm registry returned an invalid response." };
    }
    const version = (payload as { version?: unknown }).version;
    if (typeof version !== "string" || !version.trim()) {
      return { ok: false, error: "npm registry response did not include a version." };
    }

    const trimmed = version.trim();
    const parsed = parseVersion(trimmed);
    if (!parsed) {
      return { ok: false, error: `npm registry returned an invalid version: ${redactSecrets(trimmed)}.` };
    }
    if (parsed.prerelease.length > 0) {
      return {
        ok: false,
        error: `npm's latest tag is a prerelease (${trimmed}); no stable update is available.`,
      };
    }
    return { ok: true, version: trimmed };
  } catch (error) {
    if (timedOut) return timeoutFailure();
    return {
      ok: false,
      error: `Could not reach the npm registry: ${sanitizeErrorMessage(error)}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Installed version metadata
// ---------------------------------------------------------------------------

/** Read a version from a package.json file. Never throws. */
export function readPackageVersion(packageJsonPath: string): string | null {
  try {
    const text = readFileSync(packageJsonPath, "utf8").replace(/^\uFEFF/, "");
    const payload = JSON.parse(text) as { version?: unknown };
    if (typeof payload.version !== "string") return null;
    const version = payload.version.trim();
    return parseVersion(version) ? version : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the version of the MINT package that is actually running. The source
 * tree and the packaged `dist/` bundle both sit one level below package.json.
 */
export function resolveInstalledVersion(startDir = import.meta.dir): string | null {
  const candidates = new Set<string>();
  candidates.add(join(startDir, "..", "package.json"));
  candidates.add(join(startDir, "package.json"));
  const script = process.argv[1];
  if (script) {
    const scriptDir = dirname(script);
    candidates.add(join(scriptDir, "..", "package.json"));
    candidates.add(join(scriptDir, "package.json"));
  }
  for (const candidate of candidates) {
    const version = readPackageVersion(candidate);
    if (version) return version;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Notification persistence
// ---------------------------------------------------------------------------

export type UpdateNotificationState = { lastNotifiedVersion?: string };

/** Separate from .env, config, SQLite sessions, and API credentials. */
export function updateStatePath(env: Record<string, string | undefined> = process.env): string {
  const root = env.MINT_DATA_DIR?.trim() || join(homedir(), ".mint");
  return join(root, "update-state.json");
}

export function readNotificationState(path = updateStatePath()): UpdateNotificationState {
  try {
    const payload = JSON.parse(readFileSync(path, "utf8")) as { lastNotifiedVersion?: unknown };
    if (typeof payload.lastNotifiedVersion !== "string") return {};
    const version = payload.lastNotifiedVersion.trim();
    return parseVersion(version) ? { lastNotifiedVersion: version } : {};
  } catch {
    return {};
  }
}

/**
 * Persist only the notification marker. Failures are reported as `false` so
 * startup can continue normally even on a read-only or missing data directory.
 */
export function writeNotificationState(version: string, path = updateStatePath()): boolean {
  const trimmed = version.trim();
  if (!parseVersion(trimmed)) return false;
  const payload = `${JSON.stringify(
    {
      version: 1,
      lastNotifiedVersion: trimmed,
      notifiedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`;

  let tempPath: string | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    tempPath = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(tempPath, payload, { encoding: "utf8", mode: 0o600 });
    try {
      renameSync(tempPath, path);
    } catch {
      // Some Windows filesystems refuse replacing an existing file by rename.
      writeFileSync(path, payload, { encoding: "utf8", mode: 0o600 });
      try {
        unlinkSync(tempPath);
      } catch {
        // Best effort cleanup only.
      }
    }
    try {
      chmodSync(path, 0o600);
    } catch {
      // POSIX modes are not available everywhere.
    }
    return true;
  } catch {
    if (tempPath) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Best effort cleanup only.
      }
    }
    return false;
  }
}

export function shouldNotify(
  installed: string | null,
  latest: string,
  state: UpdateNotificationState,
): boolean {
  if (!installed || !isNewerStableVersion(installed, latest)) return false;
  return state.lastNotifiedVersion !== latest;
}

// ---------------------------------------------------------------------------
// Version reporting
// ---------------------------------------------------------------------------

export type VersionStatus = "Up to date" | "Update available" | "Unable to check";
export type VersionSummary = {
  installed: string;
  latest?: string;
  status: VersionStatus;
  error?: string;
};

export function describeVersionStatus(
  installed: string | null,
  latest: string | null | undefined,
  error?: string,
): VersionSummary {
  const installedLabel = installed?.trim() || "unknown";
  const latestLabel = latest?.trim();
  if (!installed || !parseVersion(installed)) {
    return {
      installed: installedLabel,
      latest: latestLabel,
      status: "Unable to check",
      error: error ?? "Installed version metadata could not be read.",
    };
  }
  if (!latestLabel || !parseVersion(latestLabel) || isPrereleaseVersion(latestLabel)) {
    return {
      installed: installedLabel,
      latest: latestLabel,
      status: "Unable to check",
      error: error ?? "No stable latest version is known yet.",
    };
  }
  const result: VersionSummary = {
    installed: installedLabel,
    latest: latestLabel,
    status: isNewerStableVersion(installedLabel, latestLabel) ? "Update available" : "Up to date",
  };
  if (error) result.error = error;
  return result;
}

export function formatVersionReport(summary: VersionSummary, pendingVersion?: string | null): string {
  const lines = [
    "MINT Harness",
    "",
    `Installed: ${summary.installed}`,
    `Latest:    ${summary.latest ?? "unavailable"}`,
    `Status:    ${summary.status}`,
  ];
  if (summary.error) lines.push(`Note:      ${summary.error}`);
  if (pendingVersion) lines.push(`Pending:   ${pendingVersion} installed — restart MINT to use it.`);
  return lines.join("\n");
}

export function formatUpToDate(installed: string, latest: string): string {
  return `MINT is already up to date! ❤️\n\nInstalled: ${installed}\nLatest:    ${latest}`;
}

export function formatUpdateCheckFailure(installed: string, error: string): string {
  return [
    "Unable to check for MINT updates.",
    "",
    `Installed: ${installed}`,
    `Reason:    ${redactSecrets(error)}`,
    "",
    "MINT is still usable. Check your internet connection and try /update again.",
  ].join("\n");
}

export function formatUpdateSuccess(previousVersion: string, newVersion: string): string {
  return [
    "✓ MINT updated successfully!",
    "",
    `Previous version : ${previousVersion}`,
    `New version      : ${newVersion}`,
    "",
    "Restart MINT to use the new version.",
  ].join("\n");
}

export type UpdateFailure = {
  status: "failure";
  previousVersion: string;
  targetVersion: string;
  kind: InstallFailureKind;
  error: string;
  output?: string;
  exitCode?: number;
};

export function formatUpdateFailure(outcome: UpdateFailure): string {
  const lines = [
    "✗ MINT update failed.",
    "",
    `Previous version : ${outcome.previousVersion}`,
    `Target version   : ${outcome.targetVersion}`,
    `Reason           : ${redactSecrets(outcome.error)}`,
  ];
  if (outcome.output?.trim()) {
    lines.push("", "npm output:", redactSecrets(outcome.output.trim()));
  }
  lines.push("", "You can try manually:", UPDATE_COMMAND, "", "MINT is still running the previous version.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Safe npm execution
// ---------------------------------------------------------------------------

export type InstallFailureKind = "missing-npm" | "permission" | "timeout" | "failed";
export type InstallResult =
  | { ok: true; exitCode: 0; output: string }
  | {
      ok: false;
      kind: InstallFailureKind;
      error: string;
      exitCode?: number;
      output?: string;
    };

export type SpawnOptions = {
  cwd?: string;
  env: Record<string, string | undefined>;
  stdout: "pipe";
  stderr: "pipe";
};

export type SpawnedProcess = {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | number | null;
  stderr: ReadableStream<Uint8Array> | number | null;
  kill: () => void;
};

export type SpawnImpl = (argv: string[], options: SpawnOptions) => SpawnedProcess;

export type InstallOptions = {
  spawnImpl?: SpawnImpl;
  platform?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  cwd?: string;
  npmExecutable?: string;
};

const defaultSpawn: SpawnImpl = (argv, options) =>
  Bun.spawn(argv, {
    cwd: options.cwd,
    env: options.env,
    stdout: options.stdout,
    stderr: options.stderr,
  }) as unknown as SpawnedProcess;

const SENSITIVE_ENV_KEY =
  /(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTHORIZATION|PRIVATE[_-]?KEY)/i;

/** Child npm processes never need the user's API keys or provider secrets. */
export function sanitizeProcessEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SENSITIVE_ENV_KEY.test(key)));
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function isMissingExecutableError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "ENOENT" || code === "ENOTDIR") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not found in \$PATH|ENOENT|no such file/i.test(message);
}

type StreamCollector = {
  done: Promise<string>;
  text: () => string;
};

/**
 * Start draining a pipe immediately. Waiting for `exited` before reading can
 * deadlock once the child fills the OS pipe buffer, so npm output is consumed
 * while it runs.
 */
function collectStream(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
): StreamCollector {
  if (!stream || typeof stream === "number") {
    return { done: Promise.resolve(""), text: () => "" };
  }

  let output = "";
  const decoder = new TextDecoder();
  const done = (async () => {
    try {
      const reader = stream.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value) output += decoder.decode(chunk.value, { stream: true });
      }
      output += decoder.decode();
    } catch {
      // Keep whatever was collected before the stream failed.
    }
    return output;
  })();

  return { done, text: () => output };
}

async function settleCollectors(
  stdout: StreamCollector,
  stderr: StreamCollector,
  limitMs = 2_000,
): Promise<{ stdout: string; stderr: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([stdout.done, stderr.done]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, limitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { stdout: stdout.text(), stderr: stderr.text() };
}

function combinedOutput(stdout: string, stderr: string): string {
  const parts = [stdout.trim(), stderr.trim()].filter(Boolean);
  return redactSecrets(stripTerminalSequences(parts.join("\n"))).slice(0, MAX_INSTALL_OUTPUT);
}

function missingNpmMessage(): string {
  return `npm was not found on PATH. Install Node.js (which includes npm), then run:\n  ${UPDATE_COMMAND}`;
}

function permissionMessage(): string {
  return [
    "npm could not write to the global install directory (permission denied).",
    "Do not use sudo or change system-wide permissions. Configure a user-writable npm prefix, then try /update again.",
    "  npm config set prefix <user-writable-directory>",
  ].join("\n");
}

function looksLikePermissionFailure(output: string): boolean {
  return /EACCES|EPERM|permission denied|access is denied|operation not permitted/i.test(output);
}

/**
 * Install the public `mint-harness@latest` package globally.
 *
 * The command is always an argv array. Registry data is never interpolated into
 * a shell string, and the child receives a secrets-filtered environment.
 */
export async function installLatest(options: InstallOptions = {}): Promise<InstallResult> {
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const platform = options.platform ?? process.platform;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS);
  const safeEnv = sanitizeProcessEnv(options.env ?? process.env);
  const cwd = options.cwd ?? homedir();
  const candidates = options.npmExecutable
    ? [options.npmExecutable]
    : platform === "win32"
      ? ["npm.cmd", "npm"]
      : ["npm"];

  let child: SpawnedProcess | undefined;
  let spawnFailure: unknown;
  for (const executable of candidates) {
    try {
      child = spawnImpl([executable, ...UPDATE_INSTALL_ARGS], {
        cwd,
        env: safeEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      break;
    } catch (error) {
      spawnFailure = error;
    }
  }

  if (!child) {
    const missing = isMissingExecutableError(spawnFailure);
    return {
      ok: false,
      kind: missing ? "missing-npm" : "failed",
      error: missing
        ? missingNpmMessage()
        : `Could not start npm: ${sanitizeErrorMessage(spawnFailure)}`,
    };
  }

  const stdoutCollector = collectStream(child.stdout);
  const stderrCollector = collectStream(child.stderr);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOutToken = Symbol("npm-timeout");
  let timedOut = false;
  const timeout = new Promise<typeof timedOutToken>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(timedOutToken);
    }, timeoutMs);
  });

  let exitCode: number | typeof timedOutToken;
  try {
    exitCode = await Promise.race([child.exited, timeout]);
  } catch (error) {
    try {
      child.kill();
    } catch {
      // Process may already have exited.
    }
    return {
      ok: false,
      kind: "failed",
      error: `npm install failed to start: ${sanitizeErrorMessage(error)}`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (timedOut || exitCode === timedOutToken) {
    try {
      child.kill();
    } catch {
      // Process may already have exited.
    }
    const { stdout, stderr } = await settleCollectors(stdoutCollector, stderrCollector, 500);
    return {
      ok: false,
      kind: "timeout",
      error: `npm install timed out after ${timeoutMs} ms.`,
      output: combinedOutput(stdout, stderr) || undefined,
    };
  }

  const { stdout, stderr } = await settleCollectors(stdoutCollector, stderrCollector);
  const output = combinedOutput(stdout, stderr);
  if (exitCode === 0) return { ok: true, exitCode: 0, output };

  const permission = looksLikePermissionFailure(output);
  return {
    ok: false,
    kind: permission ? "permission" : "failed",
    error: permission ? permissionMessage() : `npm install exited with code ${exitCode}.`,
    exitCode,
    output: output || undefined,
  };
}

// ---------------------------------------------------------------------------
// Coordination
// ---------------------------------------------------------------------------

export type AvailableUpdate = {
  status: "available";
  installed: string;
  latest: string;
  command: string;
};

export type UpdateCheck =
  | { status: "up-to-date"; installed: string; latest: string }
  | AvailableUpdate
  | { status: "unavailable"; installed: string; error: string };

export type UpdateOutcome =
  | { status: "cancelled" }
  | { status: "success"; previousVersion: string; newVersion: string; output: string }
  | UpdateFailure;

export type InstallFn = () => Promise<InstallResult>;

export type UpdateManagerOptions = {
  installedVersion?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  cacheTtlMs?: number;
  recheckCooldownMs?: number;
  registryUrl?: string;
  now?: () => number;
};

/**
 * Session-scoped registry cache. Startup uses `startupCheck()` once; explicit
 * commands may ask for a fresh check. The installed version is captured at
 * construction so a successful install cannot make the running process report
 * a version it has not loaded yet.
 */
export class UpdateManager {
  readonly installedVersion: string | null;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly recheckCooldownMs: number;
  private readonly registryUrl: string;
  private readonly now: () => number;
  private latest?: string;
  private lastError?: string;
  private lastCheckedAt = 0;
  private lastAttemptAt = 0;
  private lastResult?: RegistryResult;
  private inFlight?: Promise<RegistryResult>;
  private startupPromise?: Promise<RegistryResult>;
  private requestSeq = 0;

  constructor(options: UpdateManagerOptions = {}) {
    this.installedVersion =
      options.installedVersion === undefined ? resolveInstalledVersion() : options.installedVersion;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REGISTRY_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.recheckCooldownMs = options.recheckCooldownMs ?? DEFAULT_RECHECK_COOLDOWN_MS;
    this.registryUrl = options.registryUrl ?? REGISTRY_LATEST_URL;
    this.now = options.now ?? Date.now;
  }

  hasFreshCache(): boolean {
    return Boolean(this.latest && this.now() - this.lastCheckedAt < this.cacheTtlMs);
  }

  getLatest(): string | undefined {
    return this.latest;
  }

  startupCheck(): Promise<RegistryResult> {
    if (!this.startupPromise) this.startupPromise = this.checkLatest(false);
    return this.startupPromise;
  }

  checkLatest(force = false): Promise<RegistryResult> {
    if (!this.installedVersion) {
      return Promise.resolve({
        ok: false,
        error: "Installed MINT version could not be read from package metadata.",
      });
    }

    const now = this.now();
    if (!force && this.latest && now - this.lastCheckedAt < this.cacheTtlMs) {
      return Promise.resolve({ ok: true, version: this.latest });
    }
    if (!force && this.inFlight) return this.inFlight;
    if (
      !force &&
      this.lastResult &&
      !this.lastResult.ok &&
      now - this.lastAttemptAt < this.recheckCooldownMs
    ) {
      return Promise.resolve(this.lastResult);
    }

    const seq = ++this.requestSeq;
    this.lastAttemptAt = now;
    const request = fetchLatestStableVersion({
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      url: this.registryUrl,
    })
      .then((result) => {
        if (seq === this.requestSeq) {
          this.lastResult = result;
          if (result.ok) {
            this.latest = result.version;
            this.lastCheckedAt = this.now();
            this.lastError = undefined;
          } else {
            this.lastError = result.error;
          }
        }
        return result;
      })
      .catch((error): RegistryResult => {
        const result: RegistryResult = {
          ok: false,
          error: `Could not check for updates: ${sanitizeErrorMessage(error)}`,
        };
        if (seq === this.requestSeq) {
          this.lastResult = result;
          this.lastError = result.error;
        }
        return result;
      });

    this.inFlight = request;
    const clearInFlight = () => {
      if (this.inFlight === request) this.inFlight = undefined;
    };
    request.then(clearInFlight, clearInFlight);
    return request;
  }

  summary(): VersionSummary {
    return describeVersionStatus(this.installedVersion, this.latest ?? null, this.lastError);
  }
}

/** Coordinates check/confirm/install outcomes without depending on the UI. */
export class UpdateService {
  constructor(
    private readonly manager: UpdateManager,
    private readonly install: InstallFn = () => installLatest(),
  ) {}

  get installedVersion(): string | null {
    return this.manager.installedVersion;
  }

  hasFreshCache(): boolean {
    return this.manager.hasFreshCache();
  }

  summary(): VersionSummary {
    return this.manager.summary();
  }

  async checkForUpdate(force = true): Promise<UpdateCheck> {
    const installed = this.manager.installedVersion;
    if (!installed) {
      return {
        status: "unavailable",
        installed: "unknown",
        error: "Installed MINT version could not be read from package metadata.",
      };
    }

    try {
      const result = await this.manager.checkLatest(force);
      if (!result.ok) return { status: "unavailable", installed, error: result.error };
      if (!isNewerStableVersion(installed, result.version)) {
        return { status: "up-to-date", installed, latest: result.version };
      }
      return {
        status: "available",
        installed,
        latest: result.version,
        command: UPDATE_COMMAND,
      };
    } catch (error) {
      return {
        status: "unavailable",
        installed,
        error: `Could not check for updates: ${sanitizeErrorMessage(error)}`,
      };
    }
  }

  async decide(action: "update" | "cancel", check: AvailableUpdate): Promise<UpdateOutcome> {
    if (action === "cancel") return { status: "cancelled" };

    try {
      const result = await this.install();
      if (result.ok) {
        return {
          status: "success",
          previousVersion: check.installed,
          newVersion: check.latest,
          output: result.output,
        };
      }
      return {
        status: "failure",
        previousVersion: check.installed,
        targetVersion: check.latest,
        kind: result.kind,
        error: result.error,
        output: result.output,
        exitCode: result.exitCode,
      };
    } catch (error) {
      return {
        status: "failure",
        previousVersion: check.installed,
        targetVersion: check.latest,
        kind: "failed",
        error: `Could not run npm: ${sanitizeErrorMessage(error)}`,
      };
    }
  }
}
