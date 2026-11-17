import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchQueue } from "@/lib/messaging/dispatch";
import { isDemoMode } from "@/lib/demo/config";

export const dynamic = "force-dynamic";

// Sends queued WhatsApp and WeChat messages. Run it every minute from a scheduler with the header x-dispatch-secret. The app also calls it right after staff send.
export async function POST(req: Request) {
  const secret = process.env.MESSAGING_DISPATCH_SECRET;
  if (!secret && !isDemoMode()) return new NextResponse("MESSAGING_DISPATCH_SECRET is not set", { status: 503 });
  if (secret) {
    const got = req.headers.get("x-dispatch-secret") ?? "";
    if (got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.json(await dispatchQueue());
}
