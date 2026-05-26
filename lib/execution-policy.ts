import type { AgentRole } from "@/lib/types";

export interface ExecutionPolicy {
  contextBudgetChars: number;
  outputBudgetChars: number;
  timeBudgetMs: number;
}

export interface ManagedPrompt {
  prompt: string;
  originalChars: number;
  promptChars: number;
  wasTrimmed: boolean;
}

export function executionPolicy(role?: AgentRole): ExecutionPolicy {
  return {
    contextBudgetChars: positiveInt(process.env.AGENT_CONTEXT_BUDGET_CHARS, 30_000),
    outputBudgetChars: positiveInt(process.env.AGENT_OUTPUT_BUDGET_CHARS, 8_000),
    timeBudgetMs:
      role === "implementer"
        ? positiveInt(process.env.IMPLEMENTER_TIME_BUDGET_MS, 900_000)
        : positiveInt(process.env.AGENT_TIME_BUDGET_MS, 300_000)
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clipMiddle(text: string, maxChars: number): { text: string; wasTrimmed: boolean } {
  if (text.length <= maxChars) {
    return { text, wasTrimmed: false };
  }
  const headSize = Math.floor(maxChars * 0.58);
  const tailSize = Math.max(0, maxChars - headSize - 160);
  return {
    text: [
      text.slice(0, headSize),
      `\n\n[context trimmed: ${text.length - headSize - tailSize} chars removed]\n\n`,
      text.slice(text.length - tailSize)
    ].join(""),
    wasTrimmed: true
  };
}

export function buildManagedPrompt(input: {
  role: AgentRole;
  prompt: string;
  policy: ExecutionPolicy;
}): ManagedPrompt {
  const roleGuard = [
    "Execution management rules:",
    "- Treat this run as a short sub-agent slice, not an open-ended session.",
    "- Stay inside your assigned role and do not redo other agents' work.",
    "- Read or execute only what is necessary for this slice.",
    "- Prefer concise handoff summaries over long logs or full file dumps.",
    "- End with a HANDOFF SUMMARY section: result, evidence, remaining risks, next action.",
    input.role === "researcher"
      ? "- Produce facts, paths, commands, and evidence only. Do not propose implementation code unless asked."
      : "",
    input.role === "planner"
      ? "- Turn evidence into concise questions and an implementation plan. Do not edit files."
      : "",
    input.role === "implementer"
      ? "- Implement from the broker-provided evidence only. Do not assume hidden tester behavior."
      : "",
    input.role === "tester"
      ? "- Test independently from the implementation intent. Use only the task spec, diff summary, and broker test brief."
      : "",
    input.role === "verifier"
      ? '- Return final JSON only after considering broker artifacts, diff summary, and test evidence: {"decision":"pass|needs_fix|blocked","summary":"..."}'
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  const availableChars = Math.max(1_000, input.policy.contextBudgetChars - roleGuard.length - 2);
  const clipped = clipMiddle(input.prompt, availableChars);
  const prompt = `${roleGuard}\n\n${clipped.text}`;
  return {
    prompt,
    originalChars: input.prompt.length,
    promptChars: prompt.length,
    wasTrimmed: clipped.wasTrimmed
  };
}

export function compactHandoff(text: string, policy: ExecutionPolicy): string {
  return clipMiddle(text.trim(), policy.outputBudgetChars).text;
}

export async function withAgentTimeout<T>(promise: Promise<T>, timeBudgetMs: number, onTimeout?: () => void): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Agent slice exceeded ${timeBudgetMs}ms time budget.`));
    }, timeBudgetMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
