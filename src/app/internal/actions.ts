"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin, requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CLIENTS, REGIONS } from "@/lib/srt";

export type ActionResult = { ok?: boolean; error?: string; message?: string };

const blank = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const uuid = z.string().uuid();

// Database errors raised by our own functions are written for users; anything else gets a generic message.
function friendly(error: { message: string; code?: string } | null, fallback = "That change didn't save. Try again.") {
  if (!error) return undefined;
  if (error.code === "42501" || error.code === "P0001" || /^(Only|A |You |Choose|Unknown|Supplier)/.test(error.message)) return error.message;
  if (error.code === "23505") return "A matching open ticket already exists.";
  return fallback;
}

/* ---------------- Suppliers ---------------- */

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the supplier name."),
  supplier_code: z.string().trim().nullable(),
  market: z.string().trim().nullable(),
  region: z.enum(REGIONS).nullable(),
  client: z.enum(CLIENTS).nullable(),
  category: z.string().trim().nullable(),
  primary_contact_email: z.string().trim().email("Enter a valid contact email.").nullable(),
  ytd_spend: z.coerce.number().min(0),
  strategic: z.boolean(),
  active: z.boolean(),
  srt_owner: uuid.nullable(),
  procurement_owner: uuid.nullable(),
  notes: z.string().nullable(),
});

function readSupplier(fd: FormData) {
  return supplierSchema.safeParse({
    name: fd.get("name"),
    supplier_code: blank(fd.get("supplier_code")),
    market: blank(fd.get("market")),
    region: blank(fd.get("region")),
    client: blank(fd.get("client")),
    category: blank(fd.get("category")),
    primary_contact_email: blank(fd.get("primary_contact_email")),
    ytd_spend: blank(fd.get("ytd_spend")) ?? 0,
    strategic: fd.get("strategic") === "on",
    active: fd.get("active") === "on",
    srt_owner: blank(fd.get("srt_owner")),
    procurement_owner: blank(fd.get("procurement_owner")),
    notes: blank(fd.get("notes")),
  });
}

export async function createSupplier(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const parsed = readSupplier(fd);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").insert(parsed.data).select("id").single();
  if (error) return { error: error.code === "23505" ? "That supplier ID is already in use." : friendly(error) };
  revalidatePath("/internal/srt", "layout");
  redirect(`/internal/suppliers/${data.id}`);
}

export async function updateSupplier(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const parsed = readSupplier(fd);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update(parsed.data).eq("id", id);
  if (error) return { error: error.code === "23505" ? "That supplier ID is already in use." : friendly(error) };
  revalidatePath(`/internal/suppliers/${id}`);
  return { ok: true, message: "Supplier details saved" };
}

/* ---------------- Gates ---------------- */

const gatePatch = z.object({
  status: z.enum(["missing", "requested", "received", "verified", "rejected", "not_required"]).optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().max(2000).optional(),
  rejection_reason: z.string().max(2000).optional(),
  ticket: uuid.optional(),
});

