"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";

async function call(fn: string, args: Record<string, unknown>, message: string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath("/execution", "layout");
  revalidatePath("/logistics", "layout");
  return { ok: true, message };
}

async function create(fn: string, args: Record<string, unknown>, to: (newId: string) => string): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath("/execution", "layout");
  redirect(to(data as string));
}

function pick(fd: FormData, keys: string[], numeric: string[] = []): { data: Record<string, string | null>; error?: string } {
  const data: Record<string, string | null> = {};
  for (const k of keys) {
    const v = str(fd, k);
    if (v != null && numeric.includes(k) && !Number.isFinite(Number(v))) return { data, error: `Enter a number for ${k.replace(/_/g, " ")}.` };
    data[k] = v;
  }
  return { data };
}

/* ---------- Outlets ---------- */
const OUTLET = ["name", "outlet_code", "client_id", "address_line", "city", "postcode", "market", "latitude", "longitude", "store_type", "status", "contact_name", "contact_phone", "contact_email", "notes"];
export async function saveOutlet(_: FormResult, fd: FormData): Promise<FormResult> {
  const { data, error } = pick(fd, OUTLET, ["latitude", "longitude"]);
  if (error) return { error };
  if (!id(fd)) return create("execution_outlet_save", { p_outlet: null, p_data: data }, (x) => `/execution/outlets/${x}`);
  return call("execution_outlet_save", { p_outlet: id(fd), p_data: data }, "Outlet saved");
}
export async function setOutletSupplier(_: FormResult, fd: FormData) {
  return call("execution_outlet_set_supplier", { p_outlet: id(fd), p_supplier: id(fd, "supplier_id"), p_visible: str(fd, "visible") !== "false" }, "Supplier visibility updated");
}

/* ---------- Recces ---------- */
const RECCE = ["product_name", "location_in_store", "surface_type", "available_width_cm", "available_height_cm", "available_depth_cm", "unit_width_cm", "unit_height_cm", "unit_depth_cm",
  "wall_space_available", "power_outlet_nearby", "survey_date", "notes", "job_id", "recommended_width_cm", "recommended_height_cm", "recommended_depth_cm", "recommended_notes"];
const RECCE_NUM = RECCE.filter((k) => k.endsWith("_cm"));
export async function saveRecce(_: FormResult, fd: FormData): Promise<FormResult> {
  const { data, error } = pick(fd, RECCE, RECCE_NUM);
  if (error) return { error };
  if (!id(fd)) return create("execution_recce_save", { p_recce: null, p_outlet: id(fd, "outlet_id"), p_data: data }, (x) => `/execution/recces/${x}`);
  return call("execution_recce_save", { p_recce: id(fd), p_outlet: null, p_data: data }, "Recce saved");
}
export async function setRecceStatus(_: FormResult, fd: FormData) {
  return call("execution_recce_set_status", { p_recce: id(fd), p_status: str(fd, "status") }, "Status updated");
}

/* ---------- Deployments ---------- */
export async function createDeployment(_: FormResult, fd: FormData): Promise<FormResult> {
  const qty = numOrNull(fd, "quantity");
  if (!qty || Number.isNaN(qty)) return { error: "Enter the quantity to install." };
  const po = str(fd, "po_spec")?.split("|") ?? [];
  return create("execution_deployment_create", {
    p_outlet: id(fd, "outlet_id"), p_po: po[0] ?? null, p_spec: po[1] ?? null, p_spec_version: id(fd, "spec_version_id"), p_quantity: qty,
    p_planned_date: str(fd, "planned_date"), p_delivery: id(fd, "delivery_id"),
  }, (x) => `/execution/deployments/${x}`);
}
export async function recordInstall(_: FormResult, fd: FormData) {
  const qty = numOrNull(fd, "quantity");
  const lat = numOrNull(fd, "lat"), lon = numOrNull(fd, "lon");
  if (qty == null || Number.isNaN(qty)) return { error: "Enter the quantity installed." };
  if (Number.isNaN(lat) || Number.isNaN(lon)) return { error: "GPS must be decimal numbers." };
  return call("execution_record_install", {
    p_deployment: id(fd), p_installation_date: str(fd, "installation_date"), p_installer_name: str(fd, "installer_name"), p_quantity: qty, p_lat: lat, p_lon: lon, p_notes: str(fd, "notes"),
  }, "Install recorded");
}
export async function auditDeployment(_: FormResult, fd: FormData) {
  const scores: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("score:")) continue;
    const n = Number(v);
    if (String(v).trim() === "" || !Number.isFinite(n)) return { error: "Score every criterion from 0 to 100." };
    scores[k.slice(6)] = n;
  }
  return call("execution_audit_deployment", { p_deployment: id(fd), p_scores: scores, p_notes: str(fd, "notes"), p_needs_review: str(fd, "needs_review") === "on" }, "Audit recorded");
}

/* ---------- Tickets and visits ---------- */
export async function createTicket(_: FormResult, fd: FormData): Promise<FormResult> {
  return create("execution_ticket_create", {
    p_deployment: id(fd, "deployment_id"), p_outlet: id(fd, "outlet_id"), p_issue_type: str(fd, "issue_type"), p_severity: str(fd, "severity"), p_description: str(fd, "description"),
  }, (x) => `/execution/tickets/${x}`);
}
export async function moveTicket(_: FormResult, fd: FormData) {
  return call("execution_ticket_move", { p_ticket: id(fd), p_status: str(fd, "status"), p_note: str(fd, "note"), p_root_cause: str(fd, "root_cause") }, "Ticket updated");
}
export async function createVisit(_: FormResult, fd: FormData) {
  const data: Record<string, string | null> = {};
  for (const k of ["deployment_id", "ticket_id", "recce_id", "supplier_id", "assigned_to", "notes"]) data[k] = str(fd, k);
  return call("execution_visit_create", { p_outlet: id(fd, "outlet_id"), p_type: str(fd, "visit_type"), p_scheduled: str(fd, "scheduled_date"), p_data: data }, "Visit scheduled");
}
export async function updateVisit(_: FormResult, fd: FormData) {
  return call("execution_visit_update", { p_visit: id(fd), p_status: str(fd, "status"), p_outcome: str(fd, "outcome"), p_notes: str(fd, "notes"), p_lat: null, p_lon: null }, "Visit updated");
}

/* ---------- Quality gates and job close ---------- */
export async function signOffGate(_: FormResult, fd: FormData) {
  return call("execution_gate_sign_off", { p_job: id(fd), p_gate: str(fd, "gate"), p_passed: str(fd, "decision") !== "fail", p_notes: str(fd, "notes") }, "Gate signed off");
}
export async function closeJob(_: FormResult, fd: FormData) {
  return call("execution_close_job", { p_job: id(fd), p_override_reason: str(fd, "override_reason") }, "Job closed");
}
