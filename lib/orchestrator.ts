import path from "node:path";
import {
  createAgentRun,
  createTaskRun,
  finishAgentRun,
  finishTaskRun,
  getBrokerArtifact,
  getProjectByPath,
  getTask,
  insertBrokerArtifact,
  insertVerification,
  listConventionNotes,
  listTaskAttachments,
  updateTask,
  upsertProject
} from "@/lib/db";
import { maxAgentRounds, modelFor, providerFor, reasoningEffortFor, serviceTierFor } from "@/lib/config";
import { runAgent } from "@/lib/agents";
import { commitWorkspaceChanges, createAgentWorkspace, createOrUpdateReviewBranch, getDiffSummary } from "@/lib/git";
import { runShell } from "@/lib/shell";
import type { ShellResult } from "@/lib/shell";
import { parseVerifierDecision } from "@/lib/decision";
import {
  contractHasFailedCriteria,
  createEvidenceContract,
  formatBrokerArtifactForHandoff,
  summarizeText
} from "@/lib/evidence-contract";
import type { EvidenceContract, EvidenceContractCriterion } from "@/lib/evidence-contract";
import type { AgentRole, BrokerArtifact, Task, VerificationDecision } from "@/lib/types";
import { buildManagedPrompt, compactHandoff, executionPolicy, withAgentTimeout } from "@/lib/execution-policy";
import { buildScopeReferenceContext } from "@/lib/scope-references";
import {
  isUnityDotnetVerificationCommand,
  normalizeVerificationCommand,
  verificationTimeoutMs
} from "@/lib/verification-command";
import {
  formatUnityDotnetBootstrapResult,
  prepareUnityDotnetVerificationWorkspace
} from "@/lib/unity-dotnet-bootstrap";
import { cleanupSingleTaskWorktrees, cleanupSpecificWorktree } from "@/lib/worktree-cleanup";

function defaultAgentPlan(): string {
  return [
    "1. Researcher collects isolated evidence and repository facts.",
    "2. Plan mode inserts a Planner that asks the user clarifying questions before implementation.",
    "3. Implementer changes code using only broker evidence and the approved plan brief.",
    "4. Verifier decides pass, needs_fix, or blocked from broker artifacts, diff summary, and optional test evidence.",
    "5. Balanced verification mode inserts an independent Tester before Verifier."
  ].join("\n");
}

class TaskCanceledError extends Error {
  constructor() {
    super("Task was canceled by the user.");
    this.name = "TaskCanceledError";
  }
}

function assertNotCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TaskCanceledError();
  }
}

function isCancellationError(error: unknown): boolean {
  if (error instanceof TaskCanceledError) {
    return true;
  }
  const maybe = error as { name?: unknown; code?: unknown; message?: unknown };
  const message = typeof maybe.message === "string" ? maybe.message : "";
  return maybe.name === "AbortError" || maybe.code === "ABORT_ERR" || /aborted|canceled by the user/i.test(message);
}

function taskBrief(task: Task, round: number, brokerBrief: string, scopeReferenceContext = ""): string {
  return [
    `Task: ${task.title}`,
    `Goal: ${task.goal}`,
    `Scope: ${task.scope}`,
    scopeReferenceContext,
    `Target project: ${task.targetProjectPath}`,
    task.baseBranch ? `Base branch: ${task.baseBranch}` : "",
    `Agent plan:\n${task.agentPlan || defaultAgentPlan()}`,
    `Round: ${round}`,
    brokerBrief ? `Prior broker brief:\n${brokerBrief}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function conventionRuleBrief(projectPath: string, ruleTarget: "research_planning" | "implementation"): string {
  const notes = listConventionNotes(path.resolve(projectPath)).filter((note) => note.ruleTarget === ruleTarget);
  if (notes.length === 0) {
    return "";
  }
  const title =
    ruleTarget === "research_planning"
      ? "Research and planning rules for this project"
      : "Implementation rules for this project";
  return [
    title,
    ...notes.map((note, index) =>
      [
        `${index + 1}. [${note.category} / ${note.confidence}] ${note.rule}`,
        note.reason ? `   Reason: ${note.reason}` : "",
        note.examples ? `   Examples: ${note.examples}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
  ].join("\n");
}