export async function updateGate(supplierId: string, gateKey: string, patch: z.input<typeof gatePatch>): Promise<ActionResult> {
  await requireInternal();
  const p = gatePatch.safeParse(patch);
  if (!p.success || !uuid.safeParse(supplierId).success) return { error: "Invalid gate update." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_supplier_gate", {
    p_supplier: supplierId,
    p_gate: gateKey,
    p_status: p.data.status ?? null,
    p_expiry: p.data.expiry ?? null,
    p_clear_expiry: p.data.expiry === null,
    p_note: p.data.note ?? null,
    p_rejection_reason: p.data.rejection_reason ?? null,
    p_ticket: p.data.ticket ?? null,
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/internal/suppliers/${supplierId}`);
  revalidatePath("/internal/srt", "layout");
  return { ok: true };
}

export async function raiseGapTickets(supplierId: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("raise_gap_tickets", { p_supplier: supplierId });
  if (error) return { error: friendly(error) };
  revalidatePath(`/internal/suppliers/${supplierId}`);
  const n = data as number;
  return { ok: true, message: n ? `${n} remediation ticket${n === 1 ? "" : "s"} raised` : "Every critical gap already has an open ticket" };
}

export async function approveFastTrack(supplierId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const justification = blank(fd.get("justification"));
  const closeBy = blank(fd.get("close_by"));
  if (!justification || !closeBy) return { error: "Enter a justification and a close-by date." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_fast_track", { p_supplier: supplierId, p_justification: justification, p_close_by: closeBy });
  if (error) return { error: friendly(error) };
  revalidatePath(`/internal/suppliers/${supplierId}`);
  return { ok: true, message: "Fast-track exception approved" };
}

/* ---------------- Tickets ---------------- */

const ticketSchema = z.object({
  type: z.enum(["new_onboarding", "document_verification", "missing_document", "remediation", "certificate_renewal", "bank_change", "query", "deactivation"]),
  title: z.string().trim().min(1, "Give the ticket a title."),
  description: z.string().nullable(),
  supplier_id: uuid.nullable(),
  prospect_name: z.string().trim().nullable(),
  client: z.string().nullable(),
  market: z.string().nullable(),
  gate_key: z.string().nullable(),
  priority: z.enum(["urgent", "high", "normal", "low"]),
  assignee: uuid.nullable(),
  owner: uuid.nullable(),
});

export async function createTicket(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const parsed = ticketSchema.safeParse({
    type: fd.get("type"),
    title: fd.get("title"),
    description: blank(fd.get("description")),
    supplier_id: blank(fd.get("supplier_id")),
    prospect_name: blank(fd.get("prospect_name")),
    client: blank(fd.get("client")),
    market: blank(fd.get("market")),
    gate_key: blank(fd.get("gate_key")),
    priority: fd.get("priority") ?? "normal",
    assignee: blank(fd.get("assignee")),
    owner: blank(fd.get("owner")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!parsed.data.supplier_id && !parsed.data.prospect_name) return { error: "Pick a supplier, or enter the new vendor's name." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("srt_tickets").insert(parsed.data).select("id").single();
  if (error) return { error: friendly(error) };
  revalidatePath("/internal/srt", "layout");
  redirect(`/internal/srt/tickets/${data.id}`);
}

const ticketUpdate = z.object({
  status: z.enum(["new", "triage", "in_progress", "waiting_vendor", "waiting_finance", "resolved"]),
  priority: z.enum(["urgent", "high", "normal", "low"]),
  assignee: uuid.nullable(),
  owner: uuid.nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  resolution: z.enum(["completed", "rejected", "duplicate", "withdrawn"]).nullable(),
});

export async function updateTicket(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const parsed = ticketUpdate.safeParse({
    status: fd.get("status"),
    priority: fd.get("priority"),
    assignee: blank(fd.get("assignee")),
    owner: blank(fd.get("owner")),
    due_date: blank(fd.get("due_date")),
    resolution: blank(fd.get("resolution")),
  });
  if (!parsed.success) return { error: "Check the ticket fields and try again." };
  const supabase = await createClient();
  const { data: before } = await supabase.from("srt_tickets").select("status, due_date, supplier_id, gate_key").eq("id", id).single();
  const patch: Record<string, unknown> = { ...parsed.data };
  if (before && before.due_date === parsed.data.due_date) delete patch.due_date; // only send due date when it changed
  const { error } = await supabase.from("srt_tickets").update(patch).eq("id", id);
  if (error) return { error: friendly(error) };

  let message = "Ticket saved";
  if (fd.get("verify_gate") === "on" && before?.supplier_id && before.gate_key && parsed.data.status === "resolved") {
    const r = await updateGate(before.supplier_id, before.gate_key, { status: "verified", ticket: id });
    message = r.error ? `Ticket saved, but the gate wasn't verified: ${r.error}` : "Ticket resolved and gate verified";
  }
  revalidatePath(`/internal/srt/tickets/${id}`);
  revalidatePath("/internal/srt", "layout");
  return { ok: true, message };
}

