import { NextResponse } from "next/server";
import { z } from "zod";
import { createConventionNote, listConventionNotes } from "@/lib/db";

export const dynamic = "force-dynamic";

const noteSchema = z.object({
  projectPath: z.string().min(1),
  category: z.string().min(1),
  rule: z.string().min(1),
  reason: z.string().default(""),
  source: z.string().default("manual"),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  examples: z.string().default("")
});

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const projectPath = url.searchParams.get("projectPath") || undefined;
  return NextResponse.json({ notes: listConventionNotes(projectPath) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = noteSchema.parse(await request.json());
  const note = createConventionNote(body);
  return NextResponse.json({ note }, { status: 201 });
}
