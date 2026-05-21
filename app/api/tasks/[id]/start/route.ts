import { NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/db";
import { enqueueTask } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const task = getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  updateTask(id, { status: "queued", failureReason: null });
  enqueueTask(id);
  return NextResponse.json({ ok: true });
}
