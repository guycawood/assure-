import { NextResponse } from "next/server";
import { providerFor } from "@/lib/messaging/dispatch";
import { systemRpc } from "@/lib/messaging/system";
import { parseWebhook, verifySignature } from "@/lib/messaging/whatsapp";

export const dynamic = "force-dynamic";

// WhatsApp webhook. GET answers Meta's subscription check; POST carries replies and delivery receipts, signed with the app secret.
export async function GET(req: Request) {
  if (providerFor("whatsapp") !== "meta") return new NextResponse("Not enabled", { status: 404 });
  const q = new URL(req.url).searchParams;
  const ok = q.get("hub.mode") === "subscribe" && !!process.env.WHATSAPP_VERIFY_TOKEN && q.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
  return ok ? new NextResponse(q.get("hub.challenge") ?? "", { status: 200 }) : new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  if (providerFor("whatsapp") !== "meta") return new NextResponse("Not enabled", { status: 404 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) return new NextResponse("Bad signature", { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new NextResponse("Bad request", { status: 400 }); }
  for (const e of parseWebhook(payload)) {
    try {
      if (e.kind === "message") await systemRpc("messaging_inbound", { channel: "whatsapp", address: e.address, body: e.body, external: e.id, name: e.name });
      else await systemRpc("messaging_delivery", { channel: "whatsapp", external: e.id, status: e.status, error: e.error });
    } catch (err) {
      console.error("[whatsapp webhook]", err instanceof Error ? err.message : err);   // one bad event must not make Meta resend the whole batch
    }
  }
  return NextResponse.json({ ok: true });
}
