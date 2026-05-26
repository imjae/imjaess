import path from "node:path";
import { createTask, getProjectByPath, getTaskDetail, upsertProject } from "@/lib/db";
import { enqueueTask } from "@/lib/worker";
import { taskReportMarkdown } from "@/lib/task-report";
import type { Task } from "@/lib/types";
import { normalizeVerificationCommand } from "@/lib/verification-command";

function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[follow-up parent context trimmed: ${text.length - max} chars omitted]`;
}

function followUpGoal(input: { message: string; parentReport: string }): string {
  return [
    input.message.trim(),
    "",
    "Parent task context summary follows. Treat it as background only; verify current repository state before editing.",
    "```md",
    clip(input.parentReport, 8000),
    "```"
  ].join("\n");
}

export function createFollowUpTask(input: {
  parentTaskId: string;
  message: string;
  approvalGrant: boolean;
  verificationCommand?: string;
  baseBranch?: string | null;
}): Task {
  const parent = getTaskDetail(input.parentTaskId);
  if (!parent) {
    throw new Error("Parent task not found.");
  }

  const targetProjectPath = path.resolve(parent.targetProjectPath);
  const verificationCommand = normalizeVerificationCommand(
    input.verificationCommand?.trim() || getProjectByPath(targetProjectPath)?.verificationCommand || null
  );
  upsertProject({
    path: targetProjectPath,
    verificationCommand: verificationCommand || null
  });

  const task = createTask({
    parentTaskId: parent.id,
    taskGroup: parent.taskGroup,
    taskTags: parent.tags,
    title: `Follow-up: ${parent.title}`,
    goal: followUpGoal({
      message: input.message,
      parentReport: taskReportMarkdown(parent)
    }),
    scope: parent.scope,
    targetProjectPath,
    baseBranch: input.baseBranch?.trim() || parent.baseBranch || null,
    agentPlan:
      "Follow-up task: use the parent task summary as background, verify repository state, then run isolated researcher/implementer/verifier roles.",
    planningMode: parent.planningMode,
    verificationMode: parent.verificationMode,
    approvalGrant: input.approvalGrant
  });

  if (task.approvalGrant) {
    enqueueTask(task.id);
  }

  return task;
}
