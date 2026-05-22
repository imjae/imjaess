import { NextResponse } from "next/server";
import { z } from "zod";
import { listProjects, listTasks } from "@/lib/db";
import { workerSnapshot } from "@/lib/worker";
import { cleanupWorktrees } from "@/lib/worktree-cleanup";

export const dynamic = "force-dynamic";

const cleanupSchema = z.object({
  mode: z.enum(["completed", "failed", "all", "expired-blocked"])
});

export async function POST(request: Request): Promise<NextResponse> {
  const body = cleanupSchema.parse(await request.json());
  const worker = workerSnapshot();
  const summary = await cleanupWorktrees({
    mode: body.mode,
    tasks: listTasks(),
    projectPaths: listProjects().map((project) => project.path),
    excludeTaskIds: [...worker.queued, ...worker.running]
  });
  return NextResponse.json({ summary });
}
