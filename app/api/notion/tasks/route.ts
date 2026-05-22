import { NextResponse } from "next/server";
import { z } from "zod";
import { importTasksFromNotion, syncAllTasksToNotion } from "@/lib/notion";

export const dynamic = "force-dynamic";

const taskDatabaseSyncSchema = z.object({
  direction: z.enum(["push", "pull"]),
  language: z.enum(["ko", "en"]).optional().default("en")
});

export async function POST(request: Request): Promise<NextResponse> {
  const body = taskDatabaseSyncSchema.parse(await request.json());
  const result =
    body.direction === "push"
      ? await syncAllTasksToNotion({ language: body.language })
      : await importTasksFromNotion();
  return NextResponse.json({ result });
}
