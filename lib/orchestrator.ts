import path from "node:path";
import {
  createAgentRun,
  createTaskRun,
  finishAgentRun,
  finishTaskRun,
  getProjectByPath,
  getTask,
  insertBrokerArtifact,
  insertVerification,
  updateTask,
  upsertProject
} from "@/lib/db";
import { maxAgentRounds, modelFor, providerFor } from "@/lib/config";
import { runAgent } from "@/lib/agents";
import { createTaskWorkspace, getDiffSummary } from "@/lib/git";
import { runShell } from "@/lib/shell";
import { parseVerifierDecision } from "@/lib/decision";
import type { AgentRole, Task } from "@/lib/types";
import { buildManagedPrompt, compactHandoff, executionPolicy, withAgentTimeout } from "@/lib/execution-policy";
import { buildScopeReferenceContext } from "@/lib/scope-references";

function defaultAgentPlan(): string {
  return [
    "1. Researcher collects isolated evidence and repository facts.",
    "2. Implementer changes code using only the broker evidence pack.",
    "3. Tester validates independently from implementation intent.",
    "4. Verifier decides pass, needs_fix, or blocked from broker artifacts and test evidence."
  ].join("\n");
}

function taskBrief(task: Task, round: number, brokerBrief: string, scopeReferenceContext = ""): string {
  return [
    `Task: ${task.title}`,
    `Goal: ${task.goal}`,
    `Scope: ${task.scope}`,
    scopeReferenceContext,
    `Target project: ${task.targetProjectPath}`,
    `Agent plan:\n${task.agentPlan || defaultAgentPlan()}`,
    `Round: ${round}`,
    brokerBrief ? `Prior broker brief:\n${brokerBrief}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function brokerArtifact(input: {
  taskId: string;
  round: number;
  sourceRole: Parameters<typeof insertBrokerArtifact>[0]["sourceRole"];
  kind: Parameters<typeof insertBrokerArtifact>[0]["kind"];
  content: string;
}): string {
  const content = compactHandoff(input.content, executionPolicy());
  insertBrokerArtifact({
    ...input,
    content
  });
  return content;
}

async function runRole(input: {
  task: Task;
  role: AgentRole;
  round: number;
  prompt: string;
  workspacePath: string;
}): Promise<string> {
  const model = modelFor(input.role);
  const provider = providerFor(input.role);
  const policy = executionPolicy();
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
    round: input.round,
    prompt: managed.prompt,
    contextBudgetChars: policy.contextBudgetChars,
    timeBudgetMs: policy.timeBudgetMs,
    inputChars: managed.promptChars,
    wasTrimmed: managed.wasTrimmed
  });

  try {
    const output = await withAgentTimeout(
      runAgent({
        role: input.role,
        provider,
        model,
        prompt: managed.prompt,
        taskId: input.task.id,
        workspacePath: input.workspacePath,
        round: input.round
      }),
      policy.timeBudgetMs
    );
    finishAgentRun(agentRunId, output);
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishAgentRun(agentRunId, "", message, message.includes("time budget"));
    throw error;
  }
}

export async function processTask(taskId: string): Promise<void> {
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
    updateTask(taskId, { status: "running", failureReason: null });
    upsertProject({
      path: path.resolve(task.targetProjectPath),
      verificationCommand: getProjectByPath(path.resolve(task.targetProjectPath))?.verificationCommand || null
    });

    const workspace = await createTaskWorkspace(task.id, task.targetProjectPath);
    updateTask(taskId, {
      worktreePath: workspace.path,
      failureReason: workspace.warning || null
    });

    const scopeReferenceContext = await buildScopeReferenceContext(task.scope, workspace.path);
    const project = getProjectByPath(path.resolve(task.targetProjectPath));
    const verificationCommand = project?.verificationCommand || null;
    let brokerBrief = workspace.warning || "";
    const rounds = maxAgentRounds();

    for (let round = 1; round <= rounds; round += 1) {
      updateTask(taskId, { status: "running", currentRound: round });
      const refreshedTask = getTask(taskId) || task;
      const researcherPrompt = [
        taskBrief(refreshedTask, round, brokerBrief, scopeReferenceContext),
        "Collect only the facts needed for this task: relevant files, likely entry points, constraints, commands, and risks.",
        "Do not implement. Do not review another agent. End with evidence that the broker can pass to an implementer."
      ].join("\n\n");
      const researcherOutput = await runRole({
        task: refreshedTask,
        role: "researcher",
        round,
        prompt: researcherPrompt,
        workspacePath: workspace.path
      });
      const evidencePack = brokerArtifact({
        taskId,
        round,
        sourceRole: "researcher",
        kind: "evidence_pack",
        content: [
          "BROKER EVIDENCE PACK",
          "This is the only researcher output visible to the implementer.",
          researcherOutput
        ].join("\n\n")
      });

      const implementerPrompt = [
        taskBrief(refreshedTask, round, brokerBrief, scopeReferenceContext),
        `Broker evidence pack:\n${evidencePack}`,
        "Implement only from the broker evidence pack and the task brief.",
        "Do not speculate about tester behavior. End with a concise private handoff summary for the broker."
      ].join("\n\n");
      await runRole({
        task: refreshedTask,
        role: "implementer",
        round,
        prompt: implementerPrompt,
        workspacePath: workspace.path
      });

      const diffSummary = await getDiffSummary(workspace.path);
      const commandResult = verificationCommand
        ? await runShell({
            taskId,
            agentRole: "verifier",
            command: verificationCommand,
            cwd: workspace.path,
            workspacePath: workspace.path,
            timeoutMs: 180_000
          })
        : null;
      const implementationBrief = brokerArtifact({
        taskId,
        round,
        sourceRole: "broker",
        kind: "implementation_brief",
        content: [
          "BROKER IMPLEMENTATION BRIEF",
          "The tester does not receive implementer output or implementation intent.",
          `Diff summary:\n${diffSummary}`,
          commandResult
            ? `Verification command result:\nCommand: ${commandResult.command}\nExit code: ${commandResult.exitCode}`
            : "No verification command configured."
        ].join("\n\n")
      });

      const testerPrompt = [
        taskBrief(refreshedTask, round, "", scopeReferenceContext),
        `Broker implementation brief:\n${implementationBrief}`,
        "Test independently from implementation intent. Use run_shell if needed.",
        "Return what was tested, evidence, failures, and residual risk. Do not ask the implementer for clarification."
      ].join("\n\n");
      const testerOutput = await runRole({
        task: refreshedTask,
        role: "tester",
        round,
        prompt: testerPrompt,
        workspacePath: workspace.path
      });
      const testResult = brokerArtifact({
        taskId,
        round,
        sourceRole: "tester",
        kind: "test_result",
        content: [
          "BROKER TEST RESULT",
          "This is the only tester output visible to the verifier.",
          testerOutput
        ].join("\n\n")
      });

      updateTask(taskId, { status: "verifying" });
      const verifierPrompt = [
        taskBrief(refreshedTask, round, brokerBrief, scopeReferenceContext),
        `Broker evidence pack:\n${evidencePack}`,
        `Broker implementation brief:\n${implementationBrief}`,
        `Broker test result:\n${testResult}`,
        commandResult
          ? `Verification command: ${commandResult.command}\nExit code: ${commandResult.exitCode}\nSTDOUT:\n${commandResult.stdout}\nSTDERR:\n${commandResult.stderr}`
          : "No verification command configured. Judge from agent outputs and diff summary.",
        'Return only JSON: {"decision":"pass|needs_fix|blocked","summary":"..."}'
      ].join("\n\n");
      const verifierOutput = await runRole({
        task: refreshedTask,
        role: "verifier",
        round,
        prompt: verifierPrompt,
        workspacePath: workspace.path
      });
      const parsed = parseVerifierDecision(verifierOutput);
      insertVerification({
        taskId,
        round,
        decision: parsed.decision,
        summary: parsed.summary,
        command: commandResult?.command || null,
        exitCode: commandResult?.exitCode ?? null
      });

      if (parsed.decision === "pass") {
        updateTask(taskId, { status: "done", failureReason: null });
        brokerArtifact({
          taskId,
          round,
          sourceRole: "verifier",
          kind: "final_brief",
          content: parsed.summary
        });
        finalStatus = "done";
        return;
      }
      brokerBrief = brokerArtifact({
        taskId,
        round,
        sourceRole: "verifier",
        kind: "final_brief",
        content: parsed.summary
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
    updateTask(taskId, {
      status: "blocked",
      failureReason: message
    });
    finalStatus = "blocked";
  } finally {
    finishTaskRun(taskRunId, finalStatus);
  }
}