function extractTaggedSection(text: string, tag: "EVIDENCE_PACK" | "PLAN_QUESTIONS"): string {
  const pattern = new RegExp(`<<${tag}>>([\\s\\S]*?)<</${tag}>>`, "i");
  return text.match(pattern)?.[1]?.trim() || "";
}

function splitResearchPlanningOutput(output: string): { evidence: string; planQuestions: string } {
  const evidence = extractTaggedSection(output, "EVIDENCE_PACK");
  const planQuestions = extractTaggedSection(output, "PLAN_QUESTIONS");
  if (evidence || planQuestions) {
    return {
      evidence: evidence || output.trim(),
      planQuestions: planQuestions || output.trim()
    };
  }
  return {
    evidence: output.trim(),
    planQuestions: output.trim()
  };
}

function brokerArtifact(input: {
  taskId: string;
  round: number;
  sourceRole: Parameters<typeof insertBrokerArtifact>[0]["sourceRole"];
  kind: Parameters<typeof insertBrokerArtifact>[0]["kind"];
  content: string;
  contract?: EvidenceContract | null;
}): string {
  const content = compactHandoff(input.content, executionPolicy());
  const artifact = insertBrokerArtifact({
    ...input,
    content
  });
  return formatBrokerArtifactForHandoff(artifact);
}

function brokerArtifactHandoff(artifact?: BrokerArtifact | null): string {
  return artifact ? formatBrokerArtifactForHandoff(artifact) : "";
}

function evidenceReference(id: string, type: EvidenceContract["evidence"][number]["type"], reference: string, excerpt?: string) {
  return {
    id,
    type,
    reference,
    ...(excerpt ? { excerpt } : {})
  };
}

function changedFilesFromDiffSummary(diffSummary: string): string[] {
  const files = new Set<string>();
  for (const line of diffSummary.split(/\r?\n/)) {
    const match = line.match(/^(?:diff --git a\/.* b\/|[MADRCU?]{1,2}\s+)(.+)$/);
    if (match?.[1]) {
      files.add(match[1].trim());
    }
  }
  return [...files];
}

function commandCriterion(commandResult: ShellResult | null): EvidenceContractCriterion {
  if (!commandResult) {
    return {
      criterion: "No explicit verification command was configured.",
      status: "unknown",
      evidenceIds: [],
      notes: "Verifier must judge from broker artifacts and diff evidence."
    };
  }
  return {
    criterion: `Verification command succeeds: ${commandResult.command}`,
    status: commandResult.exitCode === 0 ? "pass" : "fail",
    evidenceIds: ["command-1"],
    notes: `Exit code: ${commandResult.exitCode ?? "signal"}`
  };
}

function decisionCriterion(decision: VerificationDecision): EvidenceContractCriterion {
  return {
    criterion: "Verifier returned a valid final decision.",
    status: decision === "blocked" ? "fail" : decision === "needs_fix" ? "unknown" : "pass",
    evidenceIds: ["verifier-output"],
    notes: decision
  };
}

function buildResearchContract(kind: BrokerArtifact["kind"], content: string): EvidenceContract {
  return createEvidenceContract({
    kind,
    summary: summarizeText(content, "Research evidence was packaged."),
    claims: [
      {
        id: "claim-1",
        text: "Research findings are available as broker-scoped evidence for the next role.",
        confidence: "medium",
        evidenceIds: ["artifact-1"]
      }
    ],
    evidence: [evidenceReference("artifact-1", "artifact", `${kind} broker artifact`, content)],
    unverifiedAssumptions: [],
    residualRisks: ["The broker did not independently re-run every researcher observation."],
    acceptanceCriteriaStatus: [
      {
        criterion: "Research output was reduced to broker handoff form.",
        status: "pass",
        evidenceIds: ["artifact-1"]
      }
    ]
  });
}

function buildPlanContract(kind: BrokerArtifact["kind"], content: string): EvidenceContract {
  return createEvidenceContract({
    kind,
    summary: summarizeText(content, "Planning artifact was packaged."),
    claims: [
      {
        id: "claim-1",
        text: "Planning handoff is available for implementation.",
        confidence: "medium",
        evidenceIds: ["artifact-1"]
      }
    ],
    evidence: [evidenceReference("artifact-1", "artifact", `${kind} broker artifact`, content)],
    unverifiedAssumptions: [],
    residualRisks: [],
    acceptanceCriteriaStatus: [
      {
        criterion: "Planner/user handoff was captured.",
        status: "pass",
        evidenceIds: ["artifact-1"]
      }
    ]
  });
}

