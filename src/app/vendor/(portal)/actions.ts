"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getVendorContext, type VendorCtx } from "@/lib/vendor-data";
import { uploadFile } from "@/app/files-actions";
import { cleanPaData, DOC_TYPES, friendlyError, isEmail, type ActionResult, type VendorPermission } from "@/lib/vendor";

// Vendor portal server actions. Each one checks the signed-in vendor first, then calls a SQL function (or a table
// write that RLS allows). The company is always derived on the server (my_supplier_id() in Postgres); nothing in
// the form decides whose record is touched.

type Level = "viewer" | "standard" | "admin";
type Ok = { ctx: VendorCtx & { permission: VendorPermission; company: NonNullable<VendorCtx["company"]> }; supabase: Awaited<ReturnType<typeof createClient>> };

async function vendor(level: Level): Promise<Ok | { error: string }> {
  const ctx = await getVendorContext();
  if (!ctx?.company || !ctx.permission) return { error: "Sign in with your vendor account." };
  if (level === "standard" && ctx.permission === "viewer") return { error: "Your account is view-only. Ask your portal admin for edit access." };
  if (level === "admin" && ctx.permission !== "admin") return { error: "Only your company's portal admins can do this." };
  return { ctx: ctx as Ok["ctx"], supabase: await createClient() };
}

const s = (fd: FormData, k: string, max = 2000) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
};
const uuid = (fd: FormData, k: string) => {
  const v = s(fd, k, 64);
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
};
const date = (fd: FormData, k: string) => {
  const v = s(fd, k, 10);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const done = (message: string, id?: string): ActionResult => {
  revalidatePath("/vendor", "layout");
  return { ok: true, message, id };
};
const fail = (message?: string): ActionResult => ({ ok: false, message: friendlyError(message) });

async function rpc(level: Level, fn: string, args: Record<string, unknown>, okMessage: string): Promise<ActionResult> {
  const v = await vendor(level);
  if ("error" in v) return fail(v.error);
  const { data, error } = await v.supabase.rpc(fn, args);
  if (error) return fail(error.message);
  return done(okMessage, typeof data === "string" ? data : undefined);
}

// ---------------------------------------------------------------------------
// Quote requests (sealed: only rfq_* functions)
// ---------------------------------------------------------------------------
export async function saveQuote(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const rfq = uuid(fd, "rfq");
  if (!rfq) return fail("Quote request not found.");
  const submit = fd.get("intent") !== "draft"; // primary button submits; "Save draft" sends intent=draft
  const prices: { line_id: string; quantity: number; unit_price: string; lead_time_days: string | null }[] = [];
  for (const [k, val] of fd.entries()) {
    const m = /^price:([0-9a-f-]{36}):(\d+)$/i.exec(k);
    if (!m || typeof val !== "string" || !val.trim()) continue;
    const n = Number(val.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return fail(`Check the price for quantity ${m[2]}: it must be a number of zero or more.`);
    const lead = s(fd, `lead:${m[1]}:${m[2]}`, 6);
    if (lead && !/^\d{1,4}$/.test(lead)) return fail("Lead times are whole days.");
    prices.push({ line_id: m[1], quantity: Number(m[2]), unit_price: String(n), lead_time_days: lead });
  }
  const lead = s(fd, "lead_time_days", 6);
  if (lead && !/^\d{1,4}$/.test(lead)) return fail("Lead time is a whole number of days.");
  return rpc("standard", "rfq_submit_quote", {
    p_rfq: rfq, p_prices: prices, p_lead_time_days: lead ? Number(lead) : null, p_notes: s(fd, "notes", 2000), p_submit: submit,
  }, submit ? "Quote submitted. You can change it until the due date." : "Draft saved.");
}

export async function declineRfq(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("standard", "rfq_decline", { p_rfq: uuid(fd, "rfq"), p_reason: s(fd, "reason", 1000) }, "You've declined this quote request.");
}

// ---------------------------------------------------------------------------
// Pushed prices and purchase orders
// ---------------------------------------------------------------------------
export async function respondPush(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const accept = fd.get("decision") === "accept";
  return rpc("standard", "triage_push_respond", { p_triage: uuid(fd, "id"), p_accept: accept, p_reason: accept ? null : s(fd, "reason", 1000) },
    accept ? "Price confirmed." : "Price declined. adm Indicia will run a quote request instead.");
}

export async function respondPo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const accept = fd.get("decision") === "accept";
  return rpc("standard", "po_vendor_respond", { p_po: uuid(fd, "id"), p_accept: accept, p_reason: accept ? null : s(fd, "reason", 1000) },
    accept ? "Purchase order accepted." : "Purchase order declined.");
}

// ---------------------------------------------------------------------------
// Certificates and documents
// ---------------------------------------------------------------------------
async function storeFile(fd: FormData, field: string, module: string, entityType: string, entityId: string, label: string) {
  const file = fd.get(field);
  if (!(file instanceof File) || file.size === 0) return { error: "Attach the file." };
  const up = new FormData();
  up.set("file", file);
  up.set("module", module);
  up.set("entity_type", entityType);
  up.set("entity_id", entityId);
  up.set("label", label);
  const r = await uploadFile(up);
  if (!r.ok || !r.id) return { error: r.message };
  return { id: r.id };
}

export async function addCertificate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const v = await vendor("standard");
  if ("error" in v) return fail(v.error);
  const type = uuid(fd, "cert_type");
  if (!type) return fail("Choose the certificate type.");
  const issue = date(fd, "issue_date"), expiry = date(fd, "expiry_date");
  if (issue && expiry && expiry < issue) return fail("The expiry date is before the issue date.");
  const f = await storeFile(fd, "file", "assure", "certificate", crypto.randomUUID(), s(fd, "type_name", 120) ?? "Certificate");
  if ("error" in f) return fail(f.error);
  const { error } = await v.supabase.rpc("assure_vendor_add_certificate", {
    p_cert_type: type, p_cert_number: s(fd, "cert_number", 100), p_issuer: s(fd, "issuer", 200), p_issue: issue, p_expiry: expiry, p_document_path: `files/${f.id}`,
  });
  if (error) return fail(error.message);
  return done("Certificate uploaded. adm Indicia will check it.");
}

