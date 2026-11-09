import { describe, expect, test } from "bun:test";
import { BASE, catLineArtRows, catPixelRows, renderCatPixels, type CatPalette } from "../src/cat-line-art.ts";

const palette: CatPalette = { transparent: "#1e1e2e", outline: "#777184", body: "#cba6f7", light: "#f5c2e7", eye: "#fab387" };

function dividerRow(rows: { ch: string }[][]): number {
  return rows.findIndex((row) => row.every((cell) => cell.ch === "─"));
}

function catCells(rows: { ch: string; fg: string; bg: string }[][]): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, column) => {
      if (cell.ch === "▀") cells.push([column, rowIndex]);
    });
  });
  return cells;
}

describe("cat pixel art", () => {
  test("tiles the full width and keeps the divider row", () => {
    for (const width of [24, 40, 60, 90]) {
      const { rows, dividerRow } = renderCatPixels({ width, state: "idle", phase: 0, colors: palette });
      expect(rows.length).toBe(catPixelRows());
      expect(dividerRow).toBe(rows.length - 1);
      for (const row of rows) expect(row.length).toBe(width);
      expect(rows[dividerRow]!.every((cell) => cell.ch === "─")).toBe(true);
    }
  });

  test("paints the sprite in the lavender family on the theme background", () => {
    const { rows } = renderCatPixels({ width: 60, state: "idle", phase: 0, colors: palette });
    const cells = catCells(rows);
    expect(cells.length).toBeGreaterThan(20);
    const fgs = new Set<string>();
    for (const [x, y] of cells) fgs.add(rows[y]![x]!.fg);
    expect(fgs.has(palette.body)).toBe(true);
    expect(fgs.has(palette.outline)).toBe(true);
    expect(fgs.has(palette.eye)).toBe(true);
  });

  test("keeps the cat around 30% from the left with its tail on the left", () => {
    const { rows } = renderCatPixels({ width: 60, state: "idle", phase: 0, colors: palette });
    const cells = catCells(rows);
    const xs = cells.map(([x]) => x);
    const center = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(center / 60).toBeGreaterThan(0.2);
    expect(center / 60).toBeLessThan(0.5);
    expect(Math.max(...xs)).toBeLessThan(40);
  });

  test("uses only upper-half blocks, the divider, and spaces", () => {
    const { rows } = renderCatPixels({ width: 50, state: "success", phase: 700, colors: palette });
    for (const row of rows) {
      for (const cell of row) {
        expect(cell.ch === "▀" || cell.ch === "─" || cell.ch === " ").toBe(true);
      }
    }
  });

  test("matches the hand-built sprite", () => {
    expect(BASE.length).toBe(16);
    for (const row of BASE) expect(row.length).toBe(16);
    const { rows } = renderCatPixels({ width: 60, state: "idle", phase: 0, colors: palette });
    expect(catCells(rows).length).toBeGreaterThan(30);
  });

  test("is deterministic and stationary at phase zero", () => {
    const a = renderCatPixels({ width: 60, state: "idle", phase: 0, colors: palette });
    const b = renderCatPixels({ width: 60, state: "idle", phase: 0, colors: palette });
    expect(a).toEqual(b);
  });

  test("blinks during idle and reacts in other states", () => {
    const idle = renderCatPixels({ width: 60, state: "idle", phase: 0, colors: palette });
    const blink = renderCatPixels({ width: 60, state: "idle", phase: 300, colors: palette });
    expect(blink).not.toEqual(idle);
    const thinking = renderCatPixels({ width: 60, state: "thinking", phase: 100, colors: palette });
    expect(thinking).not.toEqual(idle);
    const success = renderCatPixels({ width: 60, state: "success", phase: 0, colors: palette });
    expect(success).not.toEqual(idle);
  });

  test("walks along the divider while working", () => {
    const still = renderCatPixels({ width: 60, state: "working", phase: 0, colors: palette });
    const walking = renderCatPixels({ width: 60, state: "working", phase: 1000, colors: palette });
    expect(walking).not.toEqual(still);
    expect(dividerRow(walking.rows)).toBe(dividerRow(still.rows));
  });

  test("shrinks cleanly on short terminals", () => {
    const { rows } = renderCatPixels({ width: 60, height: 5, state: "idle", phase: 0, colors: palette });
    expect(rows.length).toBe(5);
    expect(catLineArtRows(60)).toBe(catPixelRows());
  });
});
