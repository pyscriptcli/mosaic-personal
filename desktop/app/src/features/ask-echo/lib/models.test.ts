import { describe, expect, it } from "vitest";
import { findLunaMediumModel, normalizeCodexModels } from "./models";

describe("Codex model catalog", () => {
  it("keeps visible models and uses the app-server model identifier", () => {
    expect(normalizeCodexModels([
      { id: "catalog-luna", model: "gpt-6-luna-medium", displayName: "GPT-6 Luna Medium" },
      { id: "hidden", model: "hidden-model", displayName: "Hidden", hidden: true },
      { id: "duplicate", model: "gpt-6-luna-medium", displayName: "Duplicate" },
    ])).toEqual([{ value: "gpt-6-luna-medium", label: "GPT-6 Luna Medium" }]);
  });

  it("does not invent a Luna default when the catalog lacks one", () => {
    const models = normalizeCodexModels([{ id: "gpt-6", displayName: "GPT-6" }]);
    expect(findLunaMediumModel(models)).toBeNull();
  });
});
