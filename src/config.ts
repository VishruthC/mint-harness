import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync, chmodSync } from "node:fs";
import { z } from "zod";
import { DEFAULT_AGENT_LOOP_LIMITS } from "./agent-loop";
import type { CatConfig } from "./cat/types";

const EnvSchema = z.object({
  NVIDIA_API_KEY: z.string().trim().min(1, "NVIDIA_API_KEY is missing"),
  NVIDIA_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_MODEL: z.string().trim().optional().default(""),
  MINT_MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(DEFAULT_AGENT_LOOP_LIMITS.maxToolRounds),
  MINT_MAX_TOOL_CALLS_PER_TURN: z.coerce.number().int().positive().default(DEFAULT_AGENT_LOOP_LIMITS.maxToolCallsPerTurn),
  MINT_EFFORT: z.enum(["low", "medium", "high", "max"]).optional().default("max"),
  MINT_AUTO_APPLY: z.enum(["manual", "auto"]).default("manual"),
  MINT_CAT_ENABLED: z.enum(["1", "0", "true", "false"]).default("1"),
  MINT_CAT_ASSET_PACK: z.string().trim().min(1).default("default"),
  MINT_CAT_RENDERER: z.enum(["auto", "kitty", "sixel", "blocks", "ascii"]).default("auto"),
  MINT_CAT_ANIMATION: z.enum(["1", "0", "true", "false"]).default("1"),
  MINT_CAT_SCALE: z.coerce.number().positive().max(3).default(1),
  MINT_CAT_IDLE_FPS: z.coerce.number().nonnegative().max(30).default(0),
  MINT_CAT_WORKING_FPS: z.coerce.number().nonnegative().max(30).default(0),
  MINT_CAT_TRANSITION_MS: z.coerce.number().int().nonnegative().max(2000).default(100),
  MINT_CAT_ONESHOT_SPEED: z.coerce.number().min(0.25).max(4).default(1),
});

export type MintConfig = {
  apiKey: string;
  baseUrl: string;
  preferredModel: string;
  maxToolRounds: number;
  maxToolCallsPerTurn: number;
  effort: "low" | "medium" | "high" | "max";
  autoApply: "manual" | "auto";
  cat: CatConfig;
};

const truthy = (value: unknown) => {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return ["1", "true"].includes(value.trim().toLowerCase());
  return false;
};

