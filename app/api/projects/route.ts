import { NextResponse } from "next/server";
import { z } from "zod";
import { listProjects, upsertProject } from "@/lib/db";

export const dynamic = "force-dynamic";

const projectSchema = z.object({
  name: z.string().optional(),
  path: z.string().min(1),
  verificationCommand: z.string().optional().nullable()
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = projectSchema.parse(await request.json());
  const project = upsertProject(body);
  return NextResponse.json({ project }, { status: 201 });
}
