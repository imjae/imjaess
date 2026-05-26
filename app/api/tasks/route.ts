import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createTask, listTaskGroups, listTaskTags, listTasks, upsertProject } from "@/lib/db";
import { enqueueTask } from "@/lib/worker";
import { normalizeVerificationCommand } from "@/lib/verification-command";

export const dynamic = "force-dynamic";

const createTaskSchema = z.object({
  title: z.string().min(1),
  taskGroup: z.string().optional().default(""),
  taskTags: z.array(z.string()).optional().default([]),
  goal: z.string().min(1),
  scope: z.string().optional().default(""),
  targetProjectPath: z.string().min(1),
  agentPlan: z.string().optional().default(""),
  planningMode: z.enum(["direct", "plan"]).optional().default("direct"),
  verificationMode: z.enum(["fast", "balanced"]).optional().default("fast"),
  approvalGrant: z.boolean().optional().default(false),
  verificationCommand: z.string().optional().default("")
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    tasks: listTasks(),
    taskTags: listTaskTags().map((tag) => tag.name),
    taskGroups: listTaskGroups().map((group) => group.name)
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = createTaskSchema.parse(await request.json());
  const targetProjectPath = path.resolve(body.targetProjectPath);
  const verificationCommand = normalizeVerificationCommand(body.verificationCommand);
  upsertProject({
    path: targetProjectPath,
    verificationCommand: verificationCommand || null
  });
  const task = createTask({
    title: body.title,
    taskGroup: body.taskGroup.trim(),
    taskTags: body.taskTags,
    goal: body.goal,
    scope: body.scope,
    targetProjectPath,
    agentPlan:
      body.agentPlan ||
      "Researcher collects evidence, optional Planner asks clarifying questions, Implementer changes code, Verifier decides pass/needs_fix/blocked.",
    planningMode: body.planningMode,
    verificationMode: body.verificationMode,
    approvalGrant: body.approvalGrant
  });
  if (task.approvalGrant) {
    enqueueTask(task.id);
  }
  return NextResponse.json({ task }, { status: 201 });
}
