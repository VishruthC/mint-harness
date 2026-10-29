import { describe, expect, test } from "bun:test";
import { CAT_EXPRESSIONS, catSprite, feedCat, petCat, selectCatExpression } from "../src/cat";
import type { CatProfile } from "../src/storage";

const freshProfile = (): CatProfile => ({ pets: 0, treats: 0, selectedExpression: "idle", animationsEnabled: true, unlockedExpressions: ["idle", "happy"] });

describe("MINT ASCII cat", () => {
  test("petting persists count and unlocks heart eyes after three pets", () => {
    let profile = freshProfile();
    profile = petCat(profile).profile;
    profile = petCat(profile).profile;
    const third = petCat(profile);
    expect(third.profile.pets).toBe(3);
    expect(third.profile.unlockedExpressions).toContain("love");
    expect(third.unlocked).toContain("love");
  });

  test("feeding unlocks zoomies after three treats", () => {
    let profile = freshProfile();
    profile = feedCat(profile).profile;
    profile = feedCat(profile).profile;
    const third = feedCat(profile);
    expect(third.profile.treats).toBe(3);
    expect(third.profile.unlockedExpressions).toContain("zoomies");
  });

  test("higher-tier expressions unlock at their combined thresholds", () => {
    let profile = freshProfile();
    for (let index = 0; index < 8; index++) profile = petCat(profile).profile;
    for (let index = 0; index < 5; index++) profile = feedCat(profile).profile;
    expect(profile.unlockedExpressions).toContain("wizard");
    for (let index = 0; index < 7; index++) profile = petCat(profile).profile;
    for (let index = 0; index < 5; index++) profile = feedCat(profile).profile;
    expect(profile.unlockedExpressions).toContain("chaos");
  });

  test("expressions cannot be equipped before unlock", () => {
    const profile = freshProfile();
    expect(selectCatExpression(profile, "chaos").selectedExpression).toBe("idle");
    expect(selectCatExpression(profile, "happy").selectedExpression).toBe("happy");
  });

  test("ASCII sprite has a compact three-line shape, uses plain ASCII, and expression IDs are unique", () => {
    const sprite = catSprite("idle", 0, "idle");
    expect(sprite).toHaveLength(3);
    expect(sprite.join("\n")).toMatch(/\( o\.o \)/);
    expect(sprite.join("\n")).toMatch(/^[\x00-\x7F\n]*$/);
    expect(new Set(CAT_EXPRESSIONS.map((expression) => expression.id)).size).toBe(CAT_EXPRESSIONS.length);
  });
});
