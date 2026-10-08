import "server-only";
import { callStructured, isAiConfigured, type Turn } from "./claude";
import { BRIEF_PROMPT_VERSION, BRIEF_SYSTEM, BRIEF_TOOL, CAMPAIGN_PROMPT_VERSION, CAMPAIGN_SYSTEM, CAMPAIGN_TOOL, tagSafe } from "./briefing-prompts";
import { mockBriefConcepts, mockProductTypes } from "./briefing-mock";
import {
  budgetRange, marketName, normalizeEco, PARAM_LABEL, SPEC_TYPES,
  type Brief, type ConceptRow, type CreativeParams, type MessageRow, type ProductTypeSuggestion, type SpecConcept, type SubstrateSpecs,
} from "@/lib/briefing";
import type { LibraryRecord } from "@/lib/briefing-data";
import type { WhatWorked } from "@/lib/shopper-iq";

export const DEMO_MODEL = "demo-offline";

export type BriefIdeationResult = {
  reply: string; concepts: SpecConcept[]; topIndex: number; model: string; promptVersion: string; demo: boolean;
  snapshot: Record<string, unknown>;
};
export type CampaignIdeationResult = {
  reply: string; suggestions: ProductTypeSuggestion[]; model: string; promptVersion: string; demo: boolean; snapshot: Record<string, unknown>;
};

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function substrateSpecs(rec: LibraryRecord | undefined): SubstrateSpecs | null {
  if (!rec) return null;
  const d = rec.data ?? {};
  return {
    substrate_type: (d.substrate_type as string) ?? null, measurement_basis: (d.measurement_basis as string) ?? null,
    grammage_gsm: num(d.grammage_gsm), thickness_mm: num(d.thickness_mm), density_kg_per_m3: num(d.density_kg_per_m3),
    recycled_content_percent: num(d.recycled_content_percent), fsc_certified: !!d.fsc_certified,
    verification_status: (d.verification_status as string) ?? "indicative",
  };
}

function substrateLine(s: LibraryRecord) {
  const x = substrateSpecs(s)!;
  const parts = [`id:${s.id}`, s.name, `type:${x.substrate_type ?? "?"}`];
  if (x.measurement_basis === "grammage" && x.grammage_gsm != null) parts.push(`${x.grammage_gsm}gsm`);
  if (x.thickness_mm != null) parts.push(`${x.thickness_mm}mm`);
  if (x.density_kg_per_m3 != null) parts.push(`${x.density_kg_per_m3}kg/m³`);
  if (x.recycled_content_percent != null) parts.push(`${x.recycled_content_percent}% recycled`);
  if (x.fsc_certified) parts.push("FSC");
  return parts.join(", ");
}

function briefBlock(b: Brief) {
  return [
    `Title: ${b.title}`,
    b.objective ? `Objective: ${b.objective}` : "",
    `Brief: ${b.brief_text ?? ""}`,
    b.target_outlets ? `Target outlets: ${b.target_outlets}` : "",
    budgetRange(b) ? `Budget: ${budgetRange(b)}` : "",
    b.target_launch ? `Target launch: ${b.target_launch}` : "",
    b.client ? `Client: ${b.client}` : "", b.brand ? `Brand: ${b.brand}` : "", b.division ? `Division: ${b.division}` : "",
    b.market ? `Market: ${marketName(b.market)} (${b.region ?? "?"})` : "",
    b.product_category ? `Product category: ${b.product_category}` : "",
    b.sustainability_targets ? `Sustainability targets: ${b.sustainability_targets}` : "",
    b.min_recycled_pct != null ? `Minimum recycled content: ${b.min_recycled_pct}%` : "",
    b.require_fsc ? "FSC certified material required" : "",
  ].filter(Boolean).map(tagSafe).join("\n");
}

function historyBlock(w: WhatWorked[]) {
  if (!w.length) return "No measured history for this client or brand yet — ideate fresh.";
  return `What worked before (Shopper IQ execution scores, ${w[0].scope === "all" ? "all clients" : `this ${w[0].scope}`}):\n` +
    w.map((x) => `- ${x.touchpoint}${x.p2pStage ? ` (${x.p2pStage})` : ""}: execution score ${x.avgScore.toFixed(0)}/100` +
      `${x.avgUplift != null ? `, measured uplift ${x.avgUplift.toFixed(1)}% from ${x.measured} source(s)` : ""}; e.g. ${x.examples.join(", ")}`).join("\n");
}

const paramsBlock = (p: CreativeParams) =>
  [`${PARAM_LABEL.innovation} boldness: ${p.innovation}`, `${PARAM_LABEL.sustainability} priority: ${p.sustainability}`, `${PARAM_LABEL.budget} sensitivity: ${p.budget}`,
    p.format ? `Format/channel constraints: ${tagSafe(p.format)}` : ""].filter(Boolean).join("\n");

