// Deterministic demo ideation for when no ANTHROPIC_API_KEY is set. Built from the brief and the real substrate /
// touchpoint library records so the flow works end to end offline. Labelled in the UI as demo suggestions.
import { ecoTagFor, type Brief, type CreativeParams, type Eco, type SpecConcept } from "@/lib/briefing";
import type { LibraryRecord } from "@/lib/briefing-data";

const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function substrateEco(s: LibraryRecord): Eco {
  const d = s.data ?? {};
  const type = String(d.substrate_type ?? "").toLowerCase();
  const recycled = n(d.recycled_content_percent) ?? 0;
  const plastic = /plastic|pvc|acryl|vinyl|poly|pp|pet/.test(type + " " + s.name.toLowerCase());
  const fibre = /board|paper|corrug|kraft|card/.test(type + " " + s.name.toLowerCase());
  const carbon = fibre ? 78 : plastic ? 35 : 55;
  const eol = fibre ? 88 : plastic ? 30 : 50;
  const rc = Math.min(100, Math.round(recycled));
  const score = Math.round(carbon * 0.35 + rc * 0.3 + eol * 0.35 + (d.fsc_certified ? 4 : 0));
  return {
    score: Math.min(100, score), tag: ecoTagFor(Math.min(100, score)),
    rationale: `${s.name}: ${rc}% recycled content${d.fsc_certified ? ", FSC certified" : ""}, ${fibre ? "widely recyclable in paper streams" : plastic ? "hard to recycle at end of life" : "limited recyclability"}.`,
    dimensions: { carbon_footprint: carbon, recycled_content: rc, end_of_life: eol },
  };
}

function shapeFor(text: string): { label: string; spec: string; size: [number, number, number | null]; unitPrice: number } {
  const t = text.toLowerCase();
  if (/shelf.?talker|wobbler|strip/.test(t)) return { label: "shelf talker", spec: "2d", size: [100, 70, null], unitPrice: 0.6 };
  if (/header|topper|pallet/.test(t)) return { label: "header board", spec: "2d", size: [1000, 300, null], unitPrice: 6 };
  if (/chiller|fridge|cabinet|freezer/.test(t)) return { label: "chiller branding kit", spec: "2d", size: [600, 1800, null], unitPrice: 18 };
  if (/dump ?bin/.test(t)) return { label: "dumpbin", spec: "3d", size: [600, 600, 900], unitPrice: 38 };
  if (/gift|gwp|premium|sleeve/.test(t)) return { label: "gift pack", spec: "promo_merch", size: [250, 180, 120], unitPrice: 3.5 };
  if (/floor|fsu|gondola|display|end/.test(t)) return { label: "display unit", spec: "3d", size: [1200, 600, 400], unitPrice: 55 };
  return { label: "POS kit", spec: "2d", size: [600, 400, null], unitPrice: 4 };
}