export async function addDocument(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const v = await vendor("standard");
  if ("error" in v) return fail(v.error);
  const docType = s(fd, "doc_type", 40);
  if (!docType || !DOC_TYPES.some((d) => d.value === docType)) return fail("Choose the document type.");
  const title = s(fd, "title", 200);
  if (!title) return fail("Give the document a title.");
  const f = await storeFile(fd, "file", "assure", "supplier_document", crypto.randomUUID(), title);
  if ("error" in f) return fail(f.error);
  const { error } = await v.supabase.from("supplier_documents").insert({
    supplier_id: v.ctx.company.id, doc_type: docType, title, file_path: `files/${f.id}`, po_reference: s(fd, "po_reference", 60),
  });
  if (error) return fail(error.message);
  return done("Document uploaded. adm Indicia will check it.");
}

// ---------------------------------------------------------------------------
// Quality and performance
// ---------------------------------------------------------------------------
export async function respondNcr(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const action = s(fd, "action", 20);
  if (!["acknowledge", "respond", "dispute"].includes(action ?? "")) return fail("Choose a response.");
  return rpc("standard", "assure_ncr_vendor_respond", { p_id: uuid(fd, "id"), p_action: action, p_response: s(fd, "response", 4000), p_root_cause: s(fd, "root_cause", 4000) },
    action === "acknowledge" ? "NCR acknowledged." : "Response sent to adm Indicia.");
}

export async function markCorrectiveDone(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("standard", "assure_ca_set_status", { p_id: uuid(fd, "id"), p_status: "done", p_note: s(fd, "note", 2000) }, "Marked done. adm Indicia will verify it.");
}

export async function respondIssue(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const action = s(fd, "action", 20);
  if (!["acknowledge", "respond", "dispute"].includes(action ?? "")) return fail("Choose a response.");
  return rpc("standard", "assure_issue_vendor_respond", {
    p_id: uuid(fd, "id"), p_action: action, p_response: s(fd, "response", 4000), p_corrective: s(fd, "corrective", 4000), p_target: date(fd, "target"),
  }, action === "acknowledge" ? "Issue acknowledged." : "Response sent to adm Indicia.");
}

