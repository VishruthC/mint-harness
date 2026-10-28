import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const EnvSchema = z.object({
  NVIDIA_API_KEY: z.string().trim().min(1, "NVIDIA_API_KEY is missing"),
  NVIDIA_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_MODEL: z.string().trim().optional().default(""),
});

export type MintConfig = {
  apiKey: string;
  baseUrl: string;
  preferredModel: string;
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
  const parsed = EnvSchema.safeParse({
    NVIDIA_API_KEY: source.NVIDIA_API_KEY,
    NVIDIA_BASE_URL: source.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    NVIDIA_MODEL: source.NVIDIA_MODEL || "",
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return {
    apiKey: parsed.data.NVIDIA_API_KEY,
    baseUrl: parsed.data.NVIDIA_BASE_URL.replace(/\/+$/, ""),
    preferredModel: parsed.data.NVIDIA_MODEL,
  };
}
