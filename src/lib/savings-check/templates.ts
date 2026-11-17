// Rule templates: the common savings-file checks as parameterised rules. A template turns a handful of plain parameters (a threshold, a list of
// categories, a start date) into engine rules, so a client's rules are set up by filling in values, not by writing conditions.
// Everything here is generic: category, region, country and owner names are the client's own values, supplied as parameters.
import type { Condition, Rule, Ruleset, Scope } from "./engine";

export type ParamType = "text" | "number" | "date" | "list" | "map" | "groups";
export type ParamDef = { key: string; label: string; type: ParamType; hint?: string; default?: unknown };
export type Params = Record<string, unknown>;
export type Template = { key: string; label: string; what: string; params: ParamDef[]; build: (p: Params) => Rule[] };

// Parameters every template accepts: a name prefix for the rule ids, where and when the rule applies.
const COMMON: ParamDef[] = [
  { key: "regions", label: "Regions it applies to", type: "list", hint: "Leave empty for all regions." },
  { key: "from", label: "Applies from (bill closed date)", type: "date" },
  { key: "to", label: "Applies until", type: "date" },
];

const str = (p: Params, k: string, d = "") => (typeof p[k] === "string" && (p[k] as string).trim() ? (p[k] as string).trim() : d);
const numP = (p: Params, k: string, d: number) => (typeof p[k] === "number" && Number.isFinite(p[k] as number) ? (p[k] as number) : typeof p[k] === "string" && p[k] !== "" && Number.isFinite(Number(p[k])) ? Number(p[k]) : d);
const listP = (p: Params, k: string, d: string[] = []) => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(String).map((s) => s.trim()).filter(Boolean) : d);
const scopeOf = (p: Params, when?: Condition): Scope | undefined => {
  const regions = listP(p, "regions"), from = str(p, "from"), to = str(p, "to");
  const s: Scope = {};
  if (regions.length) s.regions = regions;
  if (from) s.from = from;
  if (to) s.to = to;
  if (when) s.when = when;
  return Object.keys(s).length ? s : undefined;
};
const idOf = (p: Params, key: string) => str(p, "id", key).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || key;
const categoryWhen = (p: Params): Condition | undefined => {
  const field = str(p, "by", "category"), inn = listP(p, "category_in"), out = listP(p, "category_not_in");
  const parts: Condition[] = [];
  if (inn.length) parts.push({ field, op: "in", value: inn });
  if (out.length) parts.push({ field, op: "not_in", value: out });
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : { all: parts };
};
const CATEGORY_PARAMS: ParamDef[] = [
  { key: "category_in", label: "Only these categories", type: "list", hint: "Leave empty for every category." },
  { key: "category_not_in", label: "Not these categories", type: "list" },
];

