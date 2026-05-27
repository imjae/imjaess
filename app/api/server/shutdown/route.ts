import { NextResponse } from "next/server";
import { scheduleServerShutdown } from "@/lib/server-shutdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const shutdown = scheduleServerShutdown();
  return NextResponse.json({ ok: true, ...shutdown });
}