function buildImplementationContract(input: {
  content: string;
  diffSummary: string;
  implementationRef: string;
  filesTouched: string[];
  commandResult: ShellResult | null;
}): EvidenceContract {
  return createEvidenceContract({
    kind: "implementation_brief",
    summary: summarizeText(input.content, "Implementation evidence was packaged."),
    claims: [
      {
        id: "claim-1",
        text: "Implementation changes were summarized from the committed worktree diff.",
        confidence: "high",
        evidenceIds: ["diff-1"]
      },
      {
        id: "claim-2",
        text: "Shell verification status is available to downstream verification.",
        confidence: input.commandResult ? "high" : "low",
        evidenceIds: input.commandResult ? ["command-1"] : []
      }
    ],
    evidence: [
      evidenceReference("diff-1", "diff", `Implementation ref: ${input.implementationRef}`, input.diffSummary),
      ...(input.commandResult
        ? [
            evidenceReference(
              "command-1",
              "command",
              input.commandResult.command,
              `Exit code: ${input.commandResult.exitCode ?? "signal"}`
            )
          ]
        : [])
    ],
    filesTouched: input.filesTouched,
    commandsRun: input.commandResult
      ? [
          {
            command: input.commandResult.command,
            cwd: input.commandResult.cwd,
            exitCode: input.commandResult.exitCode,
            purpose: "Configured verification command."
          }
        ]
      : [],
    unverifiedAssumptions: input.commandResult ? [] : ["No explicit verification command was configured for this task."],
    residualRisks: input.commandResult?.exitCode === 0 ? [] : ["Verifier must decide whether remaining evidence is sufficient."],
    acceptanceCriteriaStatus: [
      {
        criterion: "Implementation diff was captured.",
        status: "pass",
        evidenceIds: ["diff-1"]
      },
      commandCriterion(input.commandResult)
    ]
  });
}

function buildTestContract(content: string): EvidenceContract {
  return createEvidenceContract({
    kind: "test_result",
    summary: summarizeText(content, "Tester evidence was packaged."),
    claims: [
      {
        id: "claim-1",
        text: "Independent tester result is available to the verifier.",
        confidence: "medium",
        evidenceIds: ["tester-output"]
      }
    ],
    evidence: [evidenceReference("tester-output", "test", "tester broker artifact", content)],
    unverifiedAssumptions: [],
    residualRisks: ["Tester output is model-generated and should be checked against deterministic command evidence when available."],
    acceptanceCriteriaStatus: [
      {
        criterion: "Tester produced a broker-scoped result.",
        status: "pass",
        evidenceIds: ["tester-output"]
      }
    ]
  });
}

function buildFinalContract(input: {
  content: string;
  decision: VerificationDecision;
  commandResult: ShellResult | null;
}): EvidenceContract {
  return createEvidenceContract({
    kind: "final_brief",
    summary: summarizeText(input.content, "Verifier final brief was packaged."),
    claims: [
      {
        id: "claim-1",
        text: `Verifier decision is ${input.decision}.`,
        confidence: "high",
        evidenceIds: ["verifier-output"]
      }
    ],
    evidence: [
      evidenceReference("verifier-output", "artifact", "verifier output", input.content),
      ...(input.commandResult
        ? [
            evidenceReference(
              "command-1",
              "command",
              input.commandResult.command,
              `Exit code: ${input.commandResult.exitCode ?? "signal"}`
            )
          ]
        : [])
    ],
    commandsRun: input.commandResult
      ? [
          {
            command: input.commandResult.command,
            cwd: input.commandResult.cwd,
            exitCode: input.commandResult.exitCode,
            purpose: "Final verification evidence."
          }
        ]
      : [],
    unverifiedAssumptions: input.commandResult ? [] : ["No explicit verification command was configured for this task."],
    residualRisks: input.decision === "pass" ? [] : [input.content],
    acceptanceCriteriaStatus: [decisionCriterion(input.decision), commandCriterion(input.commandResult)]
  });
}

