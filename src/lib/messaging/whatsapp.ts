import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Outbound, SendResult } from "./types";

// WhatsApp Business Platform (Cloud API). Needs WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN.
const API = "https://graph.facebook.com/v21.0";

export function verifySignature(raw: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export type WaEvent =
  | { kind: "message"; address: string; name: string | null; body: string; id: string }
  | { kind: "status"; id: string; status: "sent" | "delivered" | "read" | "failed"; error: string | null };

/** Flatten a webhook payload into the messages and delivery receipts it carries. */
export function parseWebhook(payload: unknown): WaEvent[] {
  const out: WaEvent[] = [];
  const entries = ((payload as { entry?: unknown[] })?.entry ?? []) as { changes?: { value?: Record<string, unknown> }[] }[];
  for (const e of entries) for (const ch of e.changes ?? []) {
    const v = ch.value ?? {};
    const names = new Map<string, string>();
    for (const c of (v.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? []) if (c.wa_id) names.set(c.wa_id, c.profile?.name ?? "");
    for (const m of (v.messages as { from?: string; id?: string; type?: string; text?: { body?: string }; button?: { text?: string } }[] | undefined) ?? []) {
      if (!m.from || !m.id) continue;
      const body = m.type === "text" ? m.text?.body ?? "" : m.type === "button" ? m.button?.text ?? "" : `[${m.type ?? "message"} received. Open WhatsApp to view it]`;
      out.push({ kind: "message", address: m.from, name: names.get(m.from) || null, body, id: m.id });
    }
    for (const s of (v.statuses as { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[] | undefined) ?? []) {
      if (s.id && (s.status === "sent" || s.status === "delivered" || s.status === "read" || s.status === "failed")) {
        out.push({ kind: "status", id: s.id, status: s.status, error: s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? null });
      }
    }
  }
  return out;
}

export async function send(o: Outbound): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN, phone = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phone) return { ok: false, error: "WhatsApp is not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID)", permanent: true };
  const body = o.template
    ? { messaging_product: "whatsapp", to: o.address, type: "template", template: { name: o.template.name, language: { code: o.template.language },
        components: o.template.vars.length ? [{ type: "body", parameters: o.template.vars.map((t) => ({ type: "text", text: String(t) })) }] : [] } }
    : { messaging_product: "whatsapp", to: o.address, type: "text", text: { body: o.body, preview_url: false } };
  try {
    const res = await fetch(`${API}/${phone}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
    if (res.ok && json.messages?.[0]?.id) return { ok: true, external: json.messages[0].id };
    // Throttling and server errors are retried; anything else (bad number, template rejected, window closed) will not succeed on a retry.
    return { ok: false, error: json.error?.message ?? `WhatsApp returned ${res.status}`, permanent: !(res.status === 429 || res.status >= 500) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error", permanent: false };
  }
}
