import { afterEach, describe, expect, it } from "vitest";
import { buildManagedPrompt, compactHandoff, executionPolicy, withAgentTimeout } from "@/lib/execution-policy";

describe("execution policy", () => {
  afterEach(() => {
    delete process.env.AGENT_TIME_BUDGET_MS;
    delete process.env.IMPLEMENTER_TIME_BUDGET_MS;
  });

  it("gives implementer a 15 minute default time budget", () => {
    expect(executionPolicy("researcher").timeBudgetMs).toBe(300_000);
    expect(executionPolicy("implementer").timeBudgetMs).toBe(900_000);
  });

  it("allows overriding implementer time budget independently", () => {
    process.env.AGENT_TIME_BUDGET_MS = "120000";
    process.env.IMPLEMENTER_TIME_BUDGET_MS = "450000";
    expect(executionPolicy("tester").timeBudgetMs).toBe(120_000);
    expect(executionPolicy("implementer").timeBudgetMs).toBe(450_000);
  });

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
    let timedOut = false;
    await expect(
      withAgentTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 1, () => {
        timedOut = true;
      })
    ).rejects.toThrow("time budget");
    expect(timedOut).toBe(true);
  });
});
