import { NextResponse } from "next/server";
import { listTaskAttachments } from "@/lib/db";
import { saveTaskImageAttachment } from "@/lib/attachments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  return NextResponse.json({ attachments: listTaskAttachments(id) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const formData = await request.formData();
  const files = formData.getAll("images").filter((item): item is File => item instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No image files were provided." }, { status: 400 });
  }

  try {
    const attachments = [];
    for (const file of files) {
      attachments.push(await saveTaskImageAttachment({ taskId: id, file }));
    }
    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Task not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
