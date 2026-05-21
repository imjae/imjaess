import { NextResponse } from "next/server";
import { workerSnapshot } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(workerSnapshot());
}
