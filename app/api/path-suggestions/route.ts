import { NextResponse } from "next/server";
import { z } from "zod";
import { getPathSuggestions } from "@/lib/path-suggestions";

export const dynamic = "force-dynamic";

const suggestionSchema = z.object({
  targetProjectPath: z.string().min(1),
  query: z.string().default("")
});

export async function POST(request: Request): Promise<NextResponse> {
  const body = suggestionSchema.parse(await request.json());
  try {
    const suggestions = await getPathSuggestions({
      targetProjectPath: body.targetProjectPath,
      query: body.query
    });
    return NextResponse.json({ suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ suggestions: [], error: message });
  }
}
