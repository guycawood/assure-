import { NextResponse } from "next/server";
import { providerFor } from "@/lib/messaging/dispatch";
import { systemRpc } from "@/lib/messaging/system";
import { parseXml, verifySignature } from "@/lib/messaging/wechat";

export const dynamic = "force-dynamic";

const signed = (q: URLSearchParams) => verifySignature(process.env.WECHAT_TOKEN, q.get("signature"), q.get("timestamp"), q.get("nonce"));

// WeChat Official Account callback. GET answers the server check; POST carries messages and events. Both are signed with the account token.
export async function GET(req: Request) {
  if (providerFor("wechat") !== "official") return new NextResponse("Not enabled", { status: 404 });
  const q = new URL(req.url).searchParams;
  return signed(q) ? new NextResponse(q.get("echostr") ?? "", { status: 200 }) : new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  if (providerFor("wechat") !== "official") return new NextResponse("Not enabled", { status: 404 });
  if (!signed(new URL(req.url).searchParams)) return new NextResponse("Forbidden", { status: 403 });
  const e = parseXml(await req.text());
  try {
    if (e?.kind === "message") await systemRpc("messaging_inbound", { channel: "wechat", address: e.address, body: e.body, external: e.id, name: null });
    else if (e?.kind === "unsubscribe") await systemRpc("messaging_inbound", { channel: "wechat", address: e.address, body: "STOP", external: null, name: null });
  } catch (err) {
    console.error("[wechat callback]", err instanceof Error ? err.message : err);
  }
  return new NextResponse("success", { status: 200 });          // WeChat expects this and retries otherwise
}