// ---------------------------------------------------------------------------
// Contracts, reviews, messages
// ---------------------------------------------------------------------------
export async function signContract(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const decision = fd.get("decision") === "decline" ? "decline" : "sign";
  if (decision === "sign" && fd.get("confirm") !== "on") return fail("Tick the box to confirm you are authorised to sign.");
  return rpc("standard", "vendor_contract_sign", { p_party: uuid(fd, "party"), p_decision: decision, p_note: s(fd, "note", 2000) },
    decision === "sign" ? "Signed. Thank you." : "You've declined this contract.");
}

export async function commentContract(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("standard", "vendor_contract_comment", { p_id: uuid(fd, "id"), p_body: s(fd, "body", 2000) }, "Comment sent.");
}

export async function respondReview(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const response = s(fd, "response", 30);
  return rpc("standard", "assure_review_vendor_respond", { p_id: uuid(fd, "id"), p_response: response, p_suggested: date(fd, "suggested"), p_notes: s(fd, "notes", 2000) },
    response === "accepted" ? "Thanks, you've accepted the meeting." : "Response sent.");
}

export async function startConversation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const v = await vendor("viewer");
  if ("error" in v) return fail(v.error);
  const subject = s(fd, "subject", 200), body = s(fd, "body", 10000);
  if (!subject || !body) return fail("Add a subject and a message.");
  const { data, error } = await v.supabase.from("conversations").insert({ supplier_id: v.ctx.company.id, subject }).select("id").single();
  if (error || !data) return fail(error?.message);
  const id = (data as { id: string }).id;
  const m = await v.supabase.from("messages").insert({ conversation_id: id, body });
  if (m.error) return fail(m.error.message);
  return done("Message sent.", id);
}

export async function sendMessage(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const v = await vendor("viewer");
  if ("error" in v) return fail(v.error);
  const id = uuid(fd, "conversation"), body = s(fd, "body", 10000);
  if (!id || !body) return fail("Write a message first.");
  const { error } = await v.supabase.from("messages").insert({ conversation_id: id, body });
  if (error) return fail(error.message);
  return done("Sent.");
}

// ---------------------------------------------------------------------------
// Action plans, surveys, training
// ---------------------------------------------------------------------------
export async function addTask(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("standard", "vendor_task_add", {
    p_title: s(fd, "title", 200), p_description: s(fd, "description", 2000), p_category: s(fd, "category", 20) ?? "other",
    p_priority: s(fd, "priority", 20) ?? "medium", p_due: date(fd, "due"),
  }, "Action added.");
}

export async function setTaskStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const status = s(fd, "status", 20);
  if (!["in_progress", "completed"].includes(status ?? "")) return fail("Choose a status.");
  return rpc("standard", "assure_task_set_status", { p_id: uuid(fd, "id"), p_status: status, p_note: s(fd, "note", 2000) },
    status === "completed" ? "Marked complete. adm Indicia will verify it." : "Marked in progress.");
}

export async function saveSurvey(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const answers: Record<string, string> = {};
  for (const [k, val] of fd.entries()) {
    const m = /^q:(.{1,80})$/.exec(k);
    if (!m || typeof val !== "string") continue;
    answers[m[1]] = answers[m[1]] ? `${answers[m[1]]}, ${val.slice(0, 2000)}` : val.slice(0, 4000);
  }
  const final = fd.get("intent") !== "draft";
  return rpc("standard", "assure_survey_submit", { p_id: uuid(fd, "id"), p_answers: answers, p_final: final }, final ? "Survey submitted. Thank you." : "Answers saved.");
}

export async function startTraining(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("viewer", "assure_training_start", { p_module: uuid(fd, "module") }, "Started.");
}

export async function completeTraining(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("viewer", "assure_training_progress", { p_id: uuid(fd, "id"), p_status: "completed", p_reason: null }, "Marked complete.");
}

