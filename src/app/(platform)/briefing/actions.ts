"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { renderConceptSvg } from "@/lib/ai/concept-render";
import { createClient } from "@/lib/supabase/server";
import {
  canIdeate, DEFAULT_PARAMS, ECO_TAG, PARAM_OPTIONS, SPEC_TYPE_LABEL,
  type ConceptRow, type CreativeParams, type ProductTypeSuggestion,
} from "@/lib/briefing";
import { getBrief, getLibrary, getSession, getSessionTranscript, getSubstrates } from "@/lib/briefing-data";
import { getEffectiveness } from "@/lib/shopper-iq-data";
import { whatWorked } from "@/lib/shopper-iq";
import { ideateBrief, ideateCampaign } from "@/lib/ai/briefing-ideation";
import { AiError } from "@/lib/ai/claude";
import { getClientTargets } from "@/lib/client-targets-data";
import { allowedSubstrates, withClientTargets } from "@/lib/client-targets";

export type ActionResult = { ok: boolean; message: string };

const done = () => revalidatePath("/briefing", "layout");
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const list = (fd: FormData, k: string) => fd.getAll(k).map((v) => String(v).trim()).filter(Boolean);

function briefPayload(fd: FormData) {
  return {
    campaign_id: str(fd, "campaign_id"), region: str(fd, "region"), market: str(fd, "market"), client: str(fd, "client"),
    brand: str(fd, "brand"), division: str(fd, "division"), title: str(fd, "title"), objective: str(fd, "objective"),
    brief_text: str(fd, "brief_text"), target_outlets: str(fd, "target_outlets"), budget_low: str(fd, "budget_low"),
    budget_high: str(fd, "budget_high"), currency: str(fd, "currency") || "GBP", target_launch: str(fd, "target_launch"),
    product_category: str(fd, "product_category"), sustainability_targets: str(fd, "sustainability_targets"),
    min_recycled_pct: str(fd, "min_recycled_pct"), require_fsc: fd.get("require_fsc") === "on",
  };
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------
export async function createBrief(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const p = briefPayload(fd);
  if (!p.title) return { ok: false, message: "Give the brief a title." };
  const { data, error } = await supabase.rpc("brief_create", { p, p_submit: fd.get("intent") === "submit" });
  if (error) return { ok: false, message: error.message };
  done();
  redirect(`/briefing/${data as string}`);
}

export async function updateBrief(id: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("brief_update", { p_id: id, p: briefPayload(fd) });
  if (error) return { ok: false, message: error.message };
  done();
  redirect(`/briefing/${id}?saved=${Number(data) || 0}`);
}

/** Brief types (b2) and the creative decision (b4), as in the Global Business Transformation brief intake process. */
export async function setBriefProcess(id: string, p: { brief_types?: string[]; creative_needed?: boolean | null; creative_route?: string | null }): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_set_process", { p_id: id, p });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Saved." };
}

/** The project manager has reviewed the brief with operational creative (b5). */
export async function creativeReviewBrief(id: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_creative_review", { p_id: id, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Creative review recorded." };
}

