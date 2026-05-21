import type { TaskDetail } from "@/lib/types";

function fenced(text: string): string {
  return ["```", text.trim() || "(empty)", "```"].join("\n");
}

function lines(...items: Array<string | null | undefined | false>): string {
  return items.filter(Boolean).join("\n");
}

export function taskReportMarkdown(task: TaskDetail): string {
  const latestVerification = task.verifications.at(-1);
  const artifacts = task.brokerArtifacts
    .map((artifact) =>
      lines(
        `### ${artifact.kind} (${artifact.sourceRole}, round ${artifact.round})`,
        "",
        artifact.content,
        ""
      )
    )
    .join("\n");

  const verificationSection =
    task.verifications.length === 0
      ? "No verifier decisions recorded."
      : task.verifications
          .map((verification) =>
            lines(
              `### Round ${verification.round}: ${verification.decision}`,
              "",
              `Command: ${verification.command || "none"}`,
              `Exit code: ${verification.exitCode === null ? "n/a" : verification.exitCode}`,
              "",
              verification.summary,
              ""
            )
          )
          .join("\n");

  const agentSummary =
    task.agentRuns.length === 0
      ? "No agent runs recorded."
      : task.agentRuns
          .map(
            (run) =>
              `- ${run.role}: ${run.provider}/${run.model}, round ${run.round}, ${run.status}, input ${run.inputChars}, output ${run.outputChars}`
          )
          .join("\n");

  return lines(
    `# Task: ${task.title}`,
    "",
    `Status: ${task.status}`,
    `Decision: ${latestVerification?.decision || "n/a"}`,
    `Task ID: ${task.id}`,
    `Project: ${task.targetProjectPath}`,
    `Worktree: ${task.worktreePath || "n/a"}`,
    `Created: ${task.createdAt}`,
    `Updated: ${task.updatedAt}`,
    "",
    "## Goal",
    "",
    task.goal,
    "",
    "## Scope",
    "",
    task.scope || "(none)",
    "",
    "## Agent Runs",
    "",
    agentSummary,
    "",
    "## Broker Artifacts",
    "",
    artifacts || "No broker artifacts recorded.",
    "",
    "## Verification",
    "",
    verificationSection,
    "",
    task.failureReason ? lines("## Failure Reason", "", fenced(task.failureReason), "") : null
  );
}
