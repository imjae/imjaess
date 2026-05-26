import { NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/db";
import { cancelTask } from "@/lib/worker";

export const dynamic = "force-dynamic";

const CANCELABLE_STATUSES = new Set(["queued", "running", "reviewing", "verifying", "waiting_for_user", "needs_fix"]);

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const task = getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (!CANCELABLE_STATUSES.has(task.status)) {
    return NextResponse.json({ error: `Task cannot be canceled from status ${task.status}.` }, { status: 409 });
  }

  const workerAccepted = cancelTask(id);
  if (!workerAccepted) {
    updateTask(id, {
      status: "canceled",
      failureReason: "Task was canceled by the user."
    });
  }

  return NextResponse.json({ ok: true });
}
