export const MAX_SESSION_TITLE = 64;

export function normalizeSessionTitle(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_SESSION_TITLE);
}

export function deriveTitleFromMessage(message: string): string {
  const cleaned = message.trim().replace(/[\n\r]+/g, " ");
  if (!cleaned) return "new session";
  return normalizeSessionTitle(cleaned);
}