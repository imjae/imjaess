import { NextResponse } from "next/server";
import { z } from "zod";
import { getNotionSettings, updateNotionSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  parentPageId: z.string().default("")
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ settings: getNotionSettings() });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const body = settingsSchema.parse(await request.json());
  return NextResponse.json({ settings: updateNotionSettings({ parentPageId: body.parentPageId.trim() }) });
}