export const TEMPLATES: Record<string, Template> = {
  required_fields: {
    key: "required_fields", label: "Required data is present", what: "Flags a line where a required field is blank, or a value that must be above zero is zero.",
    params: [
      { key: "fields", label: "Fields that must be filled", type: "list", default: ["buy_price", "spec_number"] },
      { key: "nonzero", label: "Fields that must also be above zero", type: "list", default: ["buy_price"] },
      { key: "comment", label: "Comment", type: "text", default: "ISSUE: Buy price or spec number missing – add the missing data or link the job." }, ...COMMON,
    ],
    build: (p) => {
      const nz = listP(p, "nonzero", ["buy_price"]), all = listP(p, "fields", ["buy_price", "spec_number"]);
      const parts: Condition[] = [...new Set([...all, ...nz])].map((f) => (nz.includes(f) ? { field: f, op: "empty" as const } : { field: f, op: "blank" as const }));
      return [{ id: idOf(p, "required"), name: "Required data is present", template: "required_fields", outcome: "issue", kind: "condition", condition: { any: parts },
        comment: str(p, "comment", "ISSUE: Buy price or spec number missing – add the missing data or link the job."), scope: scopeOf(p) }];
    },
  },
  zero_savings_types: {
    key: "zero_savings_types", label: "Some savings types must carry no savings", what: "Flags a line of a savings type that is not allowed to claim savings but does.",
    params: [{ key: "types", label: "Savings types with no savings", type: "list", default: ["Exempt", "No Savings Applies"] }, ...COMMON],
    build: (p) => [{ id: idOf(p, "no_savings"), name: "Savings types that carry no savings", template: "zero_savings_types", outcome: "issue", kind: "condition",
      condition: { all: [{ field: "match_type", op: "in", value: listP(p, "types", ["Exempt"]) }, { field: "total_savings", op: "nonzero" }] },
      comment: "ISSUE: {match_type} line carries savings of {total_savings} – zero the savings or reclassify the line.", scope: scopeOf(p) }],
  },
  min_quotes: {
    key: "min_quotes", label: "Minimum quotes for a savings type", what: "Flags a line that claims a quote-based saving without enough eligible quotes, or that returns no saving.",
    params: [
      { key: "type", label: "Savings type", type: "text", default: "Market Benchmarking" }, { key: "min", label: "Minimum eligible quotes", type: "number", default: 3 },
      { key: "band", label: "Quote banding (±%)", type: "number", default: 50 }, ...COMMON,
    ],
    build: (p) => {
      const type = str(p, "type", "Market Benchmarking"), min = numP(p, "min", 3), band = numP(p, "band", 50), id = idOf(p, "min_quotes");
      return [
        { id: `${id}_count`, name: `${type}: enough eligible quotes`, template: "min_quotes", outcome: "issue", kind: "condition",
          condition: { all: [{ field: "match_type", op: "eq", value: type }, { field: "eligible_quotes", op: "lt", value: min }] },
          comment: `ISSUE: Eligible quotes: {eligible_quotes}. Minimum ${min} suppliers are required for ${type}: add pricing or change the savings type.`, scope: scopeOf(p) },
        { id: `${id}_zero`, name: `${type}: returns a saving`, template: "min_quotes", outcome: "issue", kind: "condition",
          condition: { all: [{ field: "match_type", op: "eq", value: type }, { field: "total_savings", op: "empty" }] },
          comment: `ISSUE: Not eligible for ${type} (quotes outside the ±${band}% band).`, scope: scopeOf(p) },
      ];
    },
  },
  savings_pct_high: {
    key: "savings_pct_high", label: "High savings %", what: "Asks for a justification above one threshold, and flags an issue above a higher one.",
    params: [
      { key: "threshold", label: "Justification needed above (%)", type: "number", default: 25 }, { key: "hard", label: "Issue above (%) (optional)", type: "number" },
      ...COMMON,
    ],
    build: (p) => {
      const t = numP(p, "threshold", 25), hard = typeof p.hard === "number" || (typeof p.hard === "string" && p.hard !== "") ? numP(p, "hard", 0) : null, id = idOf(p, "savings_high");
      const rules: Rule[] = [{ id: `${id}_justify`, name: "High savings need a justification", template: "savings_pct_high", outcome: "confirm", kind: "condition",
        condition: { all: [{ field: "savings_pct", op: "gt", value: t }, ...(hard !== null ? [{ field: "savings_pct", op: "lte" as const, value: hard }] : []), { field: "client_comments", op: "blank" }] },
        comment: `NEED TO CONFIRM: Savings % = {savings_pct} above the ${t}% threshold – justification required in the comments for the client.`, scope: scopeOf(p) }];
      if (hard !== null) rules.push({ id: `${id}_hard`, name: "Very high savings", template: "savings_pct_high", outcome: "issue", kind: "condition",
        condition: { field: "savings_pct", op: "gt", value: hard }, comment: `ISSUE: Savings are high ({savings_pct}%) – above ${hard}%, review before approval.`, scope: scopeOf(p) });
      return rules;
    },
  },
  fee_ceiling: {
    key: "fee_ceiling", label: "Fee % ceiling", what: "Flags a fee or mark-up above a ceiling, optionally for chosen categories only.",
    params: [{ key: "max", label: "Ceiling (%)", type: "number", default: 8 }, { key: "by", label: "Category field", type: "text", default: "category" }, ...CATEGORY_PARAMS, ...COMMON],
    build: (p) => {
      const max = numP(p, "max", 8), when = categoryWhen(p);
      return [{ id: idOf(p, "fee_ceiling"), name: `Fee % above ${max}`, template: "fee_ceiling", outcome: "issue", kind: "condition",
        condition: { field: "fee_pct", op: "gt", value: max }, comment: `ISSUE: Fee % is high ({fee_pct}%), above ${max}% – check the mark-up.`, scope: scopeOf(p, when) }];
    },
  },
  fee_schedule: {
    key: "fee_schedule", label: "Fee % by country or category", what: "Checks the fee against the agreed value for the line's country (or another field), from a start date.",
    params: [
      { key: "by", label: "Looked up by", type: "text", default: "country" }, { key: "table_ref", label: "Uploaded fee table (name)", type: "text", hint: "Use an uploaded table that has its own dates instead of typing values here." }, { key: "table", label: "Agreed fee % by value", type: "map" },
      { key: "default", label: "Fee % for any other value", type: "number" }, { key: "tolerance", label: "Tolerance (points)", type: "number", default: 0.05 }, ...CATEGORY_PARAMS, ...COMMON,
    ],
    build: (p) => {
      const by = str(p, "by", "country"), table = (p.table && typeof p.table === "object" ? p.table : {}) as Record<string, number>;
      const hasDefault = p.default !== undefined && p.default !== "" && p.default !== null;
      return [{ id: idOf(p, "fee_schedule"), name: `Fee % as agreed by ${by}`, template: "fee_schedule", outcome: "issue", kind: "expected_value",
        expected: { field: "fee_pct", by, ...(str(p, "table_ref") ? { table_ref: str(p, "table_ref") } : { table }), ...(hasDefault ? { default: numP(p, "default", 0) } : {}), tolerance: numP(p, "tolerance", 0.05) },
        comment: `ISSUE: Fee % is {fee_pct}, expected {expected} for {${by}}.`, scope: scopeOf(p, categoryWhen(p)) }];
    },
  },
  markup_exceptions: {
    key: "markup_exceptions", label: "Mark-up exception list", what: "Lines on the client's exception list carry one mark-up, all others another. A line that cannot be placed is queried.",
    params: [
      { key: "list", label: "Name of the list", type: "text", default: "markup_exceptions" }, { key: "key", label: "Field the list holds", type: "text", default: "job_ref" },
      { key: "on_list", label: "Mark-up for listed lines (%)", type: "number", default: 0 }, { key: "other", label: "Mark-up for all other lines (%)", type: "number", default: 5 }, ...CATEGORY_PARAMS, ...COMMON,
    ],
    build: (p) => {
      const list = str(p, "list", "markup_exceptions"), key = str(p, "key", "job_ref"), on = numP(p, "on_list", 0), other = numP(p, "other", 5), id = idOf(p, "markup_exc"), when = categoryWhen(p);
      return [
        { id: `${id}_listed`, name: "Listed lines carry the exception mark-up", template: "markup_exceptions", outcome: "issue", kind: "condition",
          condition: { all: [{ field: key, op: "in", list }, { field: "fee_pct", op: "ne", value: on }] }, comment: `ISSUE: Mark-up not per the exception list – expected ${on}% for listed lines, found {fee_pct}%.`, scope: scopeOf(p, when) },
        { id: `${id}_other`, name: "Other lines carry the standard mark-up", template: "markup_exceptions", outcome: "issue", kind: "condition",
          condition: { all: [{ field: key, op: "filled" }, { field: key, op: "not_in", list }, { field: "fee_pct", op: "ne", value: other }] }, comment: `ISSUE: Mark-up not per the exception list – expected ${other}% for lines not listed, found {fee_pct}%.`, scope: scopeOf(p, when) },
        { id: `${id}_unknown`, name: "Cannot tell whether the line is listed", template: "markup_exceptions", outcome: "confirm", kind: "condition",
          condition: { field: key, op: "blank" }, comment: "NEED TO CONFIRM: verify against the exception list.", scope: scopeOf(p, when) },
      ];
    },
  },
  classification_required: {
    key: "classification_required", label: "Required classification", what: "Spend of certain categories or product types must be classified a particular way.",
    params: [
      { key: "by", label: "Looked up by", type: "text", default: "product_type" }, { key: "values", label: "Values that must be classified", type: "list" },
      { key: "expected", label: "Required savings type", type: "text", default: "Exempt" }, ...COMMON,
    ],
    build: (p) => {
      const by = str(p, "by", "product_type"), expected = str(p, "expected", "Exempt");
      return [{ id: idOf(p, "classification"), name: `Must be classified ${expected}`, template: "classification_required", outcome: "issue", kind: "condition",
        condition: { all: [{ field: by, op: "in", value: listP(p, "values") }, { field: "match_type", op: "ne", value: expected }] },
        comment: `ISSUE: This spend must be classified as ${expected}.`, scope: scopeOf(p) }];
    },
  },
  exchange_rate_period: {
    key: "exchange_rate_period", label: "Exchange rate period", what: "Lines before a cut-off date use one rate set, lines after it another, and a chosen period is held until the client confirms.",
    params: [
      { key: "cutoff", label: "Cut-off date", type: "date" }, { key: "before", label: "Rate set before the cut-off", type: "text", default: "Previous" },
      { key: "after", label: "Rate set from the cut-off", type: "text", default: "Updated" },
      { key: "hold_from", label: "Hold from (optional)", type: "date" }, { key: "hold_to", label: "Hold until (optional)", type: "date" }, ...COMMON.filter((c) => c.key === "regions"),
    ],
    build: (p) => {
      const cut = str(p, "cutoff"), before = str(p, "before", "Previous"), after = str(p, "after", "Updated"), id = idOf(p, "fx_period");
      const rules: Rule[] = [];
      if (cut) {
        rules.push(
          { id: `${id}_before`, name: "Lines before the cut-off use the previous rate set", template: "exchange_rate_period", outcome: "issue", kind: "condition",
            condition: { all: [{ field: "closed_date", op: "before", value: cut }, { any: [{ field: "rate_period", op: "blank" }, { field: "rate_period", op: "ne", value: before }] }] },
            comment: `ISSUE: Exchange rate period mismatch – lines before ${cut} use the ${before} rate set.`, scope: scopeOf(p) },
          { id: `${id}_after`, name: "Lines from the cut-off use the updated rate set", template: "exchange_rate_period", outcome: "issue", kind: "condition",
            condition: { all: [{ field: "closed_date", op: "on_or_after", value: cut }, { any: [{ field: "rate_period", op: "blank" }, { field: "rate_period", op: "ne", value: after }] }] },
            comment: `ISSUE: Exchange rate period mismatch – lines from ${cut} use the ${after} rate set.`, scope: scopeOf(p) },
        );
      }
      if (str(p, "hold_from") || str(p, "hold_to")) rules.push({ id: `${id}_hold`, name: "Period held until the client confirms the rate", template: "exchange_rate_period", outcome: "hold", kind: "condition",
        condition: { field: "closed_date", op: "filled" }, comment: "HOLD: Continuation of the rate for this period is not yet confirmed by the client.",
        scope: { ...(scopeOf(p) ?? {}), from: str(p, "hold_from") || undefined, to: str(p, "hold_to") || undefined } });
      return rules;
    },
  },
  missed_opportunity: {
    key: "missed_opportunity", label: "Missed opportunity treatment", what: "Missed-opportunity savings stay out of the total savings and their spend counts as addressable.",
    params: [{ key: "type", label: "Savings type", type: "text", default: "Missed Opportunity" }, { key: "non_addressable", label: "Label for non-addressable spend", type: "text", default: "Non-Addressable" }, ...COMMON],
    build: (p) => {
      const type = str(p, "type", "Missed Opportunity");
      return [{ id: idOf(p, "missed_opp"), name: `${type} treatment applied`, template: "missed_opportunity", outcome: "issue", kind: "condition",
        condition: { all: [{ field: "match_type", op: "eq", value: type }, { any: [{ field: "total_savings", op: "nonzero" }, { field: "addressable", op: "eq", value: str(p, "non_addressable", "Non-Addressable") }] }] },
        comment: `ISSUE: ${type} treatment not applied – exclude from total savings and move the spend to addressable.`, scope: scopeOf(p) }];
    },
  },
  auto_baseline: {
    key: "auto_baseline", label: "Automatic baseline available", what: "A baseline was matched automatically and shows a saving, but the line is not using it.",
    params: [...COMMON],
    build: (p) => [{ id: idOf(p, "auto_baseline"), name: "Automatic baseline available", template: "auto_baseline", outcome: "confirm", kind: "condition",
      condition: { all: [{ field: "baseline_matched", op: "is_true" }, { field: "savings_pct_auto", op: "gt", value: 0 }, { not: { field: "use_auto_baseline", op: "is_true" } }] },
      comment: "NEED TO CONFIRM: Automatic baseline available (savings {savings_pct_auto}%) – validate the reference job, then switch the line to use it.", scope: scopeOf(p) }],
  },
  premium_consistency: {
    key: "premium_consistency", label: "Premium flag matches the premium fee", what: "A line at the premium fee must be flagged premium, and a premium line must carry the premium fee.",
    params: [{ key: "premium_pct", label: "Premium fee %", type: "number", default: 13 }, ...COMMON],
    build: (p) => {
      const pct = numP(p, "premium_pct", 13), id = idOf(p, "premium");
      return [
        { id: `${id}_flag`, name: "Premium fee but not flagged premium", template: "premium_consistency", outcome: "confirm", kind: "condition",
          condition: { all: [{ field: "fee_pct", op: "eq", value: pct }, { field: "premium_flag", op: "is_false" }] },
          comment: `NEED TO CONFIRM: Mark-up is the ${pct}% premium rate but the line is not flagged premium – confirm premium status.`, scope: scopeOf(p) },
        { id: `${id}_fee`, name: "Flagged premium without the premium fee", template: "premium_consistency", outcome: "confirm", kind: "condition",
          condition: { all: [{ field: "premium_flag", op: "is_true" }, { field: "fee_pct", op: "ne", value: pct }] },
          comment: `NEED TO CONFIRM: Line is flagged premium but the mark-up ({fee_pct}%) is not the ${pct}% premium rate.`, scope: scopeOf(p) },
      ];
    },
  },
  owner_review: {
    key: "owner_review", label: "Owner review", what: "Lines of a category must be owned by one of its agreed owners, otherwise they are held for review.",
    params: [{ key: "groups", label: "Category and its agreed owners", type: "groups", hint: "One row per category." }, ...COMMON],
    build: (p) => {
      const groups = (Array.isArray(p.groups) ? p.groups : []) as { category?: string; owners?: string[] }[];
      return groups.filter((g) => g.category && g.owners?.length).map((g, i) => ({
        id: `${idOf(p, "owner")}_${i + 1}`, name: `Owner review: ${g.category}`, template: "owner_review", outcome: "hold" as const, kind: "condition" as const,
        condition: { all: [{ field: "category", op: "eq" as const, value: g.category as string }, { any: [{ field: "owner", op: "blank" as const }, { field: "owner", op: "not_in" as const, value: g.owners as string[] }] }] },
        comment: "HOLD: Line pending owner review – the owner is missing or not the agreed owner for this category.", scope: scopeOf(p),
      }));
    },
  },
  hold_period: {
    key: "hold_period", label: "Hold a period", what: "Holds every line closed in a period until something outside the file is confirmed.",
    params: [{ key: "comment", label: "Comment", type: "text", default: "HOLD: Pending confirmation." }, ...COMMON],
    build: (p) => [{ id: idOf(p, "hold_period"), name: "Hold this period", template: "hold_period", outcome: "hold", kind: "condition",
      condition: { field: "closed_date", op: "filled" }, comment: str(p, "comment", "HOLD: Pending confirmation."), scope: scopeOf(p) }],
  },
  internal_only: {
    key: "internal_only", label: "Internal-only data", what: "Data from certain countries must not be shared with the client.",
    params: [{ key: "markets", label: "Countries that are internal only", type: "list" }, ...COMMON],
    build: (p) => [{ id: idOf(p, "internal_only"), name: "Internal-only data marked for sharing", template: "internal_only", outcome: "issue", kind: "condition",
      condition: { all: [{ field: "country", op: "in", value: listP(p, "markets") }, { field: "client_share", op: "is_true" }] },
      comment: "ISSUE: This country's data is internal only – do not share it with the client.", scope: scopeOf(p) }],
  },
};

