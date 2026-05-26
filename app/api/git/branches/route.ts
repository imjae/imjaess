import { NextResponse } from "next/server";
import { z } from "zod";
import { listLocalBranches } from "@/lib/git";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  targetProjectPath: z.string().min(1)
});

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const query = querySchema.parse({
    targetProjectPath: url.searchParams.get("targetProjectPath") || ""
  });
  try {
    const result = await listLocalBranches(query.targetProjectPath);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
