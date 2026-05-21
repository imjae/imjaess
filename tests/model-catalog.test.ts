import { describe, expect, it } from "vitest";
import { defaultModelForProvider, isValidModelForProvider, modelsForProvider } from "@/lib/model-catalog";

describe("model catalog", () => {
  it("lists GPT-5.5 as the default OpenAI model", () => {
    expect(defaultModelForProvider("openai")).toBe("gpt-5.5");
    expect(modelsForProvider("openai").map((model) => model.id)).toContain("gpt-5.5");
  });

  it("validates provider-specific model choices", () => {
    expect(isValidModelForProvider("openai", "gpt-5.5")).toBe(true);
    expect(isValidModelForProvider("openai", "mock-agent")).toBe(false);
    expect(isValidModelForProvider("codex-cli", "default")).toBe(true);
    expect(isValidModelForProvider("codex-cli", "mock-agent")).toBe(false);
    expect(isValidModelForProvider("mock", "mock-agent")).toBe(true);
  });

  it("uses the local Codex CLI profile as the default codex-cli model", () => {
    expect(defaultModelForProvider("codex-cli")).toBe("default");
    expect(modelsForProvider("codex-cli").map((model) => model.id)).toContain("gpt-5.5");
  });
});
