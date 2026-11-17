"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dispatchQueue, providerFor } from "@/lib/messaging/dispatch";
import { systemRpc } from "@/lib/messaging/system";
import type { FormResult } from "@/components/assure/action-form";

// WhatsApp and WeChat on vendor conversations. The database enforces opt-in, the reply window and who may change templates.
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

async function rpc(fn: string, args: Record<string, unknown>, ok: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidatePath("/assure/messages", "layout");
  return { ok: true, message: ok };
}

/** Send on a vendor's WhatsApp or WeChat: free text inside the reply window, or an approved template with its fields. */
export async function sendOnChannel(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const conv = s(fd, "conversation_id"), contact = s(fd, "contact_id"), template = s(fd, "template");
  if (!isUuid(conv) || !isUuid(contact)) return { error: "Choose how to send it." };
  const vars = [1, 2, 3, 4, 5].map((i) => s(fd, `var${i}`)).filter((v, i, a) => v || a.slice(i).some(Boolean));
  const supabase = await createClient();
  const { error } = await supabase.rpc("messaging_send", { p_conversation: conv, p_contact: contact, p_body: s(fd, "body") || null, p_template: template || null, p_vars: vars });
  if (error) return { error: error.message };
  try { await dispatchQueue(); } catch { /* the scheduler will pick it up */ }
  revalidatePath("/assure/messages");
  return { ok: true, message: "Queued. The delivery tick below shows when it is sent." };
}

/** Demo only: act as the vendor replying on their phone, so the inbound path can be shown without a provider account. */
export async function simulateReply(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const channel = s(fd, "channel") === "wechat" ? "wechat" : "whatsapp";
  if (providerFor(channel) !== "mock") return { error: "Replies come from the real provider." };
  const body = s(fd, "body");
  if (!body) return { error: "Write what the vendor replies." };
  await systemRpc("messaging_inbound", { channel, address: s(fd, "address"), body, external: `mock-in-${Date.now()}`, name: null });
  revalidatePath("/assure/messages");
  return { ok: true, message: "Reply received." };
}

export async function addContact(_: FormResult, fd: FormData): Promise<FormResult> {
  const supplier = s(fd, "supplier");
  if (!isUuid(supplier)) return { error: "Choose a vendor." };
  return rpc("messaging_contact_add", { p_supplier: supplier, p_channel: s(fd, "channel"), p_address: s(fd, "address"), p_name: s(fd, "name") || null, p_method: s(fd, "method") || null },
    s(fd, "method") ? "Added and opted in." : "Added. Record how they agreed before you can message them.");
}
export async function optInContact(_: FormResult, fd: FormData): Promise<FormResult> {
  return rpc("messaging_contact_opt_in", { p_id: s(fd, "id"), p_method: s(fd, "method") }, "Opted in.");
}
export async function optOutContact(_: FormResult, fd: FormData): Promise<FormResult> {
  return rpc("messaging_contact_opt_out", { p_id: s(fd, "id") }, "Opted out. No more messages will be sent on this channel.");
}
export async function attachUnmatched(_: FormResult, fd: FormData): Promise<FormResult> {
  const supplier = s(fd, "supplier");
  if (!isUuid(supplier)) return { error: "Choose the vendor this number belongs to." };
  return rpc("messaging_unmatched_attach", { p_id: s(fd, "id"), p_supplier: supplier, p_method: s(fd, "method") }, "Linked. The message is now in the vendor's conversation.");
}
export async function dismissUnmatched(_: FormResult, fd: FormData): Promise<FormResult> {
  return rpc("messaging_unmatched_dismiss", { p_id: s(fd, "id") }, "Dismissed.");
}
export async function saveTemplate(_: FormResult, fd: FormData): Promise<FormResult> {
  return rpc("messaging_template_save", { p_key: s(fd, "key"), p_label: s(fd, "label"), p_body: s(fd, "body"), p_provider_name: s(fd, "provider_name"), p_language: s(fd, "language") || "en" },
    "Saved. New wording must be approved before it can be sent.");
}
export async function setTemplateStatus(_: FormResult, fd: FormData): Promise<FormResult> {
  return rpc("messaging_template_set_status", { p_key: s(fd, "key"), p_status: s(fd, "status") }, "Template updated.");
}
export async function setChannelWindow(_: FormResult, fd: FormData): Promise<FormResult> {
  const h = s(fd, "hours");
  return rpc("messaging_channel_set_window", { p_channel: s(fd, "channel"), p_hours: h === "" ? null : Number(h) }, "Reply window updated.");
}
