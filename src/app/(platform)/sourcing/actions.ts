"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bool, friendly, id, numOrNull, str, type FormResult } from "@/lib/sourcing-actions";
import { getComponents, getEmissionLibraries, getSpec, getVersions } from "@/lib/sourcing-data";
import { computeSpecCo2e, deriveComponentWeight, suggestHsCode } from "@/lib/sourcing-emissions";
import { REGIONS, SPEC_TYPES, COMPONENT_TYPES } from "@/lib/sourcing";

const jobSchema = z.object({
  title: z.string().min(1, "Give the job a title."),
  client_id: z.string().uuid("Choose a client."),
  billing_entity_id: z.string().uuid().nullable(),
  region: z.enum(REGIONS, { message: "Choose a region." }),
  market: z.string().min(1, "Enter the market (country)."),
  brief_id: z.string().uuid("The brief reference must be a valid id.").nullable(),
  category: z.string().nullable(),
  campaign_name: z.string().nullable(),
  brand: z.string().nullable(),
  client_job_ref: z.string().nullable(),
  budget: z.number().min(0, "Budget can't be negative.").nullable(),
  currency: z.string().length(3),
  quote_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  target_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().nullable(),
});

function readJob(fd: FormData) {
  return jobSchema.safeParse({
    title: str(fd, "title") ?? "", client_id: str(fd, "client_id") ?? "", billing_entity_id: str(fd, "billing_entity_id"),
    region: str(fd, "region") ?? "", market: str(fd, "market") ?? "", brief_id: str(fd, "brief_id"), category: str(fd, "category"),
    campaign_name: str(fd, "campaign_name"), brand: str(fd, "brand"), client_job_ref: str(fd, "client_job_ref"),
    budget: numOrNull(fd, "budget"), currency: (str(fd, "currency") ?? "EUR").toUpperCase(),
    quote_due_date: str(fd, "quote_due_date"), target_delivery_date: str(fd, "target_delivery_date"), notes: str(fd, "notes"),
  });
}

export async function createJob(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const p = readJob(fd);
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").insert(p.data).select("id").single();
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing", "layout");
  redirect(`/sourcing/jobs/${(data as { id: string }).id}`);
}

export async function updateJob(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const jobId = id(fd);
  const p = readJob(fd);
  if (!jobId) return { error: "Job not found." };
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update(p.data).eq("id", jobId);
  if (error) return { error: friendly(error) };
  revalidatePath(`/sourcing/jobs/${jobId}`);
  return { ok: true, message: "Job saved" };
}

