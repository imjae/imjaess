import { describe, expect, it } from "vitest";
import { parseVerifierDecision } from "@/lib/decision";

describe("parseVerifierDecision", () => {
  it("parses verifier JSON", () => {
    expect(parseVerifierDecision('{"decision":"needs_fix","summary":"missing test"}')).toEqual({
      decision: "needs_fix",
      summary: "missing test"
    });
  });

  it("falls back to blocked when decision is ambiguous", () => {
    const parsed = parseVerifierDecision("I am unsure.");
    expect(parsed.decision).toBe("blocked");
    expect(parsed.summary).toContain("recognized decision");
  });
});