// Creative commercials (GBT creative work, cr4 to cr7).
export async function kickoffCreative(id: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("creative_kickoff", { p_brief: id, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Kick-off recorded. Creative work can start." };
}
export async function saveCreativeQuote(id: string, q: { basis: string; rate: string; units: string; amount: string; currency: string; scope_note: string }): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("creative_quote_save", { p_brief: id, p: q });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Quote saved. Send it to the client when it is ready." };
}
export async function sendCreativeQuote(id: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("creative_quote_send", { p_brief: id });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Quote sent. The client's approvers can decide it in their portal." };
}
export async function confirmCreativePo(id: string, po: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("creative_quote_confirm_po", { p_brief: id, p_po: po.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Quote approval and client PO confirmed. Creative work can start." };
}

// Creative RFI to panel suppliers (GBT creative work, cr11 to cr12b).
export async function createCreativeRfi(id: string, f: { title: string; supplier_brief: string; ip_rule: string; due_date: string }, suppliers: string[]): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  // The due date is the end of the chosen day.
  const due_at = f.due_date ? new Date(`${f.due_date}T17:00:00`).toISOString() : "";
  const { error } = await supabase.rpc("creative_rfi_create", { p_brief: id, p: { title: f.title, supplier_brief: f.supplier_brief, ip_rule: f.ip_rule, due_at }, p_suppliers: suppliers });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: `RFI sent to ${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}.` };
}
export async function addCreativeRfiSupplier(id: string, rfi: string, supplier: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("creative_rfi_add_supplier", { p_rfi: rfi, p_supplier: supplier });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Supplier added and invited." };
}
export async function selectCreativeProposal(id: string, invite: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("creative_rfi_select", { p_invite: invite, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Proposal selected. Present it to the client as a concept for approval." };
}

// Samples (GBT creative work, cr16 and cr18).
export async function setSamplesNeeded(id: string, needed: boolean, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_set_samples", { p_brief: id, p_needed: needed, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: needed ? "Samples needed. Ask a supplier for one below." : "Recorded: no samples needed." };
}
export async function requestSample(id: string, f: { supplier: string; description: string; quantity: string; needed_by: string }): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sample_request", { p_brief: id, p_supplier: f.supplier, p_description: f.description, p_quantity: Number(f.quantity) || 1, p_needed_by: f.needed_by || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Sample requested. The supplier sees it in the vendor portal." };
}
export async function receiveSample(id: string, sample: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sample_receive", { p_sample: sample, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Arrival recorded." };
}
export async function reviewSample(id: string, sample: string, approve: boolean, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("sample_review", { p_sample: sample, p_approve: approve, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: approve ? "Sample approved." : "Changes sent to the supplier." };
}

// Final creative files (GBT creative work, cr19).
export async function startFinalFiles(id: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("creative_delivery_start", { p_brief: id });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Upload the final files, then send them to the client." };
}
export async function sendFinalFiles(id: string, delivery: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("creative_delivery_send", { p_delivery: delivery, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Sent. The client can download the files in their portal." };
}

/** Send an incomplete brief back to the client with the reason, and optionally ask for a meeting (b6). */
export async function sendBriefBack(id: string, reason: string, meeting: boolean): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_send_back", { p_id: id, p_reason: reason, p_meeting: meeting });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Sent back to the client. They will see the reason in their portal and can resubmit." };
}

export async function submitBrief(id: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_submit", { p_id: id });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Submitted. A colleague now needs to approve it before ideation." };
}

export async function decideBrief(id: string, decision: "approved" | "changes_requested", comments: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_decide", { p_id: id, p_decision: decision, p_comments: comments });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: decision === "approved" ? "Approved: the brief is ready for ideation." : "Changes requested: returned to the author." };
}

export async function archiveBrief(id: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_archive", { p_id: id, p_note: note });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Archived." };
}

/** Repeat order: a draft copy of the brief (optionally for another market), linked to the original. */
export async function duplicateBrief(_prev: { ok?: boolean; error?: string; message?: string }, fd: FormData): Promise<{ ok?: boolean; error?: string; message?: string }> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("brief_duplicate", {
    p_brief: String(fd.get("id") ?? ""), p_market: String(fd.get("market") ?? "") || null, p_title: String(fd.get("title") ?? "") || null,
  });
  if (error) return { error: error.message };
  done();
  redirect(`/briefing/${data as string}?edit=1`);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
export async function saveCampaign(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const markets = list(fd, "markets").map((m) => {
    const [region, market] = m.split(":");
    return { region, market };
  });
  const p = {
    name: str(fd, "name"), client: str(fd, "client"), brands: str(fd, "brands").split(",").map((s) => s.trim()).filter(Boolean),
    division: str(fd, "division"), brand_tier: str(fd, "brand_tier"), objective: str(fd, "objective"),
    campaign_type: str(fd, "campaign_type"), activation_objective: str(fd, "activation_objective"),
    channels: list(fd, "channels"), store_types: list(fd, "store_types"), p2p_stages: list(fd, "p2p_stages"),
    start_date: str(fd, "start_date"), end_date: str(fd, "end_date"), status: str(fd, "status"), markets,
  };
  if (!p.name) return { ok: false, message: "Give the campaign a name." };
  const { data, error } = await supabase.rpc("campaign_save", { p_id: id, p });
  if (error) return { ok: false, message: error.message };
  done();
  revalidatePath("/shopper-iq", "layout");
  redirect(`/briefing/campaigns/${data as string}`);
}

