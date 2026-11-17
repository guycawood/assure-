import "server-only";
import { systemRpc } from "./system";
import * as whatsapp from "./whatsapp";
import * as wechat from "./wechat";
import type { Outbound, SendResult } from "./types";

// Which provider each channel uses: MESSAGING_WHATSAPP = mock | meta, MESSAGING_WECHAT = mock | official. Mock is the default, so nothing leaves the system until it is switched on.
export const providerFor = (channel: "whatsapp" | "wechat") =>
  channel === "whatsapp" ? (process.env.MESSAGING_WHATSAPP === "meta" ? "meta" : "mock") : (process.env.MESSAGING_WECHAT === "official" ? "official" : "mock");

async function sendOne(o: Outbound): Promise<SendResult> {
  const p = providerFor(o.channel);
  if (p === "meta") return whatsapp.send(o);
  if (p === "official") return wechat.send(o);
  return { ok: true, external: `mock-${o.id}` };
}

/** Send everything that is due. Failures are retried with a growing delay and marked failed after five tries or a permanent error. */
export async function dispatchQueue(limit = 20): Promise<{ sent: number; failed: number }> {
  const items = (await systemRpc<Outbound[]>("messaging_claim", { limit })) ?? [];
  let sent = 0, failed = 0;
  for (const o of items) {
    const r = await sendOne(o).catch((e): SendResult => ({ ok: false, error: e instanceof Error ? e.message : "Send failed", permanent: false }));
    if (r.ok) {
      sent++;
      await systemRpc("messaging_result", { id: o.id, ok: true, external: r.external, error: null, permanent: false });
      if (providerFor(o.channel) === "mock" && r.external) await systemRpc("messaging_delivery", { channel: o.channel, external: r.external, status: "delivered", error: null });
    } else {
      failed++;
      await systemRpc("messaging_result", { id: o.id, ok: false, external: null, error: r.error, permanent: r.permanent });
    }
  }
  return { sent, failed };
}
