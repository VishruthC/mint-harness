import { createMemo, JSX } from "solid-js";
import { catLineArtRows, renderCatPixels, type CatCell, type CatPalette, type CatState } from "./cat-line-art.ts";

interface CatLineArtProps {
  /** Available terminal columns for the composition. */
  width: number;
  /** Optional vertical budget in terminal rows. */
  height?: number;
  /** Animation clock in milliseconds. Zero keeps the default stationary pose. */
  phase?: number;
  /** Animation state: idle blink, thinking head movement, working walk, success reaction. */
  state?: CatState;
  /** Pixel palette bound to theme tokens. */
  colors: CatPalette;
}

type Span = { text: string; fg: string; bg: string };

// Coalesce consecutive cells with identical colors to keep redraws cheap.
function toSpans(cells: CatCell[]): Span[] {
  const spans: Span[] = [];
  for (const cell of cells) {
    const last = spans[spans.length - 1];
    if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.ch;
    else spans.push({ text: cell.ch, fg: cell.fg, bg: cell.bg });
  }
  return spans;
}

/**
 * Tiny pixel-art cat sitting on a full-width divider.
 * Rendered natively with upper-half blocks — no images, canvas, or dependencies.
 */
export function CatLineArt(props: CatLineArtProps): JSX.Element {
  const rendered = createMemo(() => renderCatPixels({
    width: props.width,
    height: props.height ?? catLineArtRows(props.width),
    state: props.state ?? "idle",
    phase: props.phase ?? 0,
    colors: props.colors,
  }));

  return (
    <box
      flexDirection="column"
      width="100%"
      minWidth={0}
      flexShrink={0}
      overflow="hidden"
    >
      {rendered().rows.map((row) => {
        if (row.length && row.every((cell) => cell.ch === "─")) {
          return <text fg={props.colors.outline} wrapMode="none" width="100%" minWidth={0} truncate={true}>{"─".repeat(row.length)}</text>;
        }
        return (
          <text wrapMode="none" width="100%" minWidth={0} truncate={true}>
            {toSpans(row).map((span) => <span style={{ fg: span.fg, bg: span.bg }}>{span.text}</span>)}
          </text>
        );
      })}
    </box>
  );
}