// ---------------------------------------------------------------------------
// Pre-assessment (called from the multi-step client form)
// ---------------------------------------------------------------------------
export async function savePreAssessment(id: string | null, raw: unknown, submit: boolean): Promise<ActionResult> {
  const v = await vendor("standard");
  if ("error" in v) return fail(v.error);
  const data = cleanPaData(raw);
  const company = data.supplier_company_name, email = data.primary_contact_email ?? "";
  if (!company) return fail("Enter your company name (Supplier details).");
  if (!isEmail(email)) return fail("Enter a valid primary contact email (Supplier details).");
  if (submit && (!data.major_category || !data.head_office_country || !data.primary_contact_name)) {
    return fail("Complete the required supplier details (category, head office country and contact name) before submitting.");
  }
  const { data: saved, error } = await v.supabase.rpc("assure_pa_save", {
    p_id: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null, p_company: company, p_contact_name: data.primary_contact_name ?? null, p_contact_email: email,
    p_category: data.major_category ?? null, p_country: data.head_office_country ?? null, p_data: data,
  });
  if (error) return fail(error.message);
  const paId = saved as string;
  if (submit) {
    const r = await v.supabase.rpc("assure_pa_submit", { p_id: paId });
    if (r.error) return { ...fail(r.error.message), id: paId };
    return done("Submitted. adm Indicia's vendor managers will review it.", paId);
  }
  return done("Saved.", paId);
}

// ---------------------------------------------------------------------------
// Team, sites, subscription
// ---------------------------------------------------------------------------
export async function inviteMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = (s(fd, "email", 254) ?? "").toLowerCase();
  if (!isEmail(email)) return fail("Enter a valid email address.");
  return rpc("admin", "vendor_team_invite", { p_email: email, p_level: s(fd, "level", 20) }, `Invited ${email}. They can sign in with that address.`);
}

export async function setMemberLevel(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("admin", "vendor_team_set_level", { p_member: uuid(fd, "id"), p_level: s(fd, "level", 20) }, "Access updated.");
}

export async function removeMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("admin", "vendor_team_remove", { p_member: uuid(fd, "id") }, "Removed from your team.");
}

