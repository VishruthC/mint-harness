/**
 * Small, dependency-free formatting helpers for the TUI chrome.
 *
 * The header shows a live wall clock and a session title in a single row. The
 * title is fitted before rendering so the text buffer never contains more
 * characters than the screen can show — otherwise drag-copying a clipped title
 * would copy hidden characters.
 */

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f1e6, 0x1f1ff],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

/** Approximate terminal cells used by one Unicode code point. */
function cellWidth(codePoint: number): number {
  if (codePoint === 0 || codePoint === 0x200d) return 0;
  if (codePoint >= 0x0300 && codePoint <= 0x036f) return 0; // combining marks
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return 0; // variation selectors
  for (const [start, end] of WIDE_RANGES) {
    if (codePoint >= start && codePoint <= end) return 2;
  }
  return 1;
}

/** Visual width of `text` in terminal cells. */
export function textWidth(text: string): number {
  let width = 0;
  for (const character of text) width += cellWidth(character.codePointAt(0) ?? 0);
  return width;
}

/** Local wall-clock time as fixed-width `HH:MM:SS` (24-hour). */
export function formatClockTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Fit `text` into `maxWidth` cells, keeping both ends visible.
 *
 * The ellipsis is included in the budget. When the text already fits it is
 * returned untouched, so titles that fit are never rewritten.
 */
export function fitTextMiddle(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (textWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";

  const characters = [...text];
  const available = maxWidth - 1;
  const headTarget = Math.ceil(available / 2);

  let headWidth = 0;
  let headCount = 0;
  while (headCount < characters.length) {
    const width = cellWidth(characters[headCount]!.codePointAt(0) ?? 0);
    if (headWidth + width > headTarget) break;
    headWidth += width;
    headCount += 1;
  }

  let tailWidth = 0;
  let tailCount = 0;
  while (tailCount < characters.length - headCount) {
    const character = characters[characters.length - 1 - tailCount]!;
    const width = cellWidth(character.codePointAt(0) ?? 0);
    if (tailWidth + width > available - headWidth) break;
    tailWidth += width;
    tailCount += 1;
  }

  const head = characters.slice(0, headCount).join("");
  const tail = tailCount > 0 ? characters.slice(characters.length - tailCount).join("") : "";
  return `${head}…${tail}`;
}
