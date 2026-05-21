import { NextResponse } from "next/server";
import { z } from "zod";
import { syncTaskToNotion } from "@/lib/notion";

export const dynamic = "force-dynamic";

const syncSchema = z.object({
  taskId: z.string().min(1),
  language: z.enum(["ko", "en"]).optional().default("en")
});

export async function POST(request: Request): Promise<NextResponse> {
  const body = syncSchema.parse(await request.json());
  const result = await syncTaskToNotion(body.taskId, { language: body.language });
  return NextResponse.json({ result });
}
