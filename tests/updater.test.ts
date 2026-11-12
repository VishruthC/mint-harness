import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CACHE_TTL_MS,
  PACKAGE_NAME,
  REGISTRY_LATEST_URL,
  UPDATE_COMMAND,
  UPDATE_INSTALL_ARGS,
  UpdateManager,
  UpdateService,
  compareVersions,
  describeVersionStatus,
  fetchLatestStableVersion,
  formatUpdateCheckFailure,
  formatUpdateFailure,
  formatUpdateSuccess,
  formatUpToDate,
  formatVersionReport,
  installLatest,
  isNewerStableVersion,
  isPrereleaseVersion,
  parseVersion,
  readNotificationState,
  readPackageVersion,
  redactSecrets,
  resolveInstalledVersion,
  sanitizeProcessEnv,
  shouldNotify,
  stripTerminalSequences,
  updateStatePath,
  writeNotificationState,
  type AvailableUpdate,
  type FetchLike,
  type SpawnImpl,
  type SpawnOptions,
  type SpawnedProcess,
  type UpdateFailure,
} from "../src/updater";
import {
  ApprovalQueue,
  actionLabel,
  createUpdateRequest,
  footerHint,
} from "../src/approval";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "mint-updater-test-"));
  tempDirs.push(directory);
  return directory;
}

function responseWith(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function textStream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream() as ReadableStream<Uint8Array>;
}

function fakeProcess(exitCode: number, stdout = "", stderr = ""): SpawnedProcess {
  return {
    exited: Promise.resolve(exitCode),
    stdout: textStream(stdout),
    stderr: textStream(stderr),
    kill: () => {},
  };
}

function missingExecutable(): SpawnImpl {
  return () => {
    const error = new Error("Executable not found in $PATH");
    (error as Error & { code?: string }).code = "ENOENT";
    throw error;
  };
}

function availableCheck(installed = "0.1.0", latest = "0.1.1"): AvailableUpdate {
  return {
    status: "available",
    installed,
    latest,
    command: UPDATE_COMMAND,
  };
}

