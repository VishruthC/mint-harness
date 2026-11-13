import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

function normalizeCwd(value: string): string {
  const absolute = resolve(value);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function createFakePackage(base: string, bundled: boolean) {
  const pkg = join(base, "package");
  const workspace = join(base, "workspace");
  const probe = join(base, "cwd.txt");
  const solid = join(pkg, "node_modules", "@opentui", "solid");

  mkdirSync(join(pkg, "bin"), { recursive: true });
  mkdirSync(join(pkg, "src", "cat", "assets"), { recursive: true });
  mkdirSync(join(solid, "scripts"), { recursive: true });
  mkdirSync(workspace, { recursive: true });

  writeFileSync(join(pkg, "bin", "mint.js"), readFileSync(join(repoRoot, "bin", "mint.js"), "utf8"));
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "mint-harness", version: "0.0.0", type: "module" }),
  );
  writeFileSync(
    join(solid, "package.json"),
    JSON.stringify({
      name: "@opentui/solid",
      version: "0.0.0",
      main: "index.js",
      exports: { ".": "./index.js", "./preload": { bun: "./scripts/preload.js" } },
    }),
  );
  writeFileSync(join(solid, "index.js"), "export {};\n");
  writeFileSync(join(solid, "scripts", "preload.js"), "// test preload\n");

  const app = `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(probe)}, process.cwd());\n`;
  if (bundled) {
    mkdirSync(join(pkg, "dist"), { recursive: true });
    writeFileSync(join(pkg, "dist", "index.js"), app);
  } else {
    writeFileSync(join(pkg, "src", "index.tsx"), app);
    writeFileSync(join(pkg, "tsconfig.json"), "{}\n");
  }

  return { pkg, workspace, probe };
}

function runFakeLaunch(bundled: boolean) {
  const base = mkdtempSync(join(tmpdir(), "mint-launch-"));
  const { pkg, workspace, probe } = createFakePackage(base, bundled);

  try {
    const result = spawnSync(process.execPath, [join(pkg, "bin", "mint.js")], {
      cwd: workspace,
      env: {
        ...process.env,
        MINT_WORKSPACE: workspace,
        MINT_INVOCATION_CWD: workspace,
        MINT_ENV_FILE: join(workspace, ".env"),
        MINT_DATA_DIR: join(base, "data"),
        MINT_CAT_ENABLED: "0",
        MINT_CAT_ASSETS: join(pkg, "src", "cat", "assets"),
      },
      encoding: "utf8",
      timeout: 20_000,
    });

    expect(result.status).toBe(0);
    const actual = normalizeCwd(readFileSync(probe, "utf8").trim());
    expect(actual).toBe(normalizeCwd(workspace));
    expect(actual).not.toBe(normalizeCwd(pkg));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

describe("installed launcher", () => {
  test("starts the bundled app outside the package directory", () => {
    runFakeLaunch(true);
  });

  test("starts the source fallback outside the package directory", () => {
    runFakeLaunch(false);
  });
});
