import type { NvidiaModel } from "./nvidia";

export function filterModels(models: NvidiaModel[], query: string): NvidiaModel[] {
  if (!query.trim()) return models;
  const q = query.trim().toLowerCase();
  return models.filter((m) => m.id.toLowerCase().includes(q));
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