// ---------------------------------------------------------------------------
// AI ideation (server-side only; history lives in ideation_* tables)
// ---------------------------------------------------------------------------
function cleanParams(p: Partial<CreativeParams> | undefined): CreativeParams {
  const pick = (k: "innovation" | "sustainability" | "budget") =>
    PARAM_OPTIONS[k].some((o) => o.value === p?.[k]) ? (p![k] as string) : DEFAULT_PARAMS[k];
  return { innovation: pick("innovation"), sustainability: pick("sustainability"), budget: pick("budget"), format: p?.format?.slice(0, 200) || undefined };
}

type BriefTurn = ActionResult & { sessionId?: string };

async function runOneBrief(briefId: string, opts: { direction?: string; params?: Partial<CreativeParams>; fresh?: boolean; bulkRunId?: string }): Promise<BriefTurn> {
  const supabase = await createClient();
  const brief = await getBrief(supabase, briefId);
  if (!brief) return { ok: false, message: "Brief not found." };
  if (!canIdeate(brief)) return { ok: false, message: "Ideation opens once a colleague has approved the brief." };
  const direction = (opts.direction ?? "").slice(0, 2000);
  const params = cleanParams(opts.params);

  let sessionId: string | null = null;
  if (!opts.fresh && !opts.bulkRunId) {
    const { data } = await supabase.from("ideation_sessions").select("id").eq("brief_id", briefId).order("created_at", { ascending: false }).limit(1);
    sessionId = ((data as { id: string }[]) ?? [])[0]?.id ?? null;
  }
  if (!sessionId) {
    const { data, error } = await supabase.rpc("ideation_start", {
      p_kind: "brief", p_brief: briefId, p_objective: null, p_context: { client: brief.client, brand: brief.brand, market: brief.market },
      p_params: params, p_bulk: opts.bulkRunId ?? null,
    });
    if (error) return { ok: false, message: error.message };
    sessionId = data as string;
  }
  const [{ messages, allConcepts }, allSubstrates, eff, clientTargets] = await Promise.all([
    getSessionTranscript(supabase, sessionId), getSubstrates(supabase), getEffectiveness(supabase),
    getClientTargets(supabase, (brief as { client_id?: string | null }).client_id, brief.client),
  ]);
  // The client's standing targets (CRM) fold into the brief, stricter wins; excluded materials are never offered.
  const substrates = allowedSubstrates(allSubstrates, clientTargets);
  try {
    const r = await ideateBrief({
      brief: withClientTargets(brief, clientTargets), substrates, whatWorked: whatWorked(eff, { client: brief.client, brand: brief.brand, market: brief.market }),
      params, history: messages, allConcepts, direction, clientTargets,
    });
    const concepts = r.concepts.map((c, idx) => ({ kind: "spec_concept", idx, is_top: idx === r.topIndex, name: c.name, data: c, substrate_record_id: c.suggested_substrate_id }));
    const { error } = await supabase.rpc("ideation_add_turn", {
      p_session: sessionId, p_user_message: direction, p_reply: r.reply, p_concepts: concepts, p_model: r.model,
      p_prompt_version: r.promptVersion, p_context: r.snapshot, p_demo: r.demo,
    });
    if (error) return { ok: false, message: error.message, sessionId };
    return { ok: true, message: r.demo ? "Demo suggestions — no AI key configured." : "New concepts ready.", sessionId };
  } catch (e) {
    return { ok: false, message: e instanceof AiError ? e.message : `Ideation failed: ${(e as Error).message}`, sessionId };
  }
}