export async function addComment(ticketId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await requireInternal();
  const body = blank(fd.get("body"));
  if (!body) return { error: "Write an update first." };
  const supabase = await createClient();
  const { error } = await supabase.from("srt_ticket_activity").insert({ ticket_id: ticketId, kind: "comment", body, actor: me.id });
  if (error) return { error: friendly(error) };
  revalidatePath(`/internal/srt/tickets/${ticketId}`);
  return { ok: true };
}

export async function createSupplierFromTicket(ticketId: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data: t } = await supabase.from("srt_tickets").select("prospect_name, client, market, supplier_id").eq("id", ticketId).single();
  if (!t || t.supplier_id || !t.prospect_name) return { error: "This ticket already has a supplier." };
  const client = (CLIENTS as readonly string[]).includes(t.client ?? "") ? t.client : null;
  const { data: s, error } = await supabase.from("suppliers").insert({ name: t.prospect_name, client, market: t.market }).select("id").single();
  if (error) return { error: friendly(error) };
  await supabase.rpc("update_supplier_gate", { p_supplier: s.id, p_gate: "request", p_status: "received", p_ticket: ticketId });
  await supabase.from("srt_tickets").update({ supplier_id: s.id }).eq("id", ticketId);
  revalidatePath(`/internal/srt/tickets/${ticketId}`);
  return { ok: true, message: "Supplier record created" };
}

/* ---------------- Vendor information request ---------------- */

/** Base URL for links in vendor emails: the configured site URL, else this request's origin. */
async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

export async function sendVendorRfi(ticketId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const email = blank(fd.get("email"));
  if (!email || !z.string().email().safeParse(email).success) return { error: "Enter the vendor's email address." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_vendor_rfi", {
    p_ticket: ticketId, p_email: email, p_contact_name: blank(fd.get("contact_name")), p_link_base: await siteUrl(),
  });
  if (error) return { error: /^(Only|Enter|The vendor|Ticket)/.test(error.message) ? error.message : "The request wasn't sent. Try again." };
  revalidatePath(`/internal/srt/tickets/${ticketId}`);
  revalidatePath("/internal/srt", "layout");
  return { ok: true, message: `Information request emailed to ${email}` };
}

export async function reviewVendorRfi(rfiId: string, ticketId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const decision = fd.get("decision");
  if (decision !== "approve" && decision !== "return" && decision !== "reject") return { error: "Choose approve, return or reject." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_vendor_rfi", {
    p_rfi: rfiId, p_decision: decision, p_note: blank(fd.get("note")), p_link_base: await siteUrl(),
  });
  if (error) return { error: /^(Only|Add a note|Information request|Unknown)/.test(error.message) ? error.message : "The review wasn't saved. Try again." };
  revalidatePath(`/internal/srt/tickets/${ticketId}`);
  revalidatePath("/internal/srt", "layout");
  const done = { approve: "Vendor information approved", return: "Returned to the vendor with your note", reject: "Vendor rejected and ticket closed" };
  return { ok: true, message: done[decision] };
}

/* ---------------- Admin ---------------- */

export async function setUserAccess(userId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const userType = fd.get("user_type");
  const srtRole = blank(fd.get("srt_role"));
  const supplier = blank(fd.get("supplier_id"));
  if (userType !== "internal" && userType !== "vendor" && userType !== "client") return { error: "Choose a portal." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_access", {
    p_user: userId,
    p_user_type: userType,
    p_srt_role: userType === "internal" ? srtRole : null,
    p_is_admin: fd.get("is_admin") === "on",
    p_supplier: userType === "vendor" ? supplier : null,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/internal/admin/users");
  return { ok: true, message: "Access updated" };
}