/** Rebuild the conversation from our own tables. The first user turn carries the context; later turns are directions. */
function buildTurns(context: string, history: MessageRow[], allConcepts: ConceptRow[], direction: string): Turn[] {
  const raw: Turn[] = [{ role: "user", content: context }];
  for (const m of history) {
    if (m.role === "user") raw.push({ role: "user", content: `<user_direction>\n${tagSafe(m.content)}\n</user_direction>` });
    else {
      const cs = allConcepts.filter((c) => c.message_id === m.id).sort((a, b) => a.idx - b.idx);
      const summary = cs.length ? `\n\nConcepts I proposed: ${cs.map((c, i) => `${i + 1}. ${c.name}${c.data?.suggested_substrate_name ? ` (${c.data.suggested_substrate_name})` : ""}`).join("; ")}` : "";
      raw.push({ role: "assistant", content: m.content + summary });
    }
  }
  raw.push({ role: "user", content: direction.trim() ? `<user_direction>\n${tagSafe(direction)}\n</user_direction>` : (history.length ? "Generate a fresh set of concepts with the current creative parameters." : "Generate the first set of concepts.") });
  // Merge consecutive same-role turns so roles alternate.
  const turns: Turn[] = [];
  for (const t of raw) {
    const last = turns[turns.length - 1];
    if (last && last.role === t.role) last.content += "\n\n" + t.content;
    else turns.push({ ...t });
  }
  return turns;
}

/** Validate and normalise model output: substrate ids must be active library records; numbers clamped; at most 3 concepts. */
export function normaliseConcepts(raw: unknown[], substrates: LibraryRecord[], currency: string): SpecConcept[] {
  const byId = new Map(substrates.map((s) => [s.id, s]));
  return raw.slice(0, 3).map((x) => {
    const c = (x ?? {}) as Record<string, unknown>;
    const rawId = String(c.suggested_substrate_id ?? "").replace(/^id:/, "").trim();
    const sub = byId.get(rawId);
    const qty = num(c.indicative_quantity);
    const unit = num(c.indicative_unit_price);
    const fit = num(c.fit_score);
    return {
      name: String(c.name ?? "Untitled concept").slice(0, 120),
      rationale: String(c.rationale ?? ""),
      suggested_spec_type: SPEC_TYPES.includes(c.suggested_spec_type as never) ? String(c.suggested_spec_type) : "custom_goods_services",
      suggested_substrate_name: sub ? sub.name : ((c.suggested_substrate_name as string) || null),
      suggested_substrate_id: sub ? sub.id : null,
      suggested_length: num(c.suggested_length), suggested_width: num(c.suggested_width), suggested_depth: num(c.suggested_depth),
      suggested_unit: (c.suggested_unit as string) || null,
      suggested_calc_method: c.suggested_calc_method === "square_measurement" ? "square_measurement" : c.suggested_calc_method === "quantity" ? "quantity" : null,
      creative_direction: String(c.creative_direction ?? ""),
      risks: Array.isArray(c.risks) ? c.risks.map(String).slice(0, 6).concat(sub || !c.suggested_substrate_name ? [] : ["Material is not in the approved substrate library: check before specifying."]) : [],
      fit_score: fit == null ? null : Math.max(0, Math.min(100, Math.round(fit))),
      indicative_quantity: qty, indicative_unit_price: unit,
      indicative_total: num(c.indicative_total) ?? (qty != null && unit != null ? Math.round(qty * unit * 100) / 100 : null),
      price_currency: (c.price_currency as string) || currency,
      price_basis: (c.price_basis as string) || "rough estimate — no comparable history",
      eco: normalizeEco(c.eco),
      substrate_specs: substrateSpecs(sub),
    };
  });
}

