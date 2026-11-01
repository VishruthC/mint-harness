import { describe, expect, test } from "bun:test";
import { CAT_EXPRESSIONS, feedCat, petCat, selectCatExpression } from "../src/cat";
import type { CatProfile } from "../src/storage";

const freshProfile = (): CatProfile => ({ pets: 0, treats: 0, selectedExpression: "idle", animationsEnabled: true, unlockedExpressions: ["idle", "happy"] });

describe("MINT cat profile & expressions", () => {
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

  test("expression IDs are unique", () => {
    const ids = CAT_EXPRESSIONS.map((expression) => expression.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});