export function mockBriefConcepts(b: Brief, substrates: LibraryRecord[], p: CreativeParams, direction: string) {
  const dir = direction.toLowerCase();
  const greener = p.sustainability === "high" || /recycl|sustain|eco|green|plastic.?free/.test(dir);
  const cheaper = p.budget === "respect" || /cheap|budget|cost/.test(dir);
  const bolder = p.innovation === "bold" || /bold|premium|wow|stand out/.test(dir);
  const shape = shapeFor(`${b.product_category ?? ""} ${b.title} ${b.brief_text ?? ""}`);
  const qty = n((b.target_outlets ?? "").replace(/,/g, "").match(/\d+/)?.[0]) ?? 100;

  const scored = substrates.map((s) => ({ s, eco: substrateEco(s) }))
    .filter(({ s }) => (b.require_fsc ? !!s.data?.fsc_certified : true))
    .filter(({ s }) => (b.min_recycled_pct != null ? (n(s.data?.recycled_content_percent) ?? 0) >= b.min_recycled_pct : true));
  const pool = (scored.length ? scored : substrates.map((s) => ({ s, eco: substrateEco(s) }))).sort((a, c) => c.eco.score - a.eco.score || a.s.name.localeCompare(c.s.name));
  const pick = (i: number) => pool.length ? pool[Math.min(i, pool.length - 1)] : null;
  const seed = hash(b.id + direction + JSON.stringify(p));

  const variants = [
    { name: `Shelf-ready ${shape.label}`, sub: pick(0), factor: 0.85, fit: 84, idea: `A flat-packed ${shape.label} that ships and builds in minutes, with the brand creative printed edge to edge and no tools needed in store.`, risk: "Lower stand-out than a sculpted unit." },
    { name: `Modular ${shape.label} system`, sub: pick(greener ? 1 : Math.min(2, pool.length - 1)), factor: 1.0, fit: 78, idea: `A ${shape.label} built from interchangeable panels so markets can swap headers and price messaging without reprinting the structure.`, risk: "More parts to pack and brief to installers." },
    { name: `Hero ${shape.label}${bolder ? " with sculpted header" : ""}`, sub: greener ? pick(0) : pick(pool.length - 1), factor: bolder ? 1.6 : 1.3, fit: bolder ? 80 : 70, idea: `A standout ${shape.label} with a die-cut header and a QR code to the campaign promotion, built to own the aisle for the full activation.`, risk: "Highest cost; check retailer size limits." },
  ];

  const concepts: SpecConcept[] = variants.map((v, i) => {
    const unit = Math.round(shape.unitPrice * v.factor * (cheaper ? 0.9 : 1) * 100) / 100;
    const total = Math.round(unit * qty);
    const risks = [v.risk];
    if (b.budget_high != null && total > Number(b.budget_high)) risks.push(`Indicative total ${b.currency} ${total.toLocaleString("en-GB")} is above the budget ceiling.`);
    if (v.sub && b.min_recycled_pct != null && (n(v.sub.s.data?.recycled_content_percent) ?? 0) < b.min_recycled_pct) risks.push("Below the brief's minimum recycled content.");
    return {
      name: v.name,
      rationale: `Answers "${b.objective ?? b.title}" for ${b.target_outlets ?? "the target outlets"}${greener ? ", leaning on the lowest-impact approved material" : ""}.`,
      suggested_spec_type: shape.spec,
      suggested_substrate_name: v.sub?.s.name ?? null,
      suggested_substrate_id: v.sub?.s.id ?? null,
      suggested_length: shape.size[0], suggested_width: shape.size[1], suggested_depth: shape.size[2], suggested_unit: "mm",
      suggested_calc_method: "quantity",
      creative_direction: v.idea + (direction.trim() ? ` Refined for: "${direction.trim().slice(0, 140)}".` : ""),
      risks,
      fit_score: Math.max(40, Math.min(95, v.fit + ((seed >> (i * 3)) % 7) - 3)),
      indicative_quantity: qty, indicative_unit_price: unit, indicative_total: total, price_currency: b.currency,
      price_basis: "Demo estimate — no AI key configured and no comparable awarded history",
      eco: v.sub ? v.sub.eco : null,
    };
  });
  const top = concepts.reduce((best, c, i) => ((c.fit_score ?? 0) + (greener ? (c.eco?.score ?? 0) / 4 : 0) > (concepts[best].fit_score ?? 0) + (greener ? (concepts[best].eco?.score ?? 0) / 4 : 0) ? i : best), 0);
  return {
    reply: `Demo suggestions — no AI key configured. Here are three directions for "${b.title}", built from the approved substrate library${direction.trim() ? " and your latest direction" : ""}. Pick one, change the creative parameters, or tell me what to change.`,
    concepts, topIndex: top,
  };
}

export function mockProductTypes(objective: string, touchpoints: LibraryRecord[], used: Set<string>) {
  const seed = hash(objective.toLowerCase());
  const eco = (spec: string): Eco => {
    const score = spec === "2d" ? 74 : spec === "3d" ? 62 : 46;
    return { score, tag: ecoTagFor(score), rationale: spec === "2d" ? "Usually board or paper: light, recyclable, low carbon." : spec === "3d" ? "Usually corrugated with some rigid parts: recyclable if kept fibre-based." : "Usually mixed materials with a short life: harder to recycle.",
      dimensions: { carbon_footprint: score + 2, recycled_content: score - 6, end_of_life: score + 4 } };
  };
  const ranked = [...touchpoints].sort((a, b) => (hash(a.id + seed) % 997) - (hash(b.id + seed) % 997));
  const picks = [...ranked.filter((t) => used.has(t.id)).slice(0, 2), ...ranked.filter((t) => !used.has(t.id))].slice(0, 4);
  return {
    reply: `Demo suggestions — no AI key configured. Four product-type directions for the objective, mixing ones this client has used before with new ones.`,
    suggestions: picks.map((t) => {
      const spec = String(t.data?.typical_spec_type ?? "2d");
      return {
        product_type_name: t.name, product_type_id: t.id, suggested_spec_type: spec, eco: eco(spec),
        rationale: `${t.name} ${t.data?.job_to_be_done ? `does the "${String(t.data.job_to_be_done).toLowerCase()}" job` : "gets the message in front of shoppers"} for: ${objective.slice(0, 90)}${objective.length > 90 ? "…" : ""}`,
      };
    }),
  };
}