function readDotEnv(path = ".env"): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export function loadConfig(env?: Record<string, string | undefined>): MintConfig {
  // In local MINT runs, prefer the project's .env values over inherited Windows
  // environment variables. A stale NVIDIA_API_KEY in the parent shell can otherwise
  // silently override the key the user just tested from .env and cause HTTP 403.
  const source = env ?? { ...Bun.env, ...readDotEnv() };
  if (!source.NVIDIA_API_KEY?.trim()) {
    throw new Error("NVIDIA_API_KEY is missing");
  }

  const parsed = EnvSchema.safeParse({
    NVIDIA_API_KEY: source.NVIDIA_API_KEY,
    NVIDIA_BASE_URL: source.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    NVIDIA_MODEL: source.NVIDIA_MODEL || "",
    MINT_MAX_TOOL_ROUNDS: source.MINT_MAX_TOOL_ROUNDS ?? String(DEFAULT_AGENT_LOOP_LIMITS.maxToolRounds),
    MINT_MAX_TOOL_CALLS_PER_TURN: source.MINT_MAX_TOOL_CALLS_PER_TURN ?? String(DEFAULT_AGENT_LOOP_LIMITS.maxToolCallsPerTurn),
    MINT_EFFORT: source.MINT_EFFORT ?? "max",
    MINT_AUTO_APPLY: source.MINT_AUTO_APPLY ?? "manual",
    MINT_CAT_ENABLED: source.MINT_CAT_ENABLED ?? "1",
    MINT_CAT_ASSET_PACK: source.MINT_CAT_ASSET_PACK ?? "default",
    MINT_CAT_RENDERER: source.MINT_CAT_RENDERER ?? "auto",
    MINT_CAT_ANIMATION: source.MINT_CAT_ANIMATION ?? "1",
    MINT_CAT_SCALE: source.MINT_CAT_SCALE ?? "1",
    MINT_CAT_IDLE_FPS: source.MINT_CAT_IDLE_FPS ?? "0",
    MINT_CAT_WORKING_FPS: source.MINT_CAT_WORKING_FPS ?? "0",
    MINT_CAT_TRANSITION_MS: source.MINT_CAT_TRANSITION_MS ?? "100",
    MINT_CAT_ONESHOT_SPEED: source.MINT_CAT_ONESHOT_SPEED ?? "1",
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return {
    apiKey: parsed.data.NVIDIA_API_KEY,
    baseUrl: parsed.data.NVIDIA_BASE_URL.replace(/\/+$/, ""),
    preferredModel: parsed.data.NVIDIA_MODEL,
    maxToolRounds: parsed.data.MINT_MAX_TOOL_ROUNDS,
    maxToolCallsPerTurn: parsed.data.MINT_MAX_TOOL_CALLS_PER_TURN,
    effort: parsed.data.MINT_EFFORT,
    autoApply: parsed.data.MINT_AUTO_APPLY,
    cat: {
      enabled: truthy(parsed.data.MINT_CAT_ENABLED),
      assetPack: parsed.data.MINT_CAT_ASSET_PACK,
      renderer: parsed.data.MINT_CAT_RENDERER,
      animation: truthy(parsed.data.MINT_CAT_ANIMATION),
      scale: parsed.data.MINT_CAT_SCALE,
      idleFps: parsed.data.MINT_CAT_IDLE_FPS,
      workingFps: parsed.data.MINT_CAT_WORKING_FPS,
      transitionMs: parsed.data.MINT_CAT_TRANSITION_MS,
      oneShotSpeed: parsed.data.MINT_CAT_ONESHOT_SPEED,
    },
  };
}

const MINT_KEYS = [
  "NVIDIA_API_KEY",
  "NVIDIA_BASE_URL",
  "NVIDIA_MODEL",
  "MINT_MAX_TOOL_ROUNDS",
  "MINT_MAX_TOOL_CALLS_PER_TURN",
  "MINT_EFFORT",
  "MINT_AUTO_APPLY",
  "MINT_CAT_ENABLED",
  "MINT_CAT_ASSET_PACK",
  "MINT_CAT_RENDERER",
  "MINT_CAT_ANIMATION",
  "MINT_CAT_SCALE",
  "MINT_CAT_IDLE_FPS",
  "MINT_CAT_WORKING_FPS",
  "MINT_CAT_TRANSITION_MS",
  "MINT_CAT_ONESHOT_SPEED",
] as const;

function writeDotEnvAtomic(
  path: string,
  update: (lines: string[]) => string[],
): void {
  let existingLines: string[] = [];
  if (existsSync(path)) {
    existingLines = readFileSync(path, "utf8").split(/\r?\n/);
  }
  const output = update(existingLines).filter(Boolean).join("\n") + "\n";
  const tmp = `${path}.tmp.${crypto.randomUUID()}`;
  writeFileSync(tmp, output, "utf8");
  try {
    renameSync(tmp, path);
  } catch {
    copyFileSync(tmp, path);
    unlinkSync(tmp);
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // Some platforms don't support POSIX file modes
  }
}

export function writeDotEnv(config: MintConfig, path = ".env"): void {
  writeDotEnvAtomic(path, (existingLines) => {
    const otherLines = existingLines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return true;
      const keyMatch = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return keyMatch && !MINT_KEYS.includes(keyMatch[1] as typeof MINT_KEYS[number]);
    });

    const newLines = [
      `NVIDIA_API_KEY="${config.apiKey.replace(/"/g, '\\"')}"`,
      `NVIDIA_BASE_URL="${config.baseUrl.replace(/"/g, '\\"')}"`,
      config.preferredModel ? `NVIDIA_MODEL="${config.preferredModel.replace(/"/g, '\\"')}"` : "",
      `MINT_MAX_TOOL_ROUNDS=${config.maxToolRounds}`,
      `MINT_MAX_TOOL_CALLS_PER_TURN=${config.maxToolCallsPerTurn}`,
      `MINT_EFFORT=${config.effort}`,
      `MINT_AUTO_APPLY=${config.autoApply}`,
      `MINT_CAT_ENABLED=${config.cat.enabled ? "1" : "0"}`,
      `MINT_CAT_ASSET_PACK="${config.cat.assetPack.replace(/"/g, '\\"')}"`,
      `MINT_CAT_RENDERER=${config.cat.renderer}`,
      `MINT_CAT_ANIMATION=${config.cat.animation ? "1" : "0"}`,
      `MINT_CAT_SCALE=${config.cat.scale}`,
      `MINT_CAT_IDLE_FPS=${config.cat.idleFps}`,
      `MINT_CAT_WORKING_FPS=${config.cat.workingFps}`,
      `MINT_CAT_TRANSITION_MS=${config.cat.transitionMs}`,
      `MINT_CAT_ONESHOT_SPEED=${config.cat.oneShotSpeed}`,
    ].filter(Boolean);

    return [...otherLines, ...newLines];
  });
}

export function updateDotEnvModel(model: string, path = ".env"): void {
  if (!model || model.includes("\n") || model.includes("\r")) {
    throw new Error("Invalid model ID");
  }
  writeDotEnvAtomic(path, (existingLines) => {
    const otherLines = existingLines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return true;
      const keyMatch = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return keyMatch && keyMatch[1] !== "NVIDIA_MODEL";
    });
    return [...otherLines, `NVIDIA_MODEL="${model.replace(/"/g, '\\"')}"`];
  });
}

export function updateDotEnvAutoApply(mode: "manual" | "auto", path = ".env"): void {
  if (!["manual", "auto"].includes(mode)) throw new Error("Invalid auto-apply mode");
  writeDotEnvAtomic(path, (existingLines) => {
    const otherLines = existingLines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return true;
      const keyMatch = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return keyMatch && keyMatch[1] !== "MINT_AUTO_APPLY";
    });
    return [...otherLines, `MINT_AUTO_APPLY=${mode}`];
  });
}