describe("semver comparison", () => {
  test("detects patch, minor, and major updates", () => {
    expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
    expect(isNewerStableVersion("0.1.0", "0.1.1")).toBe(true);
    expect(isNewerStableVersion("0.1.9", "0.2.0")).toBe(true);
    expect(isNewerStableVersion("0.9.9", "1.0.0")).toBe(true);
  });

  test("treats equal and older versions as not updates", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(isNewerStableVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerStableVersion("0.2.0", "0.1.9")).toBe(false);
  });

  test("handles prerelease precedence and ignores prerelease latest tags", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBe(-1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
    expect(isPrereleaseVersion("1.0.0-rc.1")).toBe(true);
    expect(isPrereleaseVersion("1.0.0")).toBe(false);
    expect(isNewerStableVersion("0.9.0", "1.0.0-beta.1")).toBe(false);
    expect(isNewerStableVersion("1.0.0-beta.1", "1.0.0")).toBe(true);
  });

  test("rejects invalid version strings", () => {
    for (const value of ["1.0", "1.0.0.0", "01.0.0", "1.0.0-", "1.0.0+", "v", "", "nope"]) {
      expect(parseVersion(value)).toBeNull();
      expect(compareVersions(value, "1.0.0")).toBeNull();
      expect(isNewerStableVersion(value, "1.0.0")).toBe(false);
    }
    expect(isNewerStableVersion("1.0.0", "not-a-version")).toBe(false);
  });

  test("ignores build metadata", () => {
    expect(compareVersions("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
    expect(isNewerStableVersion("1.0.0+build.1", "1.0.0")).toBe(false);
  });
});

describe("npm registry checks", () => {
  test("returns a valid stable version from the latest endpoint", async () => {
    let requested: string | URL | Request | undefined;
    const fetchImpl: FetchLike = async (input) => {
      requested = input;
      return responseWith({ version: "0.2.0" });
    };
    const result = await fetchLatestStableVersion({ fetchImpl });
    expect(result).toEqual({ ok: true, version: "0.2.0" });
    expect(String(requested)).toBe(REGISTRY_LATEST_URL);
    expect(REGISTRY_LATEST_URL).toContain(PACKAGE_NAME);
  });

  test("reports no internet connection without throwing", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await fetchLatestStableVersion({ fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Could not reach the npm registry");
  });

  test("times out a hanging request", async () => {
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      });
    const result = await fetchLatestStableVersion({ fetchImpl, timeoutMs: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("timed out");
  });

  test("handles HTTP errors", async () => {
    const result = await fetchLatestStableVersion({
      fetchImpl: async () => responseWith("nope", 503),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("HTTP 503");
  });

  test("handles invalid JSON", async () => {
    const result = await fetchLatestStableVersion({
      fetchImpl: async () => responseWith("{not-json"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid JSON");
  });

  test("handles a missing version field", async () => {
    const result = await fetchLatestStableVersion({
      fetchImpl: async () => responseWith({ name: PACKAGE_NAME }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("did not include a version");
  });

  test("rejects an invalid version field", async () => {
    const result = await fetchLatestStableVersion({
      fetchImpl: async () => responseWith({ version: "not-semver" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid version");
  });

  test("rejects a prerelease latest tag", async () => {
    const result = await fetchLatestStableVersion({
      fetchImpl: async () => responseWith({ version: "0.2.0-beta.1" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("prerelease");
    expect(isNewerStableVersion("0.1.0", "0.2.0-beta.1")).toBe(false);
  });

  test("startup detection queries npm at most once", async () => {
    let requests = 0;
    const manager = new UpdateManager({
      installedVersion: "0.1.0",
      fetchImpl: async () => {
        requests += 1;
        return responseWith({ version: "0.1.1" });
      },
    });
    await manager.startupCheck();
    await manager.startupCheck();
    expect(requests).toBe(1);
  });

  test("reuses a valid cache and refreshes after it expires", async () => {
    let requests = 0;
    let now = 0;
    const manager = new UpdateManager({
      installedVersion: "0.1.0",
      fetchImpl: async () => {
        requests += 1;
        return responseWith({ version: "0.1.1" });
      },
      now: () => now,
      cacheTtlMs: 1_000,
      recheckCooldownMs: 0,
    });

    await manager.checkLatest(false);
    now = 500;
    await manager.checkLatest(false);
    expect(requests).toBe(1);
    expect(manager.hasFreshCache()).toBe(true);

    now = DEFAULT_CACHE_TTL_MS + 1_000;
    await manager.checkLatest(false);
    expect(requests).toBe(2);
  });

  test("cools down negative checks unless forced", async () => {
    let requests = 0;
    const manager = new UpdateManager({
      installedVersion: "0.1.0",
      fetchImpl: async () => {
        requests += 1;
        throw new TypeError("offline");
      },
      recheckCooldownMs: 10_000,
    });
    const first = await manager.checkLatest(false);
    const second = await manager.checkLatest(false);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(requests).toBe(1);
    await manager.checkLatest(true);
    expect(requests).toBe(2);
  });
});

describe("installed version metadata", () => {
  test("reads the version from package.json", () => {
    const directory = tempDir();
    const path = join(directory, "package.json");
    writeFileSync(path, JSON.stringify({ name: PACKAGE_NAME, version: "0.1.0" }));
    expect(readPackageVersion(path)).toBe("0.1.0");
  });

  test("reads package.json with a UTF-8 BOM", () => {
    const directory = tempDir();
    const path = join(directory, "package.json");
    writeFileSync(path, `\uFEFF${JSON.stringify({ name: PACKAGE_NAME, version: "0.1.0" })}`);
    expect(readPackageVersion(path)).toBe("0.1.0");
  });

  test("rejects missing or invalid package metadata", () => {
    const directory = tempDir();
    const invalid = join(directory, "invalid.json");
    writeFileSync(invalid, JSON.stringify({ version: "not-semver" }));
    expect(readPackageVersion(invalid)).toBeNull();
    expect(readPackageVersion(join(directory, "missing.json"))).toBeNull();
  });

  test("resolves the installed package from a packaged dist directory", () => {
    const root = tempDir();
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version: "0.1.0" }));
    expect(resolveInstalledVersion(join(root, "dist"))).toBe("0.1.0");
  });
});

describe("update notification persistence", () => {
  test("notifies for a new update and remembers the version", () => {
    const directory = tempDir();
    const path = join(directory, "update-state.json");
    expect(shouldNotify("0.1.0", "0.1.1", readNotificationState(path))).toBe(true);
    expect(writeNotificationState("0.1.1", path)).toBe(true);
    expect(readNotificationState(path).lastNotifiedVersion).toBe("0.1.1");
    expect(readFileSync(path, "utf8")).toContain('"lastNotifiedVersion": "0.1.1"');
  });

  test("suppresses an already-notified version and shows a different newer one", () => {
    const directory = tempDir();
    const path = join(directory, "update-state.json");
    expect(writeNotificationState("0.1.1", path)).toBe(true);
    expect(shouldNotify("0.1.0", "0.1.1", readNotificationState(path))).toBe(false);
    expect(shouldNotify("0.1.0", "0.1.2", readNotificationState(path))).toBe(true);
    expect(writeNotificationState("0.1.2", path)).toBe(true);
    expect(readNotificationState(path).lastNotifiedVersion).toBe("0.1.2");
  });

  test("does not notify for equal, older, or prerelease versions", () => {
    expect(shouldNotify("0.1.0", "0.1.0", {})).toBe(false);
    expect(shouldNotify("0.2.0", "0.1.9", {})).toBe(false);
    expect(shouldNotify("0.1.0", "0.2.0-beta.1", {})).toBe(false);
    expect(shouldNotify(null, "0.2.0", {})).toBe(false);
  });

  test("recovers from unreadable or invalid state", () => {
    const directory = tempDir();
    const path = join(directory, "update-state.json");
    writeFileSync(path, "{not-json");
    expect(readNotificationState(path)).toEqual({});
    writeFileSync(path, JSON.stringify({ lastNotifiedVersion: "not-semver" }));
    expect(readNotificationState(path)).toEqual({});
    writeFileSync(path, JSON.stringify({ lastNotifiedVersion: "0.1.1" }));
    expect(readNotificationState(path)).toEqual({ lastNotifiedVersion: "0.1.1" });
  });

  test("does not crash when notification state cannot be persisted", () => {
    const directory = tempDir();
    const blocker = join(directory, "not-a-directory");
    writeFileSync(blocker, "file");
    const path = join(blocker, "update-state.json");
    expect(() => writeNotificationState("0.1.1", path)).not.toThrow();
    expect(writeNotificationState("0.1.1", path)).toBe(false);
    expect(() => readNotificationState(path)).not.toThrow();
    expect(readNotificationState(path)).toEqual({});
  });

  test("uses MINT_DATA_DIR for the state file", () => {
    const directory = tempDir();
    expect(updateStatePath({ MINT_DATA_DIR: directory })).toBe(join(directory, "update-state.json"));
  });
});

describe("safe npm installation", () => {
  test("uses npm.cmd on Windows with fixed argv and no shell", async () => {
    const calls: Array<{ argv: string[]; options: SpawnOptions }> = [];
    const result = await installLatest({
      platform: "win32",
      env: { PATH: "C:\\bin", NVIDIA_API_KEY: "secret", NPM_CONFIG_USERCONFIG: "settings" },
      spawnImpl: (argv, options) => {
        calls.push({ argv, options });
        return fakeProcess(0, "added 1 package");
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.argv).toEqual(["npm.cmd", ...UPDATE_INSTALL_ARGS]);
    expect(calls[0]?.argv).toEqual(["npm.cmd", "install", "-g", "mint-harness@latest"]);
    expect(calls[0]?.options.env.PATH).toBe("C:\\bin");
    expect(calls[0]?.options.env.NVIDIA_API_KEY).toBeUndefined();
    expect(calls[0]?.options.env.NPM_CONFIG_USERCONFIG).toBe("settings");
    expect(calls[0]?.argv.join(" ")).not.toContain("cmd.exe /c");
  });

  test("uses npm on POSIX", async () => {
    const calls: string[][] = [];
    const result = await installLatest({
      platform: "linux",
      spawnImpl: (argv) => {
        calls.push(argv);
        return fakeProcess(0);
      },
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.[0]).toBe("npm");
  });

  test("falls back from npm.cmd to npm when the shim is missing", async () => {
    const calls: string[][] = [];
    let attempt = 0;
    const result = await installLatest({
      platform: "win32",
      spawnImpl: (argv) => {
        calls.push(argv);
        attempt += 1;
        if (attempt === 1) {
          const error = new Error("Executable not found in $PATH");
          (error as Error & { code?: string }).code = "ENOENT";
          throw error;
        }
        return fakeProcess(0);
      },
    });
    expect(result.ok).toBe(true);
    expect(calls.map((argv) => argv[0])).toEqual(["npm.cmd", "npm"]);
  });

  test("reports a missing npm executable", async () => {
    const result = await installLatest({
      platform: "win32",
      spawnImpl: missingExecutable(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("missing-npm");
      expect(result.error).toContain("npm was not found on PATH");
      expect(result.error).toContain(UPDATE_COMMAND);
    }
  });

  test("reports permission errors with actionable guidance", async () => {
    const result = await installLatest({
      platform: "linux",
      spawnImpl: () => fakeProcess(1, "", "npm ERR! code EACCES\nnpm ERR! permission denied"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("permission");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("user-writable npm prefix");
      expect(result.error).toContain("Do not use sudo");
    }
  });

  test("reports failed installations using the real exit code", async () => {
    const result = await installLatest({
      platform: "linux",
      spawnImpl: () => fakeProcess(1, "", "npm ERR! code E404\nnpm ERR! 404 Not Found"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("failed");
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("exited with code 1");
      expect(result.output).toContain("E404");
    }
  });

  test("times out and kills npm", async () => {
    let killed = false;
    const result = await installLatest({
      platform: "linux",
      timeoutMs: 10,
      spawnImpl: () => ({
        exited: new Promise<number>(() => {}),
        stdout: textStream(""),
        stderr: textStream(""),
        kill: () => {
          killed = true;
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("timeout");
      expect(result.error).toContain("timed out");
    }
    expect(killed).toBe(true);
  });

  test("drains npm output while the process runs instead of deadlocking", async () => {
    let resolveExit: ((code: number) => void) | undefined;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    let sent = false;
    const stdout = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new TextEncoder().encode("0123456789".repeat(20_000)));
          return;
        }
        controller.close();
        resolveExit?.(0);
      },
    });

    const result = await installLatest({
      platform: "linux",
      spawnImpl: () => ({
        exited,
        stdout,
        stderr: textStream(""),
        kill: () => {},
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.length).toBeGreaterThan(10_000);
  });

  test("filters API keys and provider secrets from the child environment", () => {
    const env = sanitizeProcessEnv({
      PATH: "bin",
      NVIDIA_API_KEY: "nvapi-abcdefghij",
      NVIDIA_BASE_URL: "https://example.invalid",
      GITHUB_TOKEN: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      HOME: "home",
      NPM_CONFIG_USERCONFIG: "config",
    });
    expect(env.PATH).toBe("bin");
    expect(env.HOME).toBe("home");
    expect(env.NVIDIA_BASE_URL).toBe("https://example.invalid");
    expect(env.NPM_CONFIG_USERCONFIG).toBe("config");
    expect(env.NVIDIA_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  test("strips terminal control sequences from child output", () => {
    const cleaned = stripTerminalSequences(
      "\x1b[31mred\x1b[0m\x1b]0;window title\x07 done\r\nnext\x1b[?25l",
    );
    expect(cleaned).toBe("red done\nnext");
    expect(cleaned).not.toContain("\x1b");
    expect(cleaned).not.toContain("\r");
  });

  test("redacts credential shapes from output", async () => {
    const result = await installLatest({
      platform: "linux",
      spawnImpl: () =>
        fakeProcess(
          0,
          "NVIDIA_API_KEY=secret-value\nAuthorization: Bearer abc.def.ghi\nnpm_abcdefghijklmnopqrstuvwxyz0123456789",
        ),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).not.toContain("secret-value");
      expect(result.output).not.toContain("abc.def.ghi");
      expect(result.output).not.toContain("npm_abcdefghijklmnopqrstuvwxyz0123456789");
      expect(result.output).toContain("[redacted]");
    }
    expect(redactSecrets("token=abc")).toContain("[redacted]");
  });
});

describe("update confirmation and outcomes", () => {
  test("creates an update request in the existing approval queue", () => {
    const queue = new ApprovalQueue();
    const request = queue.enqueue(createUpdateRequest(0, {
      kind: "update",
      fromVersion: "0.1.0",
      toVersion: "0.1.1",
      command: UPDATE_COMMAND,
    }));
    expect(request.kind).toBe("update");
    expect(request.actions).toEqual(["update", "cancel"]);
    expect(request.defaultAction).toBe("update");
    expect(request.fullscreenDetails.join("\n")).toContain("Installed: 0.1.0");
    expect(request.fullscreenDetails.join("\n")).toContain("Latest stable: 0.1.1");
    expect(actionLabel("update")).toBe("Yes, update");
    expect(actionLabel("cancel")).toBe("Cancel");
    expect(footerHint("update")).toContain("Yes, update");
    expect(queue.current()?.details.kind).toBe("update");
  });

  test("reports an available update", async () => {
    const manager = new UpdateManager({
      installedVersion: "0.1.0",
      fetchImpl: async () => responseWith({ version: "0.1.1" }),
    });
    const service = new UpdateService(manager);
    const check = await service.checkForUpdate(true);
    expect(check.status).toBe("available");
    if (check.status === "available") {
      expect(check.installed).toBe("0.1.0");
      expect(check.latest).toBe("0.1.1");
      expect(check.command).toBe(UPDATE_COMMAND);
    }
  });

  test("reports up to date for equal or older latest versions", async () => {
    for (const latest of ["0.1.0", "0.0.9"]) {
      const manager = new UpdateManager({
        installedVersion: "0.1.0",
        fetchImpl: async () => responseWith({ version: latest }),
      });
      const check = await new UpdateService(manager).checkForUpdate(true);
      expect(check.status).toBe("up-to-date");
      if (check.status === "up-to-date") expect(check.latest).toBe(latest);
    }
  });

  test("reports registry unavailability without throwing", async () => {
    const manager = new UpdateManager({
      installedVersion: "0.1.0",
      fetchImpl: async () => {
        throw new TypeError("offline");
      },
    });
    const service = new UpdateService(manager);
    const check = await service.checkForUpdate(true);
    expect(check.status).toBe("unavailable");
    if (check.status === "unavailable") {
      expect(check.installed).toBe("0.1.0");
      expect(check.error).toContain("Could not reach the npm registry");
    }
    expect(formatUpdateCheckFailure("0.1.0", "offline")).toContain("try /update again");
  });

  test("installs only after explicit confirmation", async () => {
    let installs = 0;
    const service = new UpdateService(
      new UpdateManager({ installedVersion: "0.1.0" }),
      async () => {
        installs += 1;
        return { ok: true, exitCode: 0, output: "added 1 package" };
      },
    );
    const outcome = await service.decide("update", availableCheck());
    expect(outcome.status).toBe("success");
    if (outcome.status === "success") {
      expect(outcome.previousVersion).toBe("0.1.0");
      expect(outcome.newVersion).toBe("0.1.1");
    }
    expect(installs).toBe(1);
  });

  test("cancels without running npm", async () => {
    let installs = 0;
    const service = new UpdateService(
      new UpdateManager({ installedVersion: "0.1.0" }),
      async () => {
        installs += 1;
        return { ok: true, exitCode: 0, output: "" };
      },
    );
    const outcome = await service.decide("cancel", availableCheck());
    expect(outcome).toEqual({ status: "cancelled" });
    expect(installs).toBe(0);
  });

  test("returns structured failure details", async () => {
    const service = new UpdateService(
      new UpdateManager({ installedVersion: "0.1.0" }),
      async () => ({
        ok: false,
        kind: "permission",
        error: "permission denied",
        exitCode: 1,
        output: "npm ERR! EACCES",
      }),
    );
    const outcome = await service.decide("update", availableCheck());
    expect(outcome.status).toBe("failure");
    if (outcome.status === "failure") {
      expect(outcome.kind).toBe("permission");
      expect(outcome.previousVersion).toBe("0.1.0");
      expect(outcome.targetVersion).toBe("0.1.1");
      expect(outcome.exitCode).toBe(1);
    }
  });

  test("formats success, failure, and up-to-date results with actual versions", () => {
    expect(formatUpdateSuccess("0.1.0", "0.1.1")).toContain("Previous version : 0.1.0");
    expect(formatUpdateSuccess("0.1.0", "0.1.1")).toContain("New version      : 0.1.1");
    expect(formatUpdateSuccess("0.1.0", "0.1.1")).toContain("Restart MINT");
    expect(formatUpToDate("0.1.0", "0.1.0")).toContain("already up to date");
    expect(formatUpToDate("0.1.0", "0.1.0")).toContain("0.1.0");

    const failure: UpdateFailure = {
      status: "failure",
      previousVersion: "0.1.0",
      targetVersion: "0.1.1",
      kind: "failed",
      error: "npm exited with code 1",
      output: "npm ERR! E404",
    };
    const report = formatUpdateFailure(failure);
    expect(report).toContain("Previous version");
    expect(report).toContain("Target version");
    expect(report).toContain(UPDATE_COMMAND);
    expect(report).toContain("still running the previous version");
    expect(report).toContain("E404");
  });
});

describe("/version reporting", () => {
  test("reports an available update", () => {
    const summary = describeVersionStatus("0.1.0", "0.1.1");
    expect(summary.status).toBe("Update available");
    const report = formatVersionReport(summary);
    expect(report).toContain("MINT Harness");
    expect(report).toContain("Installed: 0.1.0");
    expect(report).toContain("Latest:    0.1.1");
    expect(report).toContain("Status:    Update available");
  });

  test("reports up to date", () => {
    const summary = describeVersionStatus("0.1.0", "0.1.0");
    expect(summary.status).toBe("Up to date");
    expect(formatVersionReport(summary)).toContain("Status:    Up to date");
    expect(describeVersionStatus("0.2.0", "0.1.0").status).toBe("Up to date");
  });

  test("reports an unavailable registry without crashing", () => {
    const summary = describeVersionStatus("0.1.0", null, "npm registry request timed out");
    expect(summary.status).toBe("Unable to check");
    const report = formatVersionReport(summary);
    expect(report).toContain("Latest:    unavailable");
    expect(report).toContain("Status:    Unable to check");
    expect(report).toContain("timed out");
  });

  test("uses cached version information without another registry request", async () => {
    let requests = 0;
    const manager = new UpdateManager({
      installedVersion: "0.1.0",
      fetchImpl: async () => {
        requests += 1;
        return responseWith({ version: "0.1.1" });
      },
    });
    const service = new UpdateService(manager);
    const first = await service.checkForUpdate(false);
    expect(first.status).toBe("available");
    const second = await service.checkForUpdate(false);
    expect(second.status).toBe("available");
    expect(requests).toBe(1);
    expect(service.hasFreshCache()).toBe(true);
    expect(service.summary().status).toBe("Update available");
  });

  test("shows a pending restart after a successful install", () => {
    const report = formatVersionReport(describeVersionStatus("0.1.0", "0.1.1"), "0.1.1");
    expect(report).toContain("Pending:   0.1.1 installed");
    expect(report).toContain("restart MINT");
  });

  test("reports unknown installed metadata as unable to check", () => {
    const summary = describeVersionStatus(null, "0.1.1", "Installed version metadata could not be read.");
    expect(summary.status).toBe("Unable to check");
    expect(summary.installed).toBe("unknown");
    expect(summary.latest).toBe("0.1.1");
  });
});
