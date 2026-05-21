import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createTask, listTaskGroups, listTasks, upsertProject } from "@/lib/db";
import { enqueueTask } from "@/lib/worker";

export const dynamic = "force-dynamic";

const createTaskSchema = z.object({
  title: z.string().min(1),
  taskGroup: z.string().optional().default(""),
  goal: z.string().min(1),
  scope: z.string().optional().default(""),
  targetProjectPath: z.string().min(1),
  agentPlan: z.string().optional().default(""),
  approvalGrant: z.boolean().optional().default(false),
  verificationCommand: z.string().optional().default("")
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ tasks: listTasks(), taskGroups: listTaskGroups().map((group) => group.name) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = createTaskSchema.parse(await request.json());
  const targetProjectPath = path.resolve(body.targetProjectPath);
  upsertProject({
    path: targetProjectPath,
    verificationCommand: body.verificationCommand || null
  });
  const task = createTask({
    title: body.title,
    taskGroup: body.taskGroup.trim(),
    goal: body.goal,
    scope: body.scope,
    targetProjectPath,
    agentPlan:
      body.agentPlan ||
      "Executor implements or investigates, Reviewer checks risks, Verifier decides pass/needs_fix/blocked.",
    approvalGrant: body.approvalGrant
  });
  if (task.approvalGrant) {
    enqueueTask(task.id);
  }
  return NextResponse.json({ task }, { status: 201 });
}
