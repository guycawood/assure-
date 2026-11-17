import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { systemRpc } from "@/lib/messaging/system";
import { isDemoMode } from "@/lib/demo/config";

export const dynamic = "force-dynamic";

// Sends scheduled survey waves that are due and closes waves past their closing date. A scheduler posts here daily with the header x-job-secret.
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret && !isDemoMode()) return new NextResponse("JOBS_SECRET is not set", { status: 503 });
  if (secret) {
    const got = req.headers.get("x-job-secret") ?? "";
    if (got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new NextResponse("Forbidden", { status: 403 });
  }
  // Surveys due today, and feedback cases that have gone late, are both housekeeping for the same daily run.
  const surveys = await systemRpc("crm_survey_run_due", {});
  const feedback = await systemRpc("crm_feedback_run_due", {});
  return NextResponse.json({ surveys, feedback });
}