export async function moveJob(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("job_set_status", { p_job: id(fd), p_status: str(fd, "status"), p_note: str(fd, "note") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/sourcing/jobs/${id(fd)}`);
  return { ok: true, message: "Job moved" };
}

/* ---------------- Specs ---------------- */

const SPEC_TYPE_VALUES = SPEC_TYPES.map((t) => t.value) as [string, ...string[]];

export async function createSpec(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const jobId = id(fd, "job_id");
  const title = str(fd, "title");
  const type = str(fd, "spec_type");
  const qty = numOrNull(fd, "quantity");
  if (!jobId) return { error: "Job not found." };
  if (!title) return { error: "Give the spec a title." };
  if (!type || !SPEC_TYPE_VALUES.includes(type)) return { error: "Choose a spec type." };
  if (qty == null || !Number.isInteger(qty) || qty <= 0) return { error: "Enter the quantity as a whole number above zero." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_specs").insert({
    job_id: jobId, title, spec_type: type, description: str(fd, "description"), size_unit: str(fd, "size_unit") ?? "mm",
    substrate_id: id(fd, "substrate_id"), brief_id: id(fd, "brief_id"), is_draft: bool(fd, "is_draft"),
  }).select("id").single();
  if (error) return { error: friendly(error) };
  const specId = (data as { id: string }).id;
  const { error: vErr } = await supabase.from("spec_versions").insert({
    spec_id: specId, name: str(fd, "version_name") ?? "Main", quantity: qty,
    finished_length: numOrNull(fd, "finished_length"), finished_width: numOrNull(fd, "finished_width"),
  });
  if (vErr) return { error: friendly(vErr) };
  await recompute(supabase, specId);
  revalidatePath(`/sourcing/jobs/${jobId}`);
  redirect(`/sourcing/specs/${specId}`);
}

export async function updateSpec(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const specId = id(fd);
  const title = str(fd, "title");
  const type = str(fd, "spec_type");
  if (!specId) return { error: "Spec not found." };
  if (!title) return { error: "Give the spec a title." };
  if (!type || !SPEC_TYPE_VALUES.includes(type)) return { error: "Choose a spec type." };
  const supabase = await createClient();
  const current = await getSpec(supabase, specId);
  const confirmedWeight = numOrNull(fd, "supplier_confirmed_unit_weight_grams");
  const spec_data = { ...(current?.spec_data ?? {}), supplier_confirmed_unit_weight_grams: confirmedWeight, total_pages: numOrNull(fd, "total_pages") };
  const { error } = await supabase.from("job_specs").update({
    title, spec_type: type, description: str(fd, "description"), hs_code: str(fd, "hs_code"), size_unit: str(fd, "size_unit"),
    calculation_method: str(fd, "calculation_method") ?? "quantity", substrate_id: id(fd, "substrate_id"), is_draft: bool(fd, "is_draft"), spec_data,
  }).eq("id", specId);
  if (error) return { error: friendly(error) };
  await recompute(supabase, specId);
  revalidatePath(`/sourcing/specs/${specId}`);
  return { ok: true, message: "Spec saved" };
}

export async function addVersion(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const specId = id(fd, "spec_id");
  const qty = numOrNull(fd, "quantity");
  if (!specId) return { error: "Spec not found." };
  if (qty == null || !Number.isInteger(qty) || qty <= 0) return { error: "Enter the quantity as a whole number above zero." };
  const supabase = await createClient();
  const { error } = await supabase.from("spec_versions").insert({
    spec_id: specId, name: str(fd, "name") ?? "Version", quantity: qty, finished_length: numOrNull(fd, "finished_length"),
    finished_width: numOrNull(fd, "finished_width"), item_code: str(fd, "item_code"), sort: numOrNull(fd, "sort") ?? 0,
  });
  if (error) return { error: friendly(error) };
  await recompute(supabase, specId);
  revalidatePath(`/sourcing/specs/${specId}`);
  return { ok: true, message: "Version added" };
}

export async function deleteVersion(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.from("spec_versions").delete().eq("id", id(fd));
  if (error) return { error: friendly(error) };
  await recompute(supabase, id(fd, "spec_id")!);
  revalidatePath(`/sourcing/specs/${id(fd, "spec_id")}`);
  return { ok: true };
}

export async function addComponent(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const specId = id(fd, "spec_id");
  const name = str(fd, "component_name");
  const type = str(fd, "component_type") ?? "body";
  if (!specId) return { error: "Spec not found." };
  if (!name) return { error: "Name the component." };
  if (!(COMPONENT_TYPES as readonly string[]).includes(type)) return { error: "Choose a component type." };
  const fields = {
    quantity_per_unit: numOrNull(fd, "quantity_per_unit") ?? 1, area_length_cm: numOrNull(fd, "area_length_cm"), area_width_cm: numOrNull(fd, "area_width_cm"),
    direct_weight_grams: numOrNull(fd, "direct_weight_grams"), thickness_mm_override: numOrNull(fd, "thickness_mm_override"), grammage_gsm_override: numOrNull(fd, "grammage_gsm_override"),
  };
  if (Object.values(fields).some((v) => Number.isNaN(v))) return { error: "Numbers only in the size and weight fields." };
  const supabase = await createClient();
  const { substrates } = await getEmissionLibraries(supabase);
  const substrateId = id(fd, "substrate_id");
  const w = deriveComponentWeight({ ...fields, substrate_id: substrateId }, substrateId ? substrates[substrateId] : null);
  const { error } = await supabase.from("spec_components").insert({
    spec_id: specId, component_name: name, component_type: type, is_packaging: type === "packaging" || bool(fd, "is_packaging"),
    substrate_id: substrateId, derived_weight_grams: w.grams, notes: str(fd, "notes"), ...fields,
  });
  if (error) return { error: friendly(error) };
  await recompute(supabase, specId);
  revalidatePath(`/sourcing/specs/${specId}`);
  return { ok: true, message: "Component added" };
}

export async function deleteComponent(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.from("spec_components").delete().eq("id", id(fd));
  if (error) return { error: friendly(error) };
  await recompute(supabase, id(fd, "spec_id")!);
  revalidatePath(`/sourcing/specs/${id(fd, "spec_id")}`);
  return { ok: true };
}

/** Recalculate unit weight, packaging weight, HS suggestion and material CO2e from the BOM (pure TS port), then store it. */
async function recompute(supabase: Awaited<ReturnType<typeof createClient>>, specId: string) {
  const [spec, versions, components, libs] = await Promise.all([getSpec(supabase, specId), getVersions(supabase, specId), getComponents(supabase, specId), getEmissionLibraries(supabase)]);
  if (!spec) return;
  const r = computeSpecCo2e({
    spec, versions, components, substratesById: libs.substrates, factorsByCode: libs.factors,
    singleSubstrate: spec.substrate_id ? libs.substrates[spec.substrate_id] : null,
  });
  const hs = spec.hs_code || (components.length ? suggestHsCode(components, libs.substrates) : null);
  await supabase.from("job_specs").update({
    unit_weight_grams: r.unitWeightGrams, packaging_weight_grams: r.packagingGrams || null,
    weight_basis: r.unitWeightGrams == null ? spec.weight_basis : components.some((c) => c.direct_weight_grams) || ["promo_merch", "custom_goods_services"].includes(spec.spec_type) ? "supplier_confirmed" : "calculated_from_material",
    co2e_kg_per_unit: r.perUnitKg, co2e_total_kg: r.totalKg,
    co2e_detail: { complete: r.complete, excluded: r.excluded, missing: r.missing, lines: r.lines.map((l) => ({ label: l.label, grams: l.grams, factor: l.factor, kgco2e: l.kgco2e, formula: l.formula, packaging: l.packaging })) },
    co2e_computed_at: new Date().toISOString(), hs_code: hs,
  }).eq("id", specId);
}

export async function recomputeSpec(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  await recompute(supabase, id(fd)!);
  revalidatePath(`/sourcing/specs/${id(fd)}`);
  return { ok: true, message: "Weights and CO2e recalculated" };
}

/* ---------------- Triage ---------------- */

export async function runTriage(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("spec_triage_run", { p_spec: id(fd) });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing", "layout");
  return { ok: true, message: "Triage done" };
}

export async function triageJob(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const jobId = id(fd, "job_id");
  const supabase = await createClient();
  const { data } = await supabase.from("v_specs").select("id, title, is_draft, route, push_status").eq("job_id", jobId as string);
  const specs = ((data ?? []) as { id: string; title: string; is_draft: boolean; route: string | null; push_status: string | null }[]).filter((s) => !s.is_draft && s.push_status !== "accepted");
  const problems: string[] = [];
  for (const s of specs) {
    const { error } = await supabase.rpc("spec_triage_run", { p_spec: s.id });
    if (error) problems.push(`${s.title}: ${friendly(error)}`);
  }
  revalidatePath("/sourcing", "layout");
  if (problems.length) return { error: problems.join(" · ") };
  return { ok: true, message: `${specs.length} spec line(s) triaged` };
}

export async function overrideTriage(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("spec_triage_override", { p_spec: id(fd), p_route: str(fd, "route"), p_reason: str(fd, "reason") });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing", "layout");
  return { ok: true, message: "Route changed" };
}

/** Adopt / Adapt / accepted Push lines on a job become estimates (one per supplier) in Order Management+. */
export async function estimateFromTriage(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("estimate_create_from_triage", { p_job: id(fd, "job_id") });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing", "layout");
  revalidatePath("/orders", "layout");
  return { ok: true, message: `${data} estimate(s) drafted in Order Management+` };
}

/* ---------------- Admin (clients, billing entities, access, settings) ---------------- */

export async function saveClient(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const row = {
    code: (str(fd, "code") ?? "").toUpperCase(), name: str(fd, "name"), default_currency: (str(fd, "default_currency") ?? "EUR").toUpperCase(),
    default_markup_percent: numOrNull(fd, "default_markup_percent") ?? 0, savings_target_percent: numOrNull(fd, "savings_target_percent") ?? 0,
    quote_tolerance_percent: numOrNull(fd, "quote_tolerance_percent"), min_quotes_required: numOrNull(fd, "min_quotes_required") ?? 3,
    e_tender_threshold: numOrNull(fd, "e_tender_threshold"), active: bool(fd, "active"), notes: str(fd, "notes"),
  };
  if (!row.code || !row.name) return { error: "Enter a code and a name." };
  if (Object.values(row).some((v) => typeof v === "number" && Number.isNaN(v))) return { error: "Numbers only in the commercial rule fields." };
  const supabase = await createClient();
  const clientId = id(fd);
  const { error } = clientId ? await supabase.from("sourcing_clients").update(row).eq("id", clientId) : await supabase.from("sourcing_clients").insert(row);
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/admin");
  return { ok: true, message: "Client saved" };
}

export async function saveBillingEntity(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const row = {
    code: (str(fd, "code") ?? "").toUpperCase(), name: str(fd, "name"), region: str(fd, "region"), market: str(fd, "market"),
    vat_number: str(fd, "vat_number"), currency: (str(fd, "currency") ?? "EUR").toUpperCase(), active: bool(fd, "active"),
  };
  if (!row.code || !row.name || !row.region || !row.market) return { error: "Enter code, name, region and market." };
  const supabase = await createClient();
  const beId = id(fd);
  const { error } = beId ? await supabase.from("sourcing_billing_entities").update(row).eq("id", beId) : await supabase.from("sourcing_billing_entities").insert(row);
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/admin");
  return { ok: true, message: "Billing entity saved" };
}

export async function setAccess(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const level = str(fd, "doa_level");
  const supabase = await createClient();
  const { error } = await supabase.rpc("sourcing_set_access", {
    p_user: id(fd, "user_id"), p_is_lead: bool(fd, "is_lead"), p_is_finance: bool(fd, "is_finance"), p_doa_level: level == null ? null : Number(level),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/admin");
  return { ok: true, message: "Access saved" };
}

export async function updateSettings(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sourcing_update_settings", {
    p_tolerance: numOrNull(fd, "triage_tolerance_percent"), p_push_threshold: (numOrNull(fd, "push_confidence_percent") ?? 90) / 100,
    p_instant_limit: numOrNull(fd, "instant_price_limit"), p_respond_days: numOrNull(fd, "push_respond_days"), p_reason: str(fd, "reason"),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/sourcing/admin");
  return { ok: true, message: "Settings saved" };
}
