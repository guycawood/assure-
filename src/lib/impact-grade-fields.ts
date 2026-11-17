// Inputs a person can enter or correct on an Impact Grade record, each with its evidence tier. Pure: shared by the
// server (calculation) and the edit form.
import type { IgInput, IgTier } from "@/lib/impact-grade";

const IG_TIERS: readonly IgTier[] = ["assumed", "estimated", "declared", "measured", "verified"];

export type Override = { value: unknown; tier: IgTier };
export type Overrides = Record<string, Override>;

export type OverrideField = { key: string; label: string; kind: "option" | "bool" | "text" | "number"; optionKind?: string; subScore: string };
export const OVERRIDE_FIELDS: OverrideField[] = [
  { key: "activationPeriod", label: "Durability & lifespan (activation period)", kind: "option", optionKind: "activation_period", subScore: "DURABILITY" },
  { key: "reusable", label: "Designed for reuse", kind: "bool", subScore: "REUSABILITY" },
  { key: "modular", label: "Modular, replaceable parts", kind: "bool", subScore: "REPAIRABILITY" },
  { key: "easySeparation", label: "Materials separate easily", kind: "bool", subScore: "RECYCLABILITY" },
  { key: "finishing", label: "Finishing / coating (comma separated, blank for none)", kind: "text", subScore: "RECYCLABILITY" },
  { key: "optimalSize", label: "Optimal size (no wasted material)", kind: "bool", subScore: "RESOURCE_USE" },
  { key: "accreditation", label: "Material accreditation", kind: "option", optionKind: "accreditation", subScore: "RESOURCE_USE" },
  { key: "inks", label: "Inks", kind: "option", optionKind: "ink", subScore: "SUBSTANCES" },
  { key: "varnish", label: "Varnish", kind: "option", optionKind: "varnish", subScore: "SUBSTANCES" },
  { key: "electronics", label: "Electronics", kind: "option", optionKind: "electronics", subScore: "SUBSTANCES" },
  { key: "recycledPercent", label: "Post-consumer recycled content % (whole spec)", kind: "number", subScore: "RECYCLED_CONTENT" },
];

const tierRank = (t: IgTier) => IG_TIERS.indexOf(t);
const lowest = (a: IgTier | undefined, b: IgTier): IgTier => (a === undefined || tierRank(b) < tierRank(a) ? b : a);

/** Apply a person's inputs over what the spec gave. Each sub-score takes the weakest tier among the inputs behind it. */
export function applyOverrides(base: IgInput, baseTiers: Record<string, IgTier>, overrides: Overrides): { input: IgInput; tiers: Record<string, IgTier> } {
  const input: IgInput = { ...base, components: base.components.map((c) => ({ ...c })) };
  const tiers: Record<string, IgTier> = { ...baseTiers };
  const touched: Record<string, IgTier> = {};
  for (const f of OVERRIDE_FIELDS) {
    const o = overrides[f.key];
    if (!o || o.value === null || o.value === undefined || o.value === "") continue;
    const v = o.value;
    if (f.key === "finishing") input.finishing = String(v).split(",").map((s) => s.trim()).filter(Boolean);
    else if (f.key === "recycledPercent") input.components = input.components.map((c) => ({ ...c, recycledPercent: Number(v) }));
    else (input as Record<string, unknown>)[f.key] = f.kind === "bool" ? v === true || v === "true" || v === "yes" : v;
    touched[f.subScore] = lowest(touched[f.subScore], IG_TIERS.includes(o.tier) ? o.tier : "declared");
  }
  Object.assign(tiers, touched);
  return { input, tiers };
}

