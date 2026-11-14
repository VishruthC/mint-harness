import { describe, expect, test } from "bun:test";
import { displayModelName, filterModels, mergeCurrentModel } from "../src/models";
import type { NvidiaModel } from "../src/nvidia";

function model(id: string, owned_by = "nvidia"): NvidiaModel {
  return { id, object: "model", owned_by };
}

describe("filterModels", () => {
  const models = [
    model("meta/llama-3.1-8b-instruct"),
    model("nvidia/nemotron-4-340b-instruct"),
    model("mistralai/mixtral-8x7b-instruct-v0.1", "mistralai"),
  ];

  test("empty query returns all models alphabetically by display name", () => {
    const ordered = filterModels(models, "");
    expect(ordered).toHaveLength(3);
    expect(ordered.map((m) => displayModelName(m.id))).toEqual([
      "Llama 3.1 8B Instruct",
      "Mixtral 8x7b Instruct V0.1",
      "Nemotron 4 340b Instruct",
    ]);
    expect(filterModels(models, "   ")).toHaveLength(3);
  });

  test("keeps the configured model in the catalog and sorts it in place", () => {
    const withCurrent = mergeCurrentModel(models, "google/gemma-2-27b-it");
    const ordered = filterModels(withCurrent, "");
    expect(ordered.map((entry) => entry.id)).toEqual([
      "google/gemma-2-27b-it",
      "meta/llama-3.1-8b-instruct",
      "mistralai/mixtral-8x7b-instruct-v0.1",
      "nvidia/nemotron-4-340b-instruct",
    ]);
  });

  test("matches id case-insensitively", () => {
    expect(filterModels(models, "LLAMA").map((m) => m.id)).toEqual(["meta/llama-3.1-8b-instruct"]);
  });

  test("matches provider/owned_by", () => {
    expect(filterModels(models, "mistralai").map((m) => m.id)).toEqual(["mistralai/mixtral-8x7b-instruct-v0.1"]);
  });

  test("returns empty when nothing matches", () => {
    expect(filterModels(models, "zzzz-nope")).toHaveLength(0);
  });
});

describe("natural model search", () => {
  const catalog = [
    model("meta/llama-3.1-70b-instruct"),
    model("meta/llama-3.1-8b-instruct"),
    model("meta/llama-3.1-8b"),
    model("nvidia/nemotron-4-340b-instruct"),
    model("mistralai/mixtral-8x7b-instruct-v0.1"),
  ];

  test("ignores punctuation, casing and spacing", () => {
    const results = filterModels(catalog, "Llama 3.1");
    expect(results).toHaveLength(3);
    expect(results.every((entry) => entry.id.includes("llama-3.1"))).toBe(true);
    expect(filterModels(catalog, "llama3.1").every((entry) => entry.id.includes("llama-3.1"))).toBe(true);
    expect(filterModels(catalog, "META  llama")).toHaveLength(3);
  });

  test("matches display-style names such as 8B Instruct", () => {
    const results = filterModels(catalog, "Llama 3.1 8B Instruct");
    expect(results.map((entry) => entry.id)).toEqual([
      "meta/llama-3.1-8b-instruct",
    ]);
  });

  test("puts exact and prefix model ids first", () => {
    const results = filterModels(catalog, "meta/llama-3.1-8b");
    expect(results[0].id).toBe("meta/llama-3.1-8b");
    expect(results[1].id).toBe("meta/llama-3.1-8b-instruct");
  });

  test("treats punctuation-only input as an empty query", () => {
    expect(filterModels(catalog, " /.- ")).toHaveLength(catalog.length);
  });

  test("still matches provider names", () => {
    expect(filterModels(catalog, "Mixtral").map((entry) => entry.id)).toEqual([
      "mistralai/mixtral-8x7b-instruct-v0.1",
    ]);
  });
});