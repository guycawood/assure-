import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Outbound, SendResult } from "./types";

// WeChat Official Account (a Service Account) in plain-text callback mode. Needs WECHAT_APPID, WECHAT_SECRET and WECHAT_TOKEN.
// WeChat only lets an account message a person who has written to it in the last 48 hours, so conversations start with the vendor.
// (WeCom customer-service messaging uses a different API and is not covered here.)

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** WeChat signs each callback with sha1(sorted token, timestamp, nonce). */
export function verifySignature(token: string | undefined, signature: string | null, timestamp: string | null, nonce: string | null): boolean {
  if (!token || !signature || !timestamp || !nonce) return false;
  return same(sha1([token, timestamp, nonce].sort().join("")), signature);
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`));
  return (m?.[1] ?? m?.[2] ?? "").trim();
};

export type WxEvent = { kind: "message"; address: string; body: string; id: string | null } | { kind: "unsubscribe"; address: string };

/** Read the XML a WeChat callback sends. Only text messages and the unsubscribe event are used. */
export function parseXml(xml: string): WxEvent | null {
  const from = tag(xml, "FromUserName"), type = tag(xml, "MsgType");
  if (!from) return null;
  if (type === "event") return tag(xml, "Event").toLowerCase() === "unsubscribe" ? { kind: "unsubscribe", address: from } : null;
  const id = tag(xml, "MsgId") || null;
  if (type === "text") return { kind: "message", address: from, body: tag(xml, "Content"), id };
  return { kind: "message", address: from, body: `[${type || "message"} received. Open WeChat to view it]`, id };
}

let cached: { token: string; until: number } | null = null;
async function accessToken(force = false): Promise<string> {
  if (!force && cached && cached.until > Date.now() + 60_000) return cached.token;
  const res = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(process.env.WECHAT_APPID ?? "")}&secret=${encodeURIComponent(process.env.WECHAT_SECRET ?? "")}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number; errmsg?: string };
  if (!json.access_token) throw new Error(json.errmsg ?? "Could not get a WeChat access token");
  cached = { token: json.access_token, until: Date.now() + (json.expires_in ?? 7200) * 1000 };
  return cached.token;
}

export async function send(o: Outbound): Promise<SendResult> {
  if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) return { ok: false, error: "WeChat is not configured (WECHAT_APPID, WECHAT_SECRET)", permanent: true };
  try {
    for (const attempt of [0, 1]) {
      const token = await accessToken(attempt === 1);
      const res = await fetch(`https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ touser: o.address, msgtype: "text", text: { content: o.body } }) });
      const json = (await res.json()) as { errcode?: number; errmsg?: string };
      if (!json.errcode) return { ok: true, external: null };
      if ((json.errcode === 40001 || json.errcode === 42001) && attempt === 0) continue;          // the access token expired: fetch a new one and try once more
      // 45015: more than 48 hours since the person wrote. 40003: not a valid OpenID. Neither will succeed on a retry.
      return { ok: false, error: json.errmsg ?? `WeChat error ${json.errcode}`, permanent: ![-1, 45009].includes(json.errcode) };
    }
    return { ok: false, error: "WeChat did not accept the message", permanent: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error", permanent: false };
  }
}
