import { NextResponse } from "next/server";
import { z } from "zod";
import { syncTaskToNotion } from "@/lib/notion";

export const dynamic = "force-dynamic";

const syncSchema = z.object({
  taskId: z.string().min(1)
});

export async function POST(request: Request): Promise<NextResponse> {
  const body = syncSchema.parse(await request.json());
  const result = await syncTaskToNotion(body.taskId);
  return NextResponse.json({ result });
}
