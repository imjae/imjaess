import type { VerificationDecision } from "@/lib/types";

export interface ParsedDecision {
  decision: VerificationDecision;
  summary: string;
}

export function parseVerifierDecision(text: string): ParsedDecision {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { decision?: string; summary?: string };
      if (parsed.decision === "pass" || parsed.decision === "needs_fix" || parsed.decision === "blocked") {
        return {
          decision: parsed.decision,
          summary: parsed.summary || text.trim()
        };
      }
    } catch {
      // Fall through to keyword parsing.
    }
  }

  const lower = text.toLowerCase();
  if (lower.includes("needs_fix") || lower.includes("need fix") || lower.includes("fix required")) {
    return { decision: "needs_fix", summary: text.trim() };
  }
  if (lower.includes("blocked") || lower.includes("cannot proceed")) {
    return { decision: "blocked", summary: text.trim() };
  }
  if (lower.includes("pass") || lower.includes("success")) {
    return { decision: "pass", summary: text.trim() };
  }
  return { decision: "blocked", summary: `Verifier did not return a recognized decision: ${text.trim()}` };
}
