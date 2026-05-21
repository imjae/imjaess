import { describe, expect, it } from "vitest";
import { buildManagedPrompt, compactHandoff, withAgentTimeout } from "@/lib/execution-policy";

describe("execution policy", () => {
  it("clips large prompts and adds role management rules", () => {
    const managed = buildManagedPrompt({
      role: "tester",
      prompt: "x".repeat(5000),
      policy: {
        contextBudgetChars: 1200,
        outputBudgetChars: 500,
        timeBudgetMs: 1000
      }
    });

    expect(managed.wasTrimmed).toBe(true);
    expect(managed.prompt.length).toBeLessThanOrEqual(1400);
    expect(managed.prompt).toContain("short sub-agent slice");
    expect(managed.prompt).toContain("Test independently");
  });

  it("compacts handoff text", () => {
    const handoff = compactHandoff("a".repeat(2000), {
      contextBudgetChars: 2000,
      outputBudgetChars: 300,
      timeBudgetMs: 1000
    });
    expect(handoff.length).toBeLessThanOrEqual(320);
    expect(handoff).toContain("context trimmed");
  });

  it("rejects timed-out slices", async () => {
    await expect(
      withAgentTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 1)
    ).rejects.toThrow("time budget");
  });
});
