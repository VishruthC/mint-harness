/**
 * Paths that depend on how MINT was launched.
 *
 * The packaged launcher runs the bundled app with the package root as its
 * working directory so runtime dependencies resolve consistently, while the
 * user's project stays the workspace. These helpers keep `.env` reads/writes
 * and workspace fallbacks pointed at the invoking directory.
 */
import { join, resolve } from "node:path";

type Env = Record<string, string | undefined>;

/** Directory the user ran `minth` from (or the real cwd in local runs). */
export function invocationCwd(env: Env = process.env): string {
  const configured = env.MINT_INVOCATION_CWD?.trim();
  return configured ? resolve(configured) : process.cwd();
}

/** Absolute path of the `.env` file MINT should read and update. */
export function envFilePath(env: Env = process.env): string {
  const configured = env.MINT_ENV_FILE?.trim();
  return configured ? resolve(configured) : join(invocationCwd(env), ".env");
}