export async function saveSite(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const num = (k: string) => {
    const v = s(fd, k, 20);
    if (v === null) return "";
    return Number.isFinite(Number(v)) ? v : "x";
  };
  const lat = num("latitude"), lon = num("longitude");
  if (lat === "x" || lon === "x") return fail("Latitude and longitude are decimal numbers, e.g. 52.4064.");
  if ((lat === "") !== (lon === "")) return fail("Enter both latitude and longitude, or neither.");
  const country = (s(fd, "country_alpha2", 2) ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return fail("Choose the country.");
  const locode = (s(fd, "locode", 6) ?? "").toUpperCase().replace(/\s/g, "");
  if (locode && (!/^[A-Z]{2}[A-Z2-9]{3}$/.test(locode) || !locode.startsWith(country))) return fail(`The UN/LOCODE should be five characters starting with ${country}, e.g. ${country}XXX.`);
  const p = {
    name: s(fd, "name", 200), site_type: s(fd, "site_type", 20), address_line1: s(fd, "address_line1", 300), address_line2: s(fd, "address_line2", 300),
    city: s(fd, "city", 120), postcode: s(fd, "postcode", 30), country_alpha2: country, locode, latitude: lat, longitude: lon,
    contact_name: s(fd, "contact_name", 200), contact_phone: s(fd, "contact_phone", 50), is_default_dispatch: fd.get("is_default_dispatch") === "on",
  };
  if (!p.name) return fail("Give the site a name.");
  return rpc("standard", "vendor_site_save", { p_id: uuid(fd, "id"), p }, "Site saved.");
}

export async function setDefaultSite(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("standard", "vendor_site_set_default", { p_id: uuid(fd, "id") }, "Default dispatch site updated.");
}

export async function archiveSite(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("standard", "vendor_site_archive", { p_id: uuid(fd, "id") }, "Site archived.");
}

export async function requestPlan(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return rpc("admin", "vendor_request_subscription", { p_tier: s(fd, "tier", 20), p_note: s(fd, "note", 1000) },
    "Request sent. adm Indicia's account team will contact you to confirm.");
}

// ---------------------------------------------------------------------------
// Shipping & POD (Logistics+ vendor functions)
// ---------------------------------------------------------------------------
const int = (fd: FormData, k: string) => {
  const v = s(fd, k, 12);
  return v && /^\d+$/.test(v) ? Number(v) : null;
};
const dec = (fd: FormData, k: string) => {
  const v = s(fd, k, 20);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export async function recordShipment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const qty = int(fd, "quantity"), weight = dec(fd, "gross_weight_kg");
  if (!qty) return fail("Enter the quantity shipped as a whole number.");
  if (Number.isNaN(weight) || (weight !== null && weight < 0)) return fail("Gross weight is a number of kilograms.");
  if (!date(fd, "dispatch_date")) return fail("Enter the dispatch date.");
  return rpc("standard", "logistics_vendor_record_shipment", {
    p_delivery: uuid(fd, "delivery"), p_carrier_code: s(fd, "carrier_code", 40), p_service_level: s(fd, "service_level", 60),
    p_tracking: s(fd, "tracking", 100), p_dispatch_date: date(fd, "dispatch_date"), p_quantity: qty, p_gross_weight_kg: weight, p_notes: s(fd, "notes", 1000),
  }, "Shipment recorded. Upload the POD once it's delivered.");
}

export async function attachPod(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const v = await vendor("standard");
  if ("error" in v) return fail(v.error);
  const shipment = uuid(fd, "shipment");
  if (!shipment) return fail("Shipment not found.");
  const f = await storeFile(fd, "file", "logistics", "shipment", shipment, "POD");
  if ("error" in f) return fail(f.error);
  const { error } = await v.supabase.rpc("logistics_vendor_attach_pod", { p_shipment: shipment, p_file_id: f.id, p_delivered_on: date(fd, "delivered_on") });
  if (error) return fail(error.message);
  return done("POD uploaded. adm Indicia will check it against the checklist.");
}

// ---------------------------------------------------------------------------
// Installations and recces (Execution+ vendor functions)
// ---------------------------------------------------------------------------
export async function recordInstall(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const v = await vendor("standard");
  if ("error" in v) return fail(v.error);
  const dep = uuid(fd, "deployment");
  if (!dep) return fail("Deployment not found.");
  const lat = dec(fd, "lat"), lon = dec(fd, "lon");
  if (Number.isNaN(lat) || Number.isNaN(lon) || (lat !== null && Math.abs(lat) > 90) || (lon !== null && Math.abs(lon) > 180)) return fail("Check the GPS position: latitude and longitude are decimal degrees.");
  const qty = int(fd, "quantity");
  if (qty === null) return fail("Enter the installed quantity.");
  // Photos first (only if chosen now; earlier uploads count too).
  for (const [field, label] of [["before", "Before"], ["after", "After"]] as const) {
    const file = fd.get(field);
    if (file instanceof File && file.size > 0) {
      const r = await storeFile(fd, field, "execution", "deployment", dep, label);
      if ("error" in r) return fail(r.error);
    }
  }
  const { error } = await v.supabase.rpc("execution_vendor_record_install", {
    p_deployment: dep, p_installation_date: date(fd, "installation_date"), p_installer_name: s(fd, "installer", 200), p_quantity: qty,
    p_lat: lat, p_lon: lon, p_notes: s(fd, "notes", 2000),
  });
  if (error) return fail(error.message);
  return done("Install recorded. adm Indicia will audit it.");
}

export async function saveRecce(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const confirm = fd.get("intent") === "confirm";
  const nums = ["available_width_cm", "available_height_cm", "available_depth_cm", "unit_width_cm", "unit_height_cm", "unit_depth_cm"];
  const data: Record<string, string> = {};
  for (const k of nums) {
    const n = dec(fd, k);
    if (Number.isNaN(n) || (n !== null && (n < 0 || n > 100000))) return fail("Measurements are numbers in centimetres.");
    data[k] = n === null ? "" : String(n);
  }
  const yn = (k: string) => (["true", "false"].includes(String(fd.get(k))) ? String(fd.get(k)) : "");
  const surface = s(fd, "surface_type", 20) ?? "";
  if (surface && !["glass", "wall", "shelf", "floor", "ceiling", "counter", "gondola_end", "other"].includes(surface)) return fail("Choose a surface type.");
  Object.assign(data, {
    product_name: s(fd, "product_name", 200) ?? "", location_in_store: s(fd, "location_in_store", 200) ?? "", surface_type: surface,
    wall_space_available: yn("wall_space_available"), power_outlet_nearby: yn("power_outlet_nearby"), survey_date: date(fd, "survey_date") ?? "", notes: s(fd, "notes", 2000) ?? "",
  });
  const recce = uuid(fd, "recce"), outlet = uuid(fd, "outlet");
  if (!recce && !outlet) return fail("Choose the outlet.");
  return rpc("standard", "execution_vendor_recce_save", { p_recce: recce, p_outlet: recce ? null : outlet, p_data: data, p_confirm: confirm },
    confirm ? "Recce confirmed and sent to adm Indicia." : "Recce saved as a draft.");
}
