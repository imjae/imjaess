import { NextResponse } from "next/server";
import { z } from "zod";
import { browseFolders } from "@/lib/folder-browser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const folderBrowserSchema = z.object({
  path: z.string().optional().default("")
});

export async function POST(request: Request): Promise<NextResponse> {
  const body = folderBrowserSchema.parse(await request.json());
  try {
    const result = await browseFolders(body.path);
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
