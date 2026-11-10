import { describe, expect, test } from "bun:test";
import { fitTextMiddle, formatClockTime, textWidth } from "../src/ui-format";

describe("header clock", () => {
  test("formats local time as fixed-width HH:MM:SS", () => {
    expect(formatClockTime(new Date(2026, 0, 2, 3, 4, 5))).toBe("03:04:05");
    expect(formatClockTime(new Date(2026, 11, 31, 23, 59, 59))).toBe("23:59:59");
    expect(formatClockTime(new Date(2026, 5, 1, 0, 0, 0))).toBe("00:00:00");
    expect(formatClockTime(new Date(2026, 5, 1, 12, 30, 9))).toBe("12:30:09");
  });
});

describe("header title fitting", () => {
  test("keeps titles that already fit", () => {
    expect(fitTextMiddle("new session", 20)).toBe("new session");
    expect(fitTextMiddle("exactly-ten", 11)).toBe("exactly-ten");
    expect(fitTextMiddle("", 8)).toBe("");
  });

  test("preserves both ends and uses exactly the available width", () => {
    const fitted = fitTextMiddle("implement the login flow in auth.ts", 20);
    expect(fitted).toContain("…");
    expect(fitted.startsWith("implement")).toBe(true);
    expect(fitted.endsWith("auth.ts")).toBe(true);
    expect(textWidth(fitted)).toBe(20);
    expect(fitted.length).toBeLessThan("implement the login flow in auth.ts".length);
  });

  test("never puts more text in the buffer than the visible budget", () => {
    const title = "a very long session title that would otherwise be clipped";
    for (let width = 0; width <= 24; width += 1) {
      expect(textWidth(fitTextMiddle(title, width))).toBeLessThanOrEqual(width);
    }
    expect(fitTextMiddle(title, 1)).toBe("…");
    expect(fitTextMiddle(title, 0)).toBe("");
  });

  test("counts wide characters without splitting surrogate pairs", () => {
    const wide = fitTextMiddle("猫猫猫猫猫猫猫猫", 7);
    expect(wide).toContain("…");
    expect(textWidth(wide)).toBeLessThanOrEqual(7);
    const emoji = fitTextMiddle("😺😺😺😺😺😺", 5);
    expect(emoji).toContain("…");
    expect([...emoji].every((character) => character.codePointAt(0) !== undefined)).toBe(true);
  });
});