export const buildRules = (key: string, params: Params): Rule[] => {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`Unknown template ${key}`);
  return t.build(params);
};

// ---------------------------------------------------------------------------
// An anonymised example: generic names and illustrative values, to start a client from. None of it belongs to a real client.
// ---------------------------------------------------------------------------
export const EXAMPLE_COLUMN_MAP: Record<string, string> = {
  job_ref: "Job", spec_number: "Spec number", region: "Region", country: "Country", category: "Category", product_type: "Product type", owner: "Owner",
  closed_date: "Bill closed date", buy_price: "Buy price", match_type: "Savings type", total_savings: "Total savings", savings_pct: "Savings %", savings_pct_auto: "Savings % (auto)",
  eligible_quotes: "Eligible quotes", fee_pct: "Fee %", premium_flag: "Premium?", rate_card_spec: "Rate card spec", exchange_rate: "Exchange rate", rate_period: "Rate set",
  addressable: "Addressable", missed_opp_savings: "Missed opportunity savings", baseline_matched: "Baseline matched", use_auto_baseline: "Use auto baseline",
  client_comments: "Client comments", client_share: "Share with client",
};

export function exampleRuleset(): Ruleset {
  const rules = [
    ...buildRules("required_fields", {}),
    ...buildRules("zero_savings_types", { types: ["Exempt", "No Savings Applies", "No Savings Achieved"] }),
    ...buildRules("min_quotes", { type: "Market Benchmarking", min: 3, band: 50 }),
    ...buildRules("savings_pct_high", { id: "savings_high_a", threshold: 25, regions: ["Region A"] }),
    ...buildRules("savings_pct_high", { id: "savings_high_b", threshold: 25, hard: 70, regions: ["Region B"] }),
    ...buildRules("fee_ceiling", { id: "fee_ceiling_std", max: 7, category_not_in: ["Category X"], regions: ["Region B"] }),
    ...buildRules("fee_ceiling", { id: "fee_ceiling_x", max: 12, category_in: ["Category X"], regions: ["Region B"] }),
    ...buildRules("fee_schedule", { table: { "Country 1": 5.5, "Country 2": 6.5 }, default: 6, from: "2026-07-01", category_in: ["Business unit B"] }),
    ...buildRules("markup_exceptions", { regions: ["Region B"], from: "2026-07-01", other: 5, on_list: 0 }),
    ...buildRules("classification_required", { by: "product_type", values: ["Digital item"], expected: "Exempt", regions: ["Region B"] }),
    ...buildRules("exchange_rate_period", { cutoff: "2026-07-01", before: "Previous", after: "Updated", hold_from: "2026-10-01", hold_to: "2026-12-31" }),
    ...buildRules("missed_opportunity", {}),
    ...buildRules("auto_baseline", {}),
    ...buildRules("premium_consistency", { premium_pct: 13 }),
    ...buildRules("owner_review", { regions: ["Region B"], groups: [{ category: "Category X", owners: ["Owner A"] }, { category: "Category Y", owners: ["Owner B", "Owner C"] }] }),
    ...buildRules("internal_only", { markets: ["Country 3"] }),
  ];
  return {
    regions: ["Region A", "Region B"],
    column_map: { ...EXAMPLE_COLUMN_MAP },
    percent_as_fraction: false,
    lists: { markup_exceptions: ["JOB-0001", "JOB-0002"] },
    method: {
      savings_types: [
        { key: "market_benchmarking", label: "Market Benchmarking", counts_in_total: true, addressable: true, min_quotes: 3, band_pct: 50 },
        { key: "rate_card", label: "Rate Card", counts_in_total: true, addressable: true },
        { key: "exempt", label: "Exempt", counts_in_total: false, addressable: false },
        { key: "no_savings_applies", label: "No Savings Applies", counts_in_total: false, addressable: true },
        { key: "missed_opportunity", label: "Missed Opportunity", counts_in_total: false, addressable: true },
      ],
      fee_model: { standard_pct: 6, premium_pct: 13 },
      thresholds: { savings_review_pct: 25, savings_hard_pct: 70 },
    },
    rules,
  };
}