async function runRole(input: {
  task: Task;
  role: AgentRole;
  round: number;
  prompt: string;
  workspacePath: string;
  branchName?: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  assertNotCanceled(input.signal);
  const model = modelFor(input.role);
  const provider = providerFor(input.role);
  const reasoningEffort = reasoningEffortFor(input.role);
  const serviceTier = serviceTierFor(input.role);
  const attachmentPaths = listTaskAttachments(input.task.id).map((attachment) => attachment.storedPath);
  const policy = executionPolicy(input.role);
  const managed = buildManagedPrompt({
    role: input.role,
    prompt: input.prompt,
    policy
  });
  const agentRunId = createAgentRun({
    taskId: input.task.id,
    role: input.role,
    provider,
    model,
    reasoningEffort,
    serviceTier,
    round: input.round,
    prompt: managed.prompt,
    contextBudgetChars: policy.contextBudgetChars,
    timeBudgetMs: policy.timeBudgetMs,
    inputChars: managed.promptChars,
    wasTrimmed: managed.wasTrimmed,
    workspacePath: input.workspacePath,
    branchName: input.branchName || null
  });

  let abortFromParent: (() => void) | null = null;
  try {
    const abortController = new AbortController();
    abortFromParent = () => abortController.abort();
    if (input.signal?.aborted) {
      abortController.abort();
    } else {
      input.signal?.addEventListener("abort", abortFromParent, { once: true });
    }
    const output = await withAgentTimeout(
      runAgent({
        role: input.role,
        provider,
        model,
        reasoningEffort,
        serviceTier,
        prompt: managed.prompt,
        taskId: input.task.id,
        workspacePath: input.workspacePath,
        round: input.round,
        attachmentPaths,
        signal: abortController.signal
      }),
      policy.timeBudgetMs,
      () => abortController.abort()
    );
    input.signal?.removeEventListener("abort", abortFromParent);
    assertNotCanceled(input.signal);
    finishAgentRun(agentRunId, output);
    return output;
  } catch (error) {
    const canceled = isCancellationError(error) || input.signal?.aborted;
    const message = canceled ? "Task was canceled by the user." : error instanceof Error ? error.message : String(error);
    finishAgentRun(agentRunId, "", message, !canceled && message.includes("time budget"));
    if (canceled) {
      throw new TaskCanceledError();
    }
    throw error;
  } finally {
    if (abortFromParent) {
      input.signal?.removeEventListener("abort", abortFromParent);
    }
  }
}

export async function processTask(taskId: string, signal?: AbortSignal): Promise<void> {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (!task.approvalGrant) {
    updateTask(taskId, {
      status: "blocked",
      failureReason: "Task does not have a CLI approval grant."
    });
    return;
  }

  const taskRunId = createTaskRun(taskId);
  let finalStatus = "blocked";

  try {
    assertNotCanceled(signal);
    updateTask(taskId, { status: "running", failureReason: null });
    upsertProject({
      path: path.resolve(task.targetProjectPath),
      verificationCommand: getProjectByPath(path.resolve(task.targetProjectPath))?.verificationCommand || null
    });

    const projectPath = path.resolve(task.targetProjectPath);
    const project = getProjectByPath(projectPath);
    const savedVerificationCommand = project?.verificationCommand || null;
    const verificationCommand = normalizeVerificationCommand(savedVerificationCommand);
    if (verificationCommand !== (savedVerificationCommand?.trim() || "")) {
      upsertProject({
        path: projectPath,
        verificationCommand
      });
    }
    let brokerBrief = "";
    let implementationBaseRef = task.baseBranch || "HEAD";
    const rounds = maxAgentRounds();

    for (let round = 1; round <= rounds; round += 1) {
      assertNotCanceled(signal);
      updateTask(taskId, { status: "running", currentRound: round });
      const refreshedTask = getTask(taskId) || task;
      const existingEvidencePack = getBrokerArtifact(taskId, round, "evidence_pack");
      const isPlanModeFirstRound = refreshedTask.planningMode === "plan" && round === 1;
      const existingPlanBrief = isPlanModeFirstRound ? getBrokerArtifact(taskId, round, "plan_brief") : null;
      const existingPlanQuestions = isPlanModeFirstRound ? getBrokerArtifact(taskId, round, "plan_questions") : null;
      const planAnswer = isPlanModeFirstRound ? getBrokerArtifact(taskId, round, "plan_answer") : null;
      let planQuestions = brokerArtifactHandoff(existingPlanQuestions);
      const researchPlanningRules = conventionRuleBrief(projectPath, "research_planning");
      const implementationRules = conventionRuleBrief(projectPath, "implementation");
      const researcherWorkspace =
        existingEvidencePack || implementationBaseRef === "HEAD"
          ? {
              path: projectPath,
              kind: "direct" as const,
              branchName: null,
              warning: "Researcher uses the target project directly because this read-only stage does not need a worktree."
            }
          : await createAgentWorkspace({
              taskId,
              role: "researcher",
              round,
              targetProjectPath: task.targetProjectPath,
              baseRef: implementationBaseRef
            });
      const scopeReferenceContext = await buildScopeReferenceContext(task.scope, researcherWorkspace.path);
      let evidencePack = brokerArtifactHandoff(existingEvidencePack);
      if (!evidencePack) {
        const shouldCombineResearchAndPlanning = isPlanModeFirstRound && !existingPlanBrief && !planAnswer && !planQuestions;
        const researcherPrompt = shouldCombineResearchAndPlanning
          ? [
              taskBrief(refreshedTask, round, brokerBrief, scopeReferenceContext),
              `Your assigned workspace: ${researcherWorkspace.path}`,
              researcherWorkspace.branchName ? `Your branch: ${researcherWorkspace.branchName}` : "",
              researchPlanningRules ? `Apply these research/planning rules:\n${researchPlanningRules}` : "",
              "Plan mode uses one combined researcher/planner pass. First verify concrete repository evidence, then prepare only the user questions needed before implementation.",
              "Do not implement and do not test.",
              "Code-confirmable facts must be investigated directly instead of asked as questions.",
              "Limit questions to decisions that block implementation. Prefer at most 3 questions.",
              "Write the planner-facing content in Korean. Keep code identifiers, file paths, commands, branch names, and API names unchanged.",
              "Return exactly these tagged sections:",
              "<<EVIDENCE_PACK>>",
              "관련 파일, 실제 동작 흐름, 수정 후보, 제약, 확인한 명령/근거, 확인하지 못한 부분을 compact하게 정리합니다.",
              "<</EVIDENCE_PACK>>",
              "<<PLAN_QUESTIONS>>",
              "질문과 임시 구현 계획을 한국어로 정리합니다.",
              "<</PLAN_QUESTIONS>>"
            ]
              .filter(Boolean)
              .join("\n\n")
          : [
              taskBrief(refreshedTask, round, brokerBrief, scopeReferenceContext),
              `Your assigned workspace: ${researcherWorkspace.path}`,
              researcherWorkspace.branchName ? `Your branch: ${researcherWorkspace.branchName}` : "",
              researchPlanningRules ? `Apply these research/planning rules:\n${researchPlanningRules}` : "",
              "Collect only the facts needed for this task: relevant files, likely entry points, constraints, commands, and risks.",
              "Do not implement. Do not review another agent. End with evidence that the broker can pass to an implementer."
            ]
              .filter(Boolean)
              .join("\n\n");
        const researcherOutput = await runRole({
          task: refreshedTask,
          role: "researcher",
          round,
          prompt: researcherPrompt,
          workspacePath: researcherWorkspace.path,
          branchName: researcherWorkspace.branchName,
          signal
        });
        const researchPlanningOutput = splitResearchPlanningOutput(researcherOutput);
        evidencePack = brokerArtifact({
          taskId,
          round,
          sourceRole: "researcher",
          kind: "evidence_pack",
          content: [
            "BROKER EVIDENCE PACK",
            "This is the only researcher output visible to the implementer.",
            researchPlanningOutput.evidence
          ].join("\n\n"),
          contract: buildResearchContract(
            "evidence_pack",
            [
              "BROKER EVIDENCE PACK",
              "This is the only researcher output visible to the implementer.",
              researchPlanningOutput.evidence
            ].join("\n\n")
          )
        });
        if (shouldCombineResearchAndPlanning) {
          planQuestions = brokerArtifact({
            taskId,
            round,
            sourceRole: "researcher",
            kind: "plan_questions",
            content: [
              "브로커 조사/계획 질문",
              "Task가 사용자 답변을 기다리고 있습니다. 사용자 대기 시간은 agent 시간 예산에 포함하지 않습니다.",
              researchPlanningOutput.planQuestions
            ].join("\n\n"),
            contract: buildPlanContract(
              "plan_questions",
              [
                "Broker research/planning questions",
                "Task is waiting for user answers before implementation.",
                researchPlanningOutput.planQuestions
              ].join("\n\n")
            )
          });
        }
      }

      let planBrief = "";
      if (isPlanModeFirstRound) {
        planBrief = brokerArtifactHandoff(existingPlanBrief);
        if (!planBrief) {
          if (!planAnswer) {
            updateTask(taskId, { status: "reviewing" });
            if (!planQuestions) {
              planQuestions = brokerArtifact({
                taskId,
                round,
                sourceRole: "broker",
                kind: "plan_questions",
                content: [
                  "브로커 조사/계획 질문",
                  "Task가 사용자 답변을 기다리고 있습니다. 사용자 대기 시간은 agent 시간 예산에 포함하지 않습니다.",
                  "조사/계획 산출물이 질문 섹션을 분리하지 못했습니다. Evidence pack을 검토한 뒤 사용자 답변을 제출해 주세요.",
                  evidencePack
                ].join("\n\n"),
                contract: buildPlanContract(
                  "plan_questions",
                  [
                    "Broker research/planning questions",
                    "Task is waiting for user answers before implementation.",
                    evidencePack
                  ].join("\n\n")
                )
              });
            }
            updateTask(taskId, {
              status: "waiting_for_user",
              failureReason: "Planner가 구현 전에 사용자 답변을 기다리고 있습니다."
            });
            finalStatus = "waiting_for_user";
            return;
          }
          planBrief = brokerArtifact({
            taskId,
            round,
            sourceRole: "broker",
            kind: "plan_brief",
            content: [
              "브로커 구현 계획 요약",
              "이 내용은 implementer에게 전달되는 유일한 planning handoff입니다.",
              planQuestions ? `조사/계획 질문 및 임시 구현 계획:\n${planQuestions}` : "",
              `사용자 답변:\n${planAnswer.content}`
            ].join("\n\n")
          });
        }
      }

      const implementerWorkspace = await createAgentWorkspace({
        taskId,
        role: "implementer",
        round,
        targetProjectPath: task.targetProjectPath,
        baseRef: implementationBaseRef
      });
      assertNotCanceled(signal);
      updateTask(taskId, {
        worktreePath: implementerWorkspace.path,
        failureReason: implementerWorkspace.warning || null
      });
      const implementerPrompt = [
        taskBrief(refreshedTask, round, brokerBrief, scopeReferenceContext),
        `Your isolated implementation worktree: ${implementerWorkspace.path}`,
        implementerWorkspace.branchName ? `Your branch: ${implementerWorkspace.branchName}` : "",
        `Broker evidence pack:\n${evidencePack}`,
        planBrief ? `Broker plan brief:\n${planBrief}` : "",
        implementationRules ? `Apply these implementation rules:\n${implementationRules}` : "",
        "Implement only from the broker evidence pack, approved plan brief when present, and the task brief.",
        "Do not speculate about tester behavior. End with a concise private handoff summary for the broker."
      ]
        .filter(Boolean)
        .join("\n\n");
      await runRole({
        task: refreshedTask,
        role: "implementer",
        round,
        prompt: implementerPrompt,
        workspacePath: implementerWorkspace.path,
        branchName: implementerWorkspace.branchName,
        signal
      });
      assertNotCanceled(signal);

      const diffSummary = await getDiffSummary(implementerWorkspace.path);
      const implementationCommit = await commitWorkspaceChanges(
        implementerWorkspace.path,
        `Harness task ${taskId} implementer round ${round}`
      );
      implementationBaseRef = implementationCommit.ref;

      const isBalancedVerification = refreshedTask.verificationMode === "balanced";
      const testerWorkspace = isBalancedVerification
        ? await createAgentWorkspace({
            taskId,
            role: "tester",
            round,
            targetProjectPath: task.targetProjectPath,
            baseRef: implementationCommit.ref
          })
        : null;
      const commandWorkspace = testerWorkspace || implementerWorkspace;
      const verificationPreparation =
        verificationCommand && isUnityDotnetVerificationCommand(verificationCommand)
          ? await prepareUnityDotnetVerificationWorkspace({
              sourceProjectPath: projectPath,
              workspacePath: commandWorkspace.path,
              implementationRef: implementationCommit.ref,
              implementationCommitted: implementationCommit.committed
            })
          : null;
      assertNotCanceled(signal);
      const verificationPreparationSummary = verificationPreparation
        ? formatUnityDotnetBootstrapResult(verificationPreparation)
        : "";
      const commandResult = verificationCommand
        ? await runShell({
            taskId,
            agentRole: isBalancedVerification ? "tester" : "verifier",
            command: verificationCommand,
            cwd: commandWorkspace.path,
            workspacePath: commandWorkspace.path,
            timeoutMs: verificationTimeoutMs(verificationCommand),
            signal
          })
        : null;
      assertNotCanceled(signal);
      const filesTouched = changedFilesFromDiffSummary(diffSummary);
      const implementationBriefContent = [
        "BROKER IMPLEMENTATION BRIEF",
        "The tester does not receive implementer output or implementation intent.",
        `Implementer worktree: ${implementerWorkspace.path}`,
        implementerWorkspace.branchName ? `Implementer branch: ${implementerWorkspace.branchName}` : "",
        `Implementation ref: ${implementationCommit.ref}`,
        `Implementation commit: ${implementationCommit.summary}`,
        `Verification mode: ${isBalancedVerification ? "balanced" : "fast"}`,
        testerWorkspace ? `Tester worktree: ${testerWorkspace.path}` : `Verifier/shell workspace: ${commandWorkspace.path}`,
        testerWorkspace?.branchName ? `Tester branch: ${testerWorkspace.branchName}` : "",
        verificationPreparationSummary,
        `Diff summary:\n${diffSummary}`,
        commandResult
          ? `Verification command result:\nCommand: ${commandResult.command}\nExit code: ${commandResult.exitCode}`
          : "No verification command configured."
      ]
        .filter(Boolean)
        .join("\n\n");
      const implementationBrief = brokerArtifact({
        taskId,
        round,
        sourceRole: "broker",
        kind: "implementation_brief",
        content: implementationBriefContent,
        contract: buildImplementationContract({
          content: implementationBriefContent,
          diffSummary,
          implementationRef: implementationCommit.ref,
          filesTouched,
          commandResult
        })
      });

      let testResult = "";
      if (testerWorkspace) {
        const testerOutput = await runRole({
          task: refreshedTask,
          role: "tester",
          round,
          prompt: [
            taskBrief(refreshedTask, round, "", scopeReferenceContext),
            `Your isolated tester worktree: ${testerWorkspace.path}`,
            testerWorkspace.branchName ? `Your branch: ${testerWorkspace.branchName}` : "",
            `Broker implementation brief:\n${implementationBrief}`,
            "Test independently from implementation intent. Use run_shell if needed.",
            "Return what was tested, evidence, failures, and residual risk. Do not ask the implementer for clarification."
          ]
            .filter(Boolean)
            .join("\n\n"),
          workspacePath: testerWorkspace.path,
          branchName: testerWorkspace.branchName,
          signal
        });
        const testResultContent = ["BROKER TEST RESULT", "This is the only tester output visible to the verifier.", testerOutput].join(
          "\n\n"
        );
        testResult = brokerArtifact({
          taskId,
          round,
          sourceRole: "tester",
          kind: "test_result",
          content: testResultContent,
          contract: buildTestContract(testResultContent)
        });
      }

      updateTask(taskId, { status: "verifying" });
      const verifierWorkspace = implementerWorkspace;
      const verifierPrompt = [
        taskBrief(refreshedTask, round, brokerBrief, scopeReferenceContext),
        `Your assigned verifier workspace: ${verifierWorkspace.path}`,
        verifierWorkspace.branchName ? `Your branch: ${verifierWorkspace.branchName}` : "",
        "This verifier stage reuses the clean implementation worktree instead of creating another role worktree.",
        `Broker evidence pack:\n${evidencePack}`,
        `Broker implementation brief:\n${implementationBrief}`,
        testResult
          ? `Broker test result:\n${testResult}`
          : "No tester agent was run because verification mode is fast. Judge directly from evidence, implementation brief, diff summary, and optional shell evidence.",
        verificationPreparationSummary,
        commandResult
          ? `Verification command: ${commandResult.command}\nExit code: ${commandResult.exitCode}\nSTDOUT:\n${commandResult.stdout}\nSTDERR:\n${commandResult.stderr}`
          : "No verification command configured. Judge from agent outputs and diff summary.",
        'Return only JSON: {"decision":"pass|needs_fix|blocked","summary":"..."}'
      ]
        .filter(Boolean)
        .join("\n\n");
      const verifierOutput = await runRole({
        task: refreshedTask,
        role: "verifier",
        round,
        prompt: verifierPrompt,
        workspacePath: verifierWorkspace.path,
        branchName: verifierWorkspace.branchName,
        signal
      });
      assertNotCanceled(signal);
      let parsed = parseVerifierDecision(verifierOutput);
      let finalContract = buildFinalContract({
        content: parsed.summary,
        decision: parsed.decision,
        commandResult
      });
      if (parsed.decision === "pass" && contractHasFailedCriteria(finalContract)) {
        parsed = {
          decision: "needs_fix",
          summary: [
            "Verifier pass was downgraded by the evidence contract guardrail.",
            "At least one acceptance criterion failed, usually a failed verification command.",
            parsed.summary
          ].join("\n")
        };
        finalContract = buildFinalContract({
          content: parsed.summary,
          decision: parsed.decision,
          commandResult
        });
      }
      if (testerWorkspace) {
        await cleanupSpecificWorktree({
          targetProjectPath: task.targetProjectPath,
          worktreePath: testerWorkspace.path,
          branchName: testerWorkspace.branchName
        });
      }
      insertVerification({
        taskId,
        round,
        decision: parsed.decision,
        summary: parsed.summary,
        command: commandResult?.command || null,
        exitCode: commandResult?.exitCode ?? null
      });

      if (parsed.decision === "pass") {
        const reviewBranch = await createOrUpdateReviewBranch({
          targetProjectPath: task.targetProjectPath,
          sourceRef: implementerWorkspace.branchName || implementationCommit.ref,
          taskId
        });
        updateTask(taskId, { status: "ready_for_review", failureReason: null, worktreePath: projectPath });
        brokerArtifact({
          taskId,
          round,
          sourceRole: "verifier",
          kind: "final_brief",
          content: [
            parsed.summary,
            "",
            "READY FOR REVIEW",
            `Branch: ${reviewBranch.branchName}`,
            `Implementation ref: ${implementationCommit.ref}`,
            `Review ref: ${reviewBranch.ref}`,
            reviewBranch.checkoutCommand ? `Checkout: ${reviewBranch.checkoutCommand}` : "",
            reviewBranch.output
          ].join("\n"),
          contract: finalContract
        });
        await cleanupSingleTaskWorktrees({
          task: {
            ...refreshedTask,
            status: "ready_for_review"
          }
        });
        finalStatus = "ready_for_review";
        return;
      }
      brokerBrief = brokerArtifact({
        taskId,
        round,
        sourceRole: "verifier",
        kind: "final_brief",
        content: parsed.summary,
        contract: finalContract
      });
      if (parsed.decision === "blocked" || round === rounds) {
        updateTask(taskId, {
          status: "blocked",
          failureReason: parsed.summary || "Verifier blocked the task."
        });
        finalStatus = "blocked";
        return;
      }
      updateTask(taskId, {
        status: "needs_fix",
        failureReason: parsed.summary
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCancellationError(error) || signal?.aborted) {
      updateTask(taskId, {
        status: "canceled",
        failureReason: "Task was canceled by the user."
      });
      finalStatus = "canceled";
      return;
    }
    updateTask(taskId, {
      status: "blocked",
      failureReason: message
    });
    finalStatus = "blocked";
  } finally {
    finishTaskRun(taskRunId, finalStatus);
  }
}
