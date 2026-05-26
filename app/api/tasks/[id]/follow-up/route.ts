import { NextResponse } from "next/server";
import { z } from "zod";
import { createFollowUpTask } from "@/lib/follow-up";

export const dynamic = "force-dynamic";

const followUpSchema = z.object({
  message: z.string().min(1),
  approvalGrant: z.boolean().optional().default(true),
  baseBranch: z.string().optional().default(""),
  verificationCommand: z.string().optional().default("")
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const body = followUpSchema.parse(await request.json());
  try {
    const task = createFollowUpTask({
      parentTaskId: id,
      message: body.message,
      approvalGrant: body.approvalGrant,
      baseBranch: body.baseBranch,
      verificationCommand: body.verificationCommand
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
