import type { TaskDetail } from "@/lib/types";

export type TaskReportLanguage = "en" | "ko";

const REPORT_TEXT = {
  en: {
    task: "Task",
    status: "Status",
    decision: "Decision",
    taskId: "Task ID",
    group: "Group",
    ungrouped: "Ungrouped",
    project: "Project",
    worktree: "Worktree",
    created: "Created",
    updated: "Updated",
    goal: "Goal",
    scope: "Scope",
    none: "none",
    attachments: "Attachments",
    noAttachments: "No attachments recorded.",
    agentRuns: "Agent Runs",
    noAgentRuns: "No agent runs recorded.",
    brokerArtifacts: "Broker Artifacts",
    noBrokerArtifacts: "No broker artifacts recorded.",
    verification: "Verification",
    noVerifierDecisions: "No verifier decisions recorded.",
    command: "Command",
    exitCode: "Exit code",
    round: "Round",
    failureReason: "Failure Reason",
    empty: "empty",
    bytes: "bytes",
    input: "input",
    output: "output"
  },
  ko: {
    task: "Task",
    status: "상태",
    decision: "판정",
    taskId: "Task ID",
    group: "그룹",
    ungrouped: "그룹 없음",
    project: "프로젝트",
    worktree: "Worktree",
    created: "생성",
    updated: "수정",
    goal: "목표",
    scope: "범위",
    none: "없음",
    attachments: "첨부 이미지",
    noAttachments: "기록된 첨부 이미지가 없습니다.",
    agentRuns: "Agent 실행",
    noAgentRuns: "기록된 agent 실행이 없습니다.",
    brokerArtifacts: "브로커 산출물",
    noBrokerArtifacts: "기록된 브로커 산출물이 없습니다.",
    verification: "검증",
    noVerifierDecisions: "기록된 verifier 판정이 없습니다.",
    command: "명령",
    exitCode: "종료 코드",
    round: "라운드",
    failureReason: "실패 이유",
    empty: "비어 있음",
    bytes: "bytes",
    input: "입력",
    output: "출력"
  }
} as const;

function rt(language: TaskReportLanguage, key: keyof typeof REPORT_TEXT.en): string {
  return REPORT_TEXT[language][key] || REPORT_TEXT.en[key];
}

function fenced(text: string): string {
  return ["```", text.trim() || "(empty)", "```"].join("\n");
}

function lines(...items: Array<string | null | undefined | false>): string {
  return items.filter(Boolean).join("\n");
}

export function taskReportMarkdown(
  task: TaskDetail,
  options: { language?: TaskReportLanguage } = {}
): string {
  const language = options.language || "en";
  const latestVerification = task.verifications.at(-1);
  const artifacts = task.brokerArtifacts
    .map((artifact) =>
      lines(
        `### ${artifact.kind} (${artifact.sourceRole}, ${rt(language, "round")} ${artifact.round})`,
        "",
        artifact.content,
        ""
      )
    )
    .join("\n");

  const verificationSection =
    task.verifications.length === 0
      ? rt(language, "noVerifierDecisions")
      : task.verifications
          .map((verification) =>
            lines(
              `### ${rt(language, "round")} ${verification.round}: ${verification.decision}`,
              "",
              `${rt(language, "command")}: ${verification.command || rt(language, "none")}`,
              `${rt(language, "exitCode")}: ${verification.exitCode === null ? "n/a" : verification.exitCode}`,
              "",
              verification.summary,
              ""
            )
          )
          .join("\n");

  const agentSummary =
    task.agentRuns.length === 0
      ? rt(language, "noAgentRuns")
      : task.agentRuns
          .map(
            (run) =>
              `- ${run.role}: ${run.provider}/${run.model}, ${rt(language, "round")} ${run.round}, ${run.status}, ${rt(
                language,
                "input"
              )} ${run.inputChars}, ${rt(language, "output")} ${run.outputChars}`
          )
          .join("\n");

  const attachmentSummary =
    task.attachments.length === 0
      ? rt(language, "noAttachments")
      : task.attachments
          .map(
            (attachment) =>
              `- ${attachment.originalName}: ${attachment.mimeType}, ${attachment.sizeBytes} ${rt(language, "bytes")}, id ${
                attachment.id
              }`
          )
          .join("\n");

  return lines(
    `# ${rt(language, "task")}: ${task.title}`,
    "",
    `${rt(language, "status")}: ${task.status}`,
    `${rt(language, "decision")}: ${latestVerification?.decision || "n/a"}`,
    `${rt(language, "taskId")}: ${task.id}`,
    `${rt(language, "group")}: ${task.taskGroup || rt(language, "ungrouped")}`,
    `${rt(language, "project")}: ${task.targetProjectPath}`,
    `${rt(language, "worktree")}: ${task.worktreePath || "n/a"}`,
    `${rt(language, "created")}: ${task.createdAt}`,
    `${rt(language, "updated")}: ${task.updatedAt}`,
    "",
    `## ${rt(language, "goal")}`,
    "",
    task.goal,
    "",
    `## ${rt(language, "scope")}`,
    "",
    task.scope || `(${rt(language, "none")})`,
    "",
    `## ${rt(language, "attachments")}`,
    "",
    attachmentSummary,
    "",
    `## ${rt(language, "agentRuns")}`,
    "",
    agentSummary,
    "",
    `## ${rt(language, "brokerArtifacts")}`,
    "",
    artifacts || rt(language, "noBrokerArtifacts"),
    "",
    `## ${rt(language, "verification")}`,
    "",
    verificationSection,
    "",
    task.failureReason ? lines(`## ${rt(language, "failureReason")}`, "", fenced(task.failureReason), "") : null
  );
}
