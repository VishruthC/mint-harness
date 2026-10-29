export const MAX_PASTE_CHARS = 100_000;

export function sanitizePastedText(raw: string): { text: string; truncated: boolean } {
  let text = raw.replace(/\r\n?/g, "\n");
  text = stripAnsiSequences(text);
  text = text.replace(/\0/g, "");
  const truncated = text.length > MAX_PASTE_CHARS;
  if (truncated) text = text.slice(0, MAX_PASTE_CHARS);
  return { text, truncated };
}

function stripAnsiSequences(text: string): string {
  // ANSI CSI and OSC sequences
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*[\x07\x1b]/g, "")
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")
    .replace(/\x1b[#()][^\x1b]*\x1b\\?/g, "");
}

export function insertAtCursor(
  value: string,
  cursor: number,
  insert: string,
): { value: string; cursor: number } {
  const clamped = Math.max(0, Math.min(cursor, value.length));
  const newValue = value.slice(0, clamped) + insert + value.slice(clamped);
  return { value: newValue, cursor: clamped + insert.length };
}

export function normalizeApiKey(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

export function validateConnectDraft(
  apiKey: string,
  baseUrl: string,
  model: string,
): { ok: boolean; error?: string } {
  if (!apiKey || apiKey.length < 10) {
    return { ok: false, error: "API key is too short" };
  }
  try {
    new URL(baseUrl);
  } catch {
    return { ok: false, error: "Invalid base URL" };
  }
  return { ok: true };
}

export function maskSecret(text: string): string {
  return "•".repeat(text.length);
}

export type ConnectField = "apiKey" | "baseUrl" | "model";

export function nextConnectField(current: ConnectField, shift: boolean): ConnectField {
  const order: ConnectField[] = ["apiKey", "baseUrl", "model"];
  const idx = order.indexOf(current);
  const next = shift ? (idx - 1 + order.length) % order.length : (idx + 1) % order.length;
  return order[next];
}

export function resolveConnectModel(
  draftModel: string,
  configuredModel: string,
  fetchedModels: string[],
): string {
  if (draftModel.trim()) return draftModel.trim();
  if (configuredModel) return configuredModel;
  return fetchedModels[0] || "";
}