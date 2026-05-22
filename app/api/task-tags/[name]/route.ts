import { NextResponse } from "next/server";
import { deleteTaskTag } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ name: string }> }): Promise<NextResponse> {
  const { name } = await context.params;
  const deleted = deleteTaskTag(decodeURIComponent(name));
  if (!deleted) {
    return NextResponse.json({ error: "Task tag not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