export async function runBriefIdeation(briefId: string, opts: { direction?: string; params?: Partial<CreativeParams>; fresh?: boolean }): Promise<BriefTurn> {
  await requireInternal();
  const r = await runOneBrief(briefId, opts);
  revalidatePath(`/briefing/${briefId}`);
  return r;
}

export async function startBulkRun(briefIds: string[], params?: Partial<CreativeParams>): Promise<ActionResult & { runId?: string }> {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ideation_bulk_start", { p_brief_ids: briefIds, p_params: cleanParams(params) });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Started.", runId: data as string };
}

export async function runBulkOne(runId: string, briefId: string, params?: Partial<CreativeParams>): Promise<BriefTurn> {
  await requireInternal();
  return runOneBrief(briefId, { params, bulkRunId: runId });
}

export type CampaignIdeationState = ActionResult & {
  sessionId?: string; demo?: boolean; reply?: string; model?: string;
  suggestions?: (ProductTypeSuggestion & { concept_id: string })[];
};

export async function runCampaignIdeation(input: { objective: string; client?: string; brand?: string; division?: string; market?: string }): Promise<CampaignIdeationState> {
  await requireInternal();
  const supabase = await createClient();
  const objective = (input.objective ?? "").trim().slice(0, 2000);
  if (!objective) return { ok: false, message: "Describe the campaign objective first." };
  const context = { client: input.client?.trim() || undefined, brand: input.brand?.trim() || undefined, division: input.division?.trim() || undefined, market: input.market?.trim() || undefined };
  const { data: sid, error } = await supabase.rpc("ideation_start", { p_kind: "campaign", p_brief: null, p_objective: objective, p_context: context, p_params: {} });
  if (error) return { ok: false, message: error.message };
  const [touchpoints, eff, clientTargets] = await Promise.all([getLibrary(supabase, "touchpoint_types"), getEffectiveness(supabase), getClientTargets(supabase, null, context.client)]);
  const used = new Set(eff.filter((r) => context.client && r.client === context.client).map((r) => r.touchpoint_id));
  try {
    const r = await ideateCampaign({ objective, context, touchpoints, usedTouchpointIds: used, clientTargets });
    const { data, error: e2 } = await supabase.rpc("ideation_add_turn", {
      p_session: sid, p_user_message: objective, p_reply: r.reply,
      p_concepts: r.suggestions.map((s, idx) => ({ kind: "product_type", idx, name: s.product_type_name, data: s, touchpoint_record_id: s.product_type_id || null })),
      p_model: r.model, p_prompt_version: r.promptVersion, p_context: r.snapshot, p_demo: r.demo,
    });
    if (e2) return { ok: false, message: e2.message };
    const ids = ((data as { concept_ids: string[] })?.concept_ids ?? []);
    return { ok: true, message: "", sessionId: sid as string, demo: r.demo, reply: r.reply, model: r.model, suggestions: r.suggestions.map((s, i) => ({ ...s, concept_id: ids[i] })) };
  } catch (e) {
    return { ok: false, message: e instanceof AiError ? e.message : `Ideation failed: ${(e as Error).message}` };
  }
}

