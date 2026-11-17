import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDocumentChecks } from "@/lib/ocr/run";
import { isDemoMode } from "@/lib/demo/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Reads and checks uploaded certificates and documents. A scheduler posts here every few minutes with the header x-job-secret.
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret && !isDemoMode()) return new NextResponse("JOBS_SECRET is not set", { status: 503 });
  if (secret) {
    const got = req.headers.get("x-job-secret") ?? "";
    if (got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.json(await runDocumentChecks(20));
}
