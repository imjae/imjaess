import { NextResponse } from "next/server";
import { z } from "zod";
import { getBrokerArtifact, getTask, insertBrokerArtifact, updateTask } from "@/lib/db";
import { enqueueTask } from "@/lib/worker";

export const dynamic = "force-dynamic";

const answerSchema = z.object({
  answer: z.string().min(1)
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const task = getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.status !== "waiting_for_user") {
    return NextResponse.json({ error: "Task is not waiting for planner answers." }, { status: 409 });
  }

  const body = answerSchema.parse(await request.json());
  const round = task.currentRound || 1;
  const existingAnswer = getBrokerArtifact(id, round, "plan_answer");
  if (!existingAnswer) {
    insertBrokerArtifact({
      taskId: id,
      round,
      sourceRole: "broker",
      kind: "plan_answer",
      content: body.answer.trim()
    });
  }

  updateTask(id, {
    status: "queued",
    failureReason: null
  });
  enqueueTask(id);
  return NextResponse.json({ ok: true });
}
