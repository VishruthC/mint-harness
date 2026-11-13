import type { NvidiaModel } from "./nvidia";

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactSearch(value: string): string {
  return value.replace(/\s+/g, "");
}

function modelHaystack(model: NvidiaModel): string {
  return normalizeSearch(`${model.id} ${model.owned_by ?? ""}`);
}

function relevance(model: NvidiaModel, query: string, compactQuery: string, tokens: string[]): number {
  const id = normalizeSearch(model.id);
  const idCompact = compactSearch(id);
  if (id === query) return 0;
  if (idCompact === compactQuery) return 1;
  if (id.startsWith(query) || idCompact.startsWith(compactQuery)) return 2;
  const words = id.split(" ").filter(Boolean);
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 3;
  return 4;
}

/**
 * Search model IDs and providers using natural names. Punctuation, casing and
 * spacing are ignored, and every token must match, so `Llama 3.1 8B` finds
 * `meta/llama-3.1-8b-instruct`. Exact and prefix matches sort first.
 */
export function filterModels(models: NvidiaModel[], query: string): NvidiaModel[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return models;
  const tokens = normalized.split(" ");
  const compact = compactSearch(normalized);

  return models
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

export function visibleWindow(index: number, visibleRows: number, count: number): number[] {
  if (count === 0) return [];
  if (visibleRows >= count) return Array.from({ length: count }, (_, i) => i);
  const half = Math.floor(visibleRows / 2);
  let start = index - half;
  if (start < 0) start = 0;
  if (start + visibleRows > count) start = count - visibleRows;
  return Array.from({ length: Math.min(visibleRows, count - start) }, (_, i) => start + i);
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