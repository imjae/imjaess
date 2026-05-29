import type { AgentRun, BrokerArtifact, ShellLog, TaskDetail, Verification } from "@/lib/types";

export type TaskOutcomeReasonKind =
  | "review_gate"
  | "waiting_for_user"
  | "needs_fix"
  | "blocked"
  | "canceled"
  | "agent_failed"
  | "shell_failed";

export type TaskOutcomeReasonTone = "info" | "warning" | "danger" | "success";

export type TaskOutcomeReason = {
  kind: TaskOutcomeReasonKind;
  source: "task" | "verifier" | "broker" | "agent" | "shell";
  summary: string;
  detail?: string;
  command?: string | null;
  exitCode?: number | null;
  tone: TaskOutcomeReasonTone;
};

function newestByCreatedAt<T extends { createdAt: string }>(items: T[]): T | null {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

function newestRun(items: AgentRun[]): AgentRun | null {
  return [...items].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
}

function firstText(...values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim()).find(Boolean) || "";
}

function latestArtifact(task: TaskDetail, kind: BrokerArtifact["kind"]): BrokerArtifact | null {
  return newestByCreatedAt(task.brokerArtifacts.filter((artifact) => artifact.kind === kind));
}

function latestVerification(task: TaskDetail, decisions?: Verification["decision"][]): Verification | null {
  const verifications = decisions
    ? task.verifications.filter((verification) => decisions.includes(verification.decision))
    : task.verifications;
  return newestByCreatedAt(verifications);
}

function latestFailedRun(task: TaskDetail): AgentRun | null {
  return newestRun(task.agentRuns.filter((run) => run.status === "failed" || run.error || run.timedOut));
}

function latestFailedShell(task: TaskDetail): ShellLog | null {
  return newestByCreatedAt(task.shellLogs.filter((log) => log.exitCode !== null && log.exitCode !== 0));
}

function fallbackFailureReason(task: TaskDetail): TaskOutcomeReason | null {
  const failedRun = latestFailedRun(task);
  if (failedRun) {
    return {
      kind: "agent_failed",
      source: "agent",
      summary: firstText(failedRun.error, failedRun.output, failedRun.timedOut ? "Agent run timed out." : null),
      detail: failedRun.output || failedRun.input,
      tone: "danger"
    };
  }

  const failedShell = latestFailedShell(task);
  if (failedShell) {
    return {
      kind: "shell_failed",
      source: "shell",
      summary: firstText(failedShell.stderr, failedShell.stdout, "Shell command failed."),
      detail: `PS ${failedShell.cwd}> ${failedShell.command}\n\nSTDOUT\n${failedShell.stdout}\n\nSTDERR\n${failedShell.stderr}`,
      command: failedShell.command,
      exitCode: failedShell.exitCode,
      tone: "danger"
    };
  }

  return null;
}

export function deriveTaskOutcomeReason(task: TaskDetail): TaskOutcomeReason | null {
  const finalBrief = latestArtifact(task, "final_brief");

  if (task.status === "ready_for_review") {
    const passVerification = latestVerification(task, ["pass"]);
    return {
      kind: "review_gate",
      source: passVerification ? "verifier" : "broker",
      summary: firstText(
        passVerification?.summary,
        finalBrief?.content,
        "Verification passed and the task is waiting for manual review."
      ),
      detail: finalBrief?.content,
      tone: "success"
    };
  }

  if (task.status === "waiting_for_user") {
    const plannerQuestions = latestArtifact(task, "plan_questions");
    return {
      kind: "waiting_for_user",
      source: plannerQuestions ? "broker" : "task",
      summary: firstText(plannerQuestions?.content, task.failureReason, "Planner is waiting for a user answer."),
      detail: plannerQuestions?.content,
      tone: "warning"
    };
  }

  if (task.status === "needs_fix") {
    const needsFixVerification = latestVerification(task, ["needs_fix"]);
    return {
      kind: "needs_fix",
      source: task.failureReason ? "task" : needsFixVerification ? "verifier" : finalBrief ? "broker" : "task",
      summary: firstText(task.failureReason, needsFixVerification?.summary, finalBrief?.content, "Verifier requested fixes."),
      detail: finalBrief?.content,
      tone: "warning"
    };
  }

  if (task.status === "blocked") {
    const blockedVerification = latestVerification(task, ["blocked", "needs_fix"]);
    const fallback = fallbackFailureReason(task);
    return {
      kind: "blocked",
      source: task.failureReason ? "task" : blockedVerification ? "verifier" : finalBrief ? "broker" : fallback?.source || "task",
      summary: firstText(task.failureReason, blockedVerification?.summary, finalBrief?.content, fallback?.summary, "Task was blocked."),
      detail: firstText(finalBrief?.content, fallback?.detail),
      command: blockedVerification?.command || fallback?.command,
      exitCode: blockedVerification?.exitCode ?? fallback?.exitCode,
      tone: "danger"
    };
  }

  if (task.status === "canceled") {
    return {
      kind: "canceled",
      source: "task",
      summary: firstText(task.failureReason, "Task was canceled."),
      tone: "danger"
    };
  }

  return null;
}