/** "Use this" / "Bundle & use": a DRAFT brief built from stored suggestions (read back from the database, not the browser). */
export async function createBriefFromSuggestions(sessionId: string, conceptIds: string[]): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const session = await getSession(supabase, sessionId);
  if (!session || session.kind !== "campaign") return { ok: false, message: "Ideation session not found." };
  const { allConcepts } = await getSessionTranscript(supabase, sessionId);
  const picks = allConcepts.filter((c) => conceptIds.includes(c.id)).sort((a, b) => a.idx - b.idx);
  if (!picks.length) return { ok: false, message: "Choose at least one suggestion." };
  const objective = session.objective ?? "";
  const ctx = session.context as { client?: string; brand?: string; division?: string; market?: string };
  const line = (c: ConceptRow) => {
    const s = c.data as ProductTypeSuggestion;
    return `${s.product_type_name} (${SPEC_TYPE_LABEL[s.suggested_spec_type] ?? (s.suggested_spec_type || "unspecified")})${s.rationale ? ` — ${s.rationale}` : ""}${s.eco ? ` · indicative eco ${s.eco.score}/100 (${ECO_TAG[s.eco.tag]?.label ?? s.eco.tag})` : ""}`;
  };
  const names = picks.map((c) => c.name);
  const p = {
    title: picks.length === 1 ? `${names[0]}: campaign` : `${picks.length} product types: campaign`,
    objective, client: ctx.client ?? "", brand: ctx.brand ?? "", division: ctx.division ?? "", market: ctx.market ?? "",
    region: "", product_category: (picks[0].data as ProductTypeSuggestion).product_type_name,
    brief_text: [
      `Campaign objective: ${objective}`, "",
      picks.length === 1 ? `Suggested product type: ${line(picks[0])}` : `Bundled product-type suggestions (${picks.length}):\n${picks.map((c, i) => `${i + 1}. ${line(c)}`).join("\n")}`,
      "", `Note: these product types are creative suggestions from Campaign ideation (${picks[0].demo ? "demo, no AI key configured" : picks[0].model}), not data-verified predictions.`,
    ].join("\n"),
    source: `campaign-ideation:${sessionId}`,
  };
  const { data, error } = await supabase.rpc("brief_create", { p, p_submit: false });
  if (error) return { ok: false, message: error.message };
  done();
  redirect(`/briefing/${data as string}?from=ideation`);
}

// ---------------------------------------------------------------------------
// Concept approval (approver, maker-checker and client sign-off are enforced in the database)
// ---------------------------------------------------------------------------
export async function submitConcept(conceptId: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("concept_submit", { p_concept: conceptId, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  revalidatePath("/watchtower/approvals");
  return { ok: true, message: "Submitted for approval. A colleague with the approval role will decide it." };
}

/** Draw the concept's illustration (Claude as an SVG, or an offline mock-up without a key) and store it on the concept. */
export async function renderConcept(conceptId: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { data } = await supabase.from("ideation_concepts").select("data, name").eq("id", conceptId).maybeSingle();
  if (!data) return { ok: false, message: "Concept not found." };
  const d = (data as { data: Record<string, unknown>; name: string }).data;
  try {
    const r = await renderConceptSvg({ ...(d as object), name: (data as { name: string }).name } as Parameters<typeof renderConceptSvg>[0]);
    const { error } = await supabase.rpc("ideation_concept_set_render", { p_concept: conceptId, p_svg: r.svg, p_model: r.model });
    if (error) return { ok: false, message: error.message };
    done();
    return { ok: true, message: r.demo ? "Visual drawn (offline mock-up: set ANTHROPIC_API_KEY for a Claude illustration)." : "Visual rendered." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The render failed. Try again." };
  }
}

export async function decideConcept(conceptId: string, decision: "approved" | "changes_requested", comments: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("concept_decide", { p_concept: conceptId, p_decision: decision, p_comments: comments.trim() || null });
  if (error) return { ok: false, message: error.message };
  done();
  revalidatePath("/watchtower/approvals");
  return { ok: true, message: decision === "approved" ? "Approved." : "Changes requested: returned to the submitter." };
}

export async function createBriefsFromConcept(conceptId: string, markets: string[]): Promise<ActionResult & { ids?: string[] }> {
  await requireInternal();
  const clean = [...new Set(markets.map((m) => m.trim().toUpperCase()).filter((m) => /^[A-Z]{2}$/.test(m)))];
  if (!clean.length) return { ok: false, message: "Choose at least one market." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("campaign_concept_to_briefs", { p_concept: conceptId, p_markets: clean });
  if (error) return { ok: false, message: error.message };
  done();
  const ids = (data as string[] | null) ?? [];
  return { ok: true, message: `${ids.length} draft brief${ids.length === 1 ? "" : "s"} created. Check each one, then submit it for approval.`, ids };
}

export async function sendToSourcing(conceptId: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_handoff_create", { p_concept: conceptId, p_note: note || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Sent to Sourcing. It will appear in their queue to open as a job." };
}
