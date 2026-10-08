"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireInternal } from "@/lib/auth";
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
  const [{ messages, allConcepts }, substrates, eff] = await Promise.all([getSessionTranscript(supabase, sessionId), getSubstrates(supabase), getEffectiveness(supabase)]);
  try {
    const r = await ideateBrief({
      brief, substrates, whatWorked: whatWorked(eff, { client: brief.client, brand: brief.brand, market: brief.market }),
      params, history: messages, allConcepts, direction,
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
  const [touchpoints, eff] = await Promise.all([getLibrary(supabase, "touchpoint_types"), getEffectiveness(supabase)]);
  const used = new Set(eff.filter((r) => context.client && r.client === context.client).map((r) => r.touchpoint_id));
  try {
    const r = await ideateCampaign({ objective, context, touchpoints, usedTouchpointIds: used });
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

export async function sendToSourcing(conceptId: string, note: string): Promise<ActionResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("brief_handoff_create", { p_concept: conceptId, p_note: note || null });
  if (error) return { ok: false, message: error.message };
  done();
  return { ok: true, message: "Sent to Sourcing+. It will appear in their queue to open as a job." };
}