export async function ideateBrief(opts: {
  brief: Brief; substrates: LibraryRecord[]; whatWorked: WhatWorked[]; params: CreativeParams;
  history: MessageRow[]; allConcepts: ConceptRow[]; direction: string;
}): Promise<BriefIdeationResult> {
  const { brief, substrates, whatWorked, params } = opts;
  const snapshot = {
    brief: { id: brief.id, code: brief.brief_code, title: brief.title, updated_at: brief.updated_at, revision: brief.revision_count },
    substrate_ids: substrates.slice(0, 60).map((s) => s.id),
    what_worked: whatWorked.map((w) => ({ touchpoint: w.touchpoint, score: Math.round(w.avgScore), scope: w.scope })),
    creative_params: params,
    direction: opts.direction || null,
    turns_before: opts.history.length,
  };
  if (!isAiConfigured()) {
    const m = mockBriefConcepts(brief, substrates, params, opts.direction);
    return { ...m, concepts: m.concepts.map((c) => ({ ...c, substrate_specs: substrateSpecs(substrates.find((s) => s.id === c.suggested_substrate_id)) })), model: DEMO_MODEL, promptVersion: BRIEF_PROMPT_VERSION, demo: true, snapshot };
  }
  const context = [
    `<brief>\n${briefBlock(brief)}\n</brief>`,
    `<substrate_library>\n${substrates.slice(0, 60).map((s) => tagSafe(substrateLine(s))).join("\n") || "(none configured)"}\n</substrate_library>`,
    `<history>\n${tagSafe(historyBlock(whatWorked))}\nNo awarded pricing history is available in the platform yet — give indicative prices and say they are rough estimates.\n</history>`,
    `Creative parameters:\n${paramsBlock(params)}`,
  ].join("\n\n");
  const { input, model } = await callStructured<{ reply?: string; top_concept_index?: number; concepts?: unknown[] }>({
    system: BRIEF_SYSTEM, tool: BRIEF_TOOL, turns: buildTurns(context, opts.history, opts.allConcepts, opts.direction),
  });
  const concepts = normaliseConcepts(Array.isArray(input.concepts) ? input.concepts : [], substrates, brief.currency);
  const top = Number(input.top_concept_index);
  return {
    reply: String(input.reply ?? ""), concepts, topIndex: Number.isInteger(top) && top >= 0 && top < concepts.length ? top : 0,
    model, promptVersion: BRIEF_PROMPT_VERSION, demo: false, snapshot,
  };
}

export async function ideateCampaign(opts: {
  objective: string; context: { client?: string; brand?: string; division?: string; market?: string };
  touchpoints: LibraryRecord[]; usedTouchpointIds: Set<string>;
}): Promise<CampaignIdeationResult> {
  const { objective, context, touchpoints, usedTouchpointIds } = opts;
  const snapshot = { objective, context, touchpoint_ids: touchpoints.map((t) => t.id), used_touchpoint_ids: [...usedTouchpointIds] };
  const finish = (raw: unknown[]): ProductTypeSuggestion[] => {
    const byId = new Map(touchpoints.map((t) => [t.id, t]));
    return raw.slice(0, 6).map((x) => {
      const s = (x ?? {}) as Record<string, unknown>;
      const id = String(s.product_type_id ?? "").replace(/^id:/, "").trim();
      const tp = byId.get(id);
      return {
        product_type_name: String(s.product_type_name || tp?.name || "Product type"),
        product_type_id: tp ? tp.id : "",
        rationale: String(s.rationale ?? ""),
        suggested_spec_type: SPEC_TYPES.includes(s.suggested_spec_type as never) ? String(s.suggested_spec_type) : "",
        client_history_match: !!(tp && usedTouchpointIds.has(tp.id)),
        eco: normalizeEco(s.eco),
      };
    });
  };
  if (!isAiConfigured()) {
    const m = mockProductTypes(objective, touchpoints, usedTouchpointIds);
    return { reply: m.reply, suggestions: finish(m.suggestions), model: DEMO_MODEL, promptVersion: CAMPAIGN_PROMPT_VERSION, demo: true, snapshot };
  }
  const used = touchpoints.filter((t) => usedTouchpointIds.has(t.id));
  const ctx = [context.client && `Client: ${context.client}`, context.brand && `Brand: ${context.brand}`, context.division && `Division: ${context.division}`,
    context.market && `Market: ${marketName(context.market)}`].filter(Boolean).map((s) => tagSafe(String(s))).join("\n");
  const user = [
    `<campaign_objective>\n${tagSafe(objective)}\n</campaign_objective>`,
    ctx ? `<context>\n${ctx}\n</context>` : "",
    `<history>\n${context.client ? (used.length ? `Product types this client has REAL history with (Shopper IQ records):\n${used.map((t) => `- ${tagSafe(t.name)} (id:${t.id})`).join("\n")}` : "This client has no recorded history yet — ideate fresh.") : "No client selected — suggest product types that fit the objective broadly."}\n</history>`,
    `<product_types>\n${touchpoints.map((t) => `- ${tagSafe(t.name)} (id:${t.id})`).join("\n") || "(none configured)"}\n</product_types>`,
  ].filter(Boolean).join("\n\n");
  const { input, model } = await callStructured<{ reply?: string; suggestions?: unknown[] }>({
    system: CAMPAIGN_SYSTEM, tool: CAMPAIGN_TOOL, turns: [{ role: "user", content: user }], maxTokens: 8000,
  });
  return { reply: String(input.reply ?? ""), suggestions: finish(Array.isArray(input.suggestions) ? input.suggestions : []), model, promptVersion: CAMPAIGN_PROMPT_VERSION, demo: false, snapshot };
}
