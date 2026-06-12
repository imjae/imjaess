import { NextResponse } from "next/server";
import { z } from "zod";
import { createConventionNote, listConventionNotes, updateConventionNote } from "@/lib/db";

export const dynamic = "force-dynamic";

const noteSchema = z.object({
  projectPath: z.string().min(1),
  ruleTarget: z.string().optional(),
  agentTargets: z.array(z.enum(["researcher", "planner", "implementer", "tester", "verifier"])).min(1).optional(),
  taskTags: z.array(z.string()).optional().default([]),
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

export async function PATCH(request: Request): Promise<NextResponse> {
  const body = noteSchema.extend({ id: z.string().min(1) }).parse(await request.json());
  const note = updateConventionNote(body);
  if (!note) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }
  return NextResponse.json({ note });
}
