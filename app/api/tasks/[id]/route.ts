import { NextResponse } from "next/server";
import { deleteTask, getTaskDetail } from "@/lib/db";
import { removeQueuedTask, workerSnapshot } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const task = getTaskDetail(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ task });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const worker = workerSnapshot();
  if (worker.running.includes(id)) {
    return NextResponse.json({ error: "Cannot delete a task while it is running." }, { status: 409 });
  }
  removeQueuedTask(id);
  const deleted = deleteTask(id);
  if (!deleted) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
