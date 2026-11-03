import { describe, expect, test } from "bun:test";
import { filterModels } from "../src/models";
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

  test("empty query returns all models", () => {
    expect(filterModels(models, "")).toHaveLength(3);
    expect(filterModels(models, "   ")).toHaveLength(3);
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