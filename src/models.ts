import type { NvidiaModel } from "./nvidia";

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactSearch(value: string): string {
  return value.replace(/\s+/g, "");
}

const MODEL_BRANDS: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  gpt: "GPT",
  llm: "LLM",
  ai: "AI",
  moe: "MoE",
};

/** Human-readable model name shown by the picker and status bar. */
export function displayModelName(id: string): string {
  if (!id) return "no model";
  // Strip vendor prefix (meta/, nvidia/, etc.)
  const parts = id.split("/");
  const name = parts.length > 1 ? parts[1] : parts[0];
  return name
    .split(/[-_]/)
    .map((word) => MODEL_BRANDS[word.toLowerCase()] ?? (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function sortByDisplayName(models: NvidiaModel[]): NvidiaModel[] {
  return [...models].sort((a, b) => {
    const byName = displayModelName(a.id).localeCompare(displayModelName(b.id), undefined, { sensitivity: "base" });
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
}

function modelHaystack(model: NvidiaModel): string {
  return normalizeSearch(`${model.id} ${displayModelName(model.id)} ${model.owned_by ?? ""}`);
}

function relevance(model: NvidiaModel, query: string, compactQuery: string, tokens: string[]): number {
  const id = normalizeSearch(model.id);
  const name = normalizeSearch(displayModelName(model.id));
  const idCompact = compactSearch(id);
  const nameCompact = compactSearch(name);
  if (id === query || name === query) return 0;
  if (idCompact === compactQuery || nameCompact === compactQuery) return 1;
  if (id.startsWith(query) || idCompact.startsWith(compactQuery) || name.startsWith(query) || nameCompact.startsWith(compactQuery)) return 2;
  const words = `${id} ${name}`.split(" ").filter(Boolean);
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 3;
  return 4;
}

/**
 * Search model IDs, display names and providers using natural names.
 * Punctuation, casing and spacing are ignored, and every token must match, so
 * `Llama 3.1 8B` finds `meta/llama-3.1-8b-instruct`. An empty query returns the
 * full catalog alphabetically by display name; matches sort by relevance and
 * then keep that order.
 */
export function filterModels(models: NvidiaModel[], query: string): NvidiaModel[] {
  const ordered = sortByDisplayName(models);
  const normalized = normalizeSearch(query);
  if (!normalized) return ordered;
  const tokens = normalized.split(" ");
  const compact = compactSearch(normalized);

  return ordered
    .filter((model) => {
      const haystack = modelHaystack(model);
      return (
        tokens.every((token) => haystack.includes(token))
        || compactSearch(haystack).includes(compact)
      );
    })
    .map((model, index) => ({
      model,
      index,
      score: relevance(model, normalized, compact, tokens),
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.model);
}

export function mergeCurrentModel(models: NvidiaModel[], current: string): NvidiaModel[] {
  if (!current) return models;
  const exists = models.some((m) => m.id === current);
  if (exists) return models;
  return [{ id: current, object: "model", owned_by: "configured" }, ...models];
}

export function movePickerIndex(index: number, delta: number, count: number): number {
  if (count === 0) return 0;
  const next = (index + delta) % count;
  return next < 0 ? next + count : next;
}

export function pagePickerIndex(index: number, pageSize: number, count: number, direction: number): number {
  if (count === 0) return 0;
  const next = index + direction * pageSize;
  if (next >= count) return count - 1;
  if (next < 0) return 0;
  return next;
}

export function homeEndIndex(index: number, count: number, home: boolean): number {
  return home ? 0 : Math.max(0, count - 1);
}

/**
 * Keep the visible window anchored to the selection only when it crosses an
 * edge. Mostly this returns the previous start unchanged, so the list does not
 * jump until the highlight reaches the complete top or bottom row.
 */
export function followPickerWindow(start: number, index: number, visibleRows: number, count: number): number {
  if (count <= 0) return 0;
  const rows = Math.max(1, Math.min(visibleRows, count));
  const maxStart = Math.max(0, count - rows);
  let next = Math.max(0, Math.min(start, maxStart));
  if (index < next) next = index;
  else if (index >= next + rows) next = index - rows + 1;
  return Math.max(0, Math.min(next, maxStart));
}

/** Index range for a window that starts at `start`. */
export function visibleWindow(start: number, visibleRows: number, count: number): number[] {
  if (count === 0) return [];
  const rows = Math.min(Math.max(1, visibleRows), count);
  const from = Math.max(0, Math.min(start, count - rows));
  return Array.from({ length: rows }, (_, i) => from + i);
}

export function findModel(models: NvidiaModel[], query: string): NvidiaModel | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  // Exact match first
  const exact = models.find((m) => m.id === trimmed);
  if (exact) return exact;
  // Case-insensitive unique match
  const lower = trimmed.toLowerCase();
  const matches = models.filter((m) => m.id.toLowerCase() === lower);
  if (matches.length === 1) return matches[0];
  return null;
}

export function isValidModelId(id: string): boolean {
  return id.length > 0 && !id.includes("\n") && !id.includes("\r");
}