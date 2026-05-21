import fs from "node:fs";
import { NextResponse } from "next/server";
import { getTaskAttachment } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const attachment = getTaskAttachment(id);
  if (!attachment || !fs.existsSync(attachment.storedPath)) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const bytes = fs.readFileSync(attachment.storedPath);
  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": attachment.mimeType
    }
  });
}
