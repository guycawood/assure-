// Savings-file check engine: the thirteen anonymised checks as templates, value reading, column handling, severity, output and validation.
// Names, regions and values are generic (Category X, Region A, Country 1, Owner A); none belongs to a real client.
import assert from "node:assert/strict";
import { test } from "node:test";
import { annotate, normaliseRow, runChecks, testCondition, toDate, validateRuleset } from "../../src/lib/savings-check/engine.ts";
import { buildRules, EXAMPLE_COLUMN_MAP, exampleRuleset, TEMPLATES } from "../../src/lib/savings-check/templates.ts";

const MAP = EXAMPLE_COLUMN_MAP;
const BASE = {
  [MAP.job_ref]: "JOB-9", [MAP.spec_number]: "S-1", [MAP.region]: "Region A", [MAP.country]: "Country 1", [MAP.category]: "Category X", [MAP.product_type]: "Standard",
  [MAP.owner]: "Owner A", [MAP.closed_date]: "2026-08-15", [MAP.buy_price]: 100, [MAP.match_type]: "Rate Card", [MAP.total_savings]: 10, [MAP.savings_pct]: 10,
  [MAP.savings_pct_auto]: "", [MAP.eligible_quotes]: "", [MAP.fee_pct]: 6, [MAP.premium_flag]: "No", [MAP.rate_card_spec]: "", [MAP.exchange_rate]: 1.1, [MAP.rate_period]: "Updated",
  [MAP.addressable]: "Addressable", [MAP.missed_opp_savings]: "", [MAP.baseline_matched]: "", [MAP.use_auto_baseline]: "", [MAP.client_comments]: "", [MAP.client_share]: "No",
};
const R = (o = {}) => ({ ...BASE, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [MAP[k], v])) });
const rs = (template, params, extra = {}) => ({ column_map: MAP, rules: buildRules(template, params), ...extra });
const run = (template, params, rows, extra) => runChecks(rows, rs(template, params, extra));
const approvals = (res) => res.rows.map((r) => r.approval);

test("1 · required data: blank or zero buy price, blank spec number", () => {
  const res = run("required_fields", {}, [R(), R({ buy_price: "" }), R({ buy_price: 0 }), R({ spec_number: "" }), R({ spec_number: "  " })]);
  assert.deepEqual(approvals(res), ["pass", "issue", "issue", "issue", "issue"]);
  assert.match(res.rows[1].comment, /^ISSUE: Buy price or spec number missing/);
});

test("2 · savings types that must carry no savings", () => {
  const res = run("zero_savings_types", { types: ["Exempt", "No Savings Applies"] }, [R({ match_type: "Exempt", total_savings: 0 }), R({ match_type: "Exempt", total_savings: 50 }), R({ match_type: "no savings applies", total_savings: 5 }), R({ match_type: "Rate Card", total_savings: 5 })]);
  assert.deepEqual(approvals(res), ["pass", "issue", "issue", "pass"]);
  assert.equal(res.rows[1].comment, "ISSUE: Exempt line carries savings of 50 – zero the savings or reclassify the line.");
});

test("3 · minimum eligible quotes, and a quote-based saving that returns nothing", () => {
  const res = run("min_quotes", { type: "Market Benchmarking", min: 3, band: 50 }, [
    R({ match_type: "Market Benchmarking", eligible_quotes: 2, total_savings: 5 }), R({ match_type: "Market Benchmarking", eligible_quotes: 3, total_savings: 5 }),
    R({ match_type: "Market Benchmarking", eligible_quotes: 4, total_savings: 0 }), R({ match_type: "Rate Card", eligible_quotes: 1 })]);
  assert.deepEqual(approvals(res), ["issue", "pass", "issue", "pass"]);
  assert.match(res.rows[0].comment, /Eligible quotes: 2\. Minimum 3 suppliers/);
  assert.match(res.rows[2].comment, /Not eligible for Market Benchmarking \(quotes outside the ±50% band\)/);
});

test("4 · high savings %: justification above one threshold, an issue above a higher one, per region", () => {
  const rows = [R({ savings_pct: 35 }), R({ savings_pct: 35, client_comments: "Volume discount agreed" }), R({ savings_pct: 85 }), R({ savings_pct: 20 }), R({ savings_pct: 35, region: "Region B" })];
  const both = run("savings_pct_high", { threshold: 30, hard: 79 }, rows);
  assert.deepEqual(approvals(both), ["confirm", "pass", "issue", "pass", "confirm"]);
  assert.match(both.rows[0].comment, /Savings % = 35 above the 30% threshold/);
  assert.match(both.rows[2].comment, /ISSUE: Savings are high \(85%\) – above 79%/);
  assert.deepEqual(approvals(run("savings_pct_high", { threshold: 30, regions: ["Region A"] }, rows)), ["confirm", "pass", "confirm", "pass", "pass"]);   // Region B is out of scope
});

test("5 · fee ceiling by category", () => {
  const rules = [...buildRules("fee_ceiling", { id: "std", max: 8, category_not_in: ["Category X"] }), ...buildRules("fee_ceiling", { id: "x", max: 15, category_in: ["Category X"] })];
  const res = runChecks([R({ category: "Category Y", fee_pct: 9 }), R({ category: "Category Y", fee_pct: 8 }), R({ category: "Category X", fee_pct: 9 }), R({ category: "Category X", fee_pct: 16 })], { column_map: MAP, rules });
  assert.deepEqual(approvals(res), ["issue", "pass", "pass", "issue"]);
});

test("6 · fee schedule by country from a start date, only for the chosen category", () => {
  const p = { table: { "Country 1": 5.5, "Country 2": 6.5 }, default: 6.5, from: "2026-07-01", category_in: ["Business unit B"] };
  const res = run("fee_schedule", p, [
    R({ category: "Business unit B", country: "Country 1", fee_pct: 5.5 }), R({ category: "Business unit B", country: "Country 1", fee_pct: 6.5 }),
    R({ category: "Business unit B", country: "Country 1", fee_pct: 6.5, closed_date: "2026-06-30" }), R({ category: "Other", country: "Country 1", fee_pct: 9 }),
    R({ category: "Business unit B", country: "Country 9", fee_pct: 6.5 }), R({ category: "Business unit B", country: "Country 9", fee_pct: 7 }), R({ category: "Business unit B", country: "Country 2", fee_pct: "" })]);
  assert.deepEqual(approvals(res), ["pass", "issue", "pass", "pass", "pass", "issue", "issue"]);
  assert.equal(res.rows[1].comment, "ISSUE: Fee % is 6.5, expected 5.5 for Country 1.");
});

test("7 · mark-up exception list: listed lines, other lines, and a line that cannot be placed", () => {
  const p = { list: "exc", key: "job_ref", on_list: 0, other: 5, from: "2026-07-01" };
  const lists = { exc: ["JOB-1", "JOB-2"] };
  const res = run("markup_exceptions", p, [R({ job_ref: "JOB-1", fee_pct: 0 }), R({ job_ref: "JOB-1", fee_pct: 5 }), R({ job_ref: "JOB-7", fee_pct: 5 }), R({ job_ref: "JOB-7", fee_pct: 3 }), R({ job_ref: "" , fee_pct: 5 }), R({ job_ref: "JOB-1", fee_pct: 5, closed_date: "2026-05-01" })], { lists });
  assert.deepEqual(approvals(res), ["pass", "issue", "pass", "issue", "confirm", "pass"]);
  assert.match(res.rows[1].comment, /expected 0% for listed lines, found 5%/);
  assert.match(res.rows[4].comment, /^NEED TO CONFIRM: verify against the exception list/);
});

test("8 · a product type that must be classified Exempt", () => {
  const res = run("classification_required", { by: "product_type", values: ["Digital item"], expected: "Exempt" }, [R({ product_type: "Digital item", match_type: "Rate Card" }), R({ product_type: "Digital item", match_type: "Exempt" }), R({ product_type: "Standard", match_type: "Rate Card" }), R({ product_type: "Digital item", match_type: "" })]);
  assert.deepEqual(approvals(res), ["issue", "pass", "pass", "issue"]);
});

test("9 · exchange rate set by period, a held period, and the most severe outcome wins", () => {
  const p = { cutoff: "2026-07-01", before: "Previous", after: "Updated", hold_from: "2026-10-01", hold_to: "2026-12-31" };
  const res = run("exchange_rate_period", p, [
    R({ closed_date: "2026-03-01", rate_period: "Previous" }), R({ closed_date: "2026-03-01", rate_period: "Updated" }), R({ closed_date: "2026-08-01", rate_period: "Updated" }),
    R({ closed_date: "2026-08-01", rate_period: "Previous" }), R({ closed_date: "2026-08-01", rate_period: "" }), R({ closed_date: "2026-11-15", rate_period: "Updated" }), R({ closed_date: "2026-11-15", rate_period: "Previous" })]);
  assert.deepEqual(approvals(res), ["pass", "issue", "pass", "issue", "issue", "hold", "issue"]);
  assert.match(res.rows[6].comment, /^ISSUE: Exchange rate period mismatch.* \| HOLD: Continuation/);                    // the issue leads, the hold is kept
  assert.deepEqual(res.rows[6].rules.length, 2);
});

test("10 · missed opportunity stays out of total savings and its spend is addressable", () => {
  const res = run("missed_opportunity", {}, [R({ match_type: "Missed Opportunity", total_savings: 0, addressable: "Addressable" }), R({ match_type: "Missed Opportunity", total_savings: 100 }), R({ match_type: "Missed Opportunity", total_savings: 0, addressable: "Non-Addressable" }), R({ match_type: "Rate Card", total_savings: 100, addressable: "Non-Addressable" })]);
  assert.deepEqual(approvals(res), ["pass", "issue", "issue", "pass"]);
});

test("11 · an automatic baseline is available but the line does not use it", () => {
  const res = run("auto_baseline", {}, [R({ baseline_matched: "Yes", savings_pct_auto: 12, use_auto_baseline: "No" }), R({ baseline_matched: "Yes", savings_pct_auto: 12, use_auto_baseline: "Yes" }), R({ baseline_matched: "Yes", savings_pct_auto: 0, use_auto_baseline: "No" }), R({ baseline_matched: "No", savings_pct_auto: 12, use_auto_baseline: "No" }), R({ baseline_matched: "Yes", savings_pct_auto: 12, use_auto_baseline: "" })]);
  assert.deepEqual(approvals(res), ["confirm", "pass", "pass", "pass", "confirm"]);
  assert.match(res.rows[0].comment, /Automatic baseline available \(savings 12%\)/);
});

test("12 · the premium flag and the premium fee agree, both ways", () => {
  const res = run("premium_consistency", { premium_pct: 13 }, [R({ fee_pct: 13, premium_flag: "No" }), R({ fee_pct: 13, premium_flag: "Yes" }), R({ fee_pct: 6, premium_flag: "Yes" }), R({ fee_pct: 6, premium_flag: "No" }), R({ fee_pct: 13, premium_flag: "" })]);
  assert.deepEqual(approvals(res), ["confirm", "pass", "confirm", "pass", "pass"]);
});

test("13 · owner review by category, and internal-only data", () => {
  const owners = run("owner_review", { groups: [{ category: "Category X", owners: ["Owner A"] }, { category: "Category Y", owners: ["Owner B", "Owner C"] }] },
    [R({ category: "Category X", owner: "Owner A" }), R({ category: "Category X", owner: "" }), R({ category: "Category X", owner: "Owner B" }), R({ category: "Category Y", owner: "owner c" }), R({ category: "Category Q", owner: "" })]);
  assert.deepEqual(approvals(owners), ["pass", "hold", "hold", "pass", "pass"]);
  const internal = run("internal_only", { markets: ["Country 3"] }, [R({ country: "Country 3", client_share: "Yes" }), R({ country: "Country 3", client_share: "No" }), R({ country: "Country 1", client_share: "Yes" })]);
  assert.deepEqual(approvals(internal), ["issue", "pass", "pass"]);
});

test("values are read from messy files: percent text, fractions, thousands, day-first dates, Excel serials, yes/no", () => {
  const n = normaliseRow({ [MAP.savings_pct]: "35%", [MAP.buy_price]: "€1,234.50", [MAP.closed_date]: "15/03/2026", [MAP.premium_flag]: "yes", [MAP.client_share]: "N", [MAP.spec_number]: "  S-9 ", [MAP.fee_pct]: "" }, { column_map: MAP });
  assert.deepEqual([n.savings_pct, n.buy_price, n.closed_date, n.premium_flag, n.client_share, n.spec_number, n.fee_pct], [35, 1234.5, "2026-03-15", true, false, "S-9", null]);
  assert.equal(normaliseRow({ [MAP.savings_pct]: 0.35 }, { column_map: MAP, percent_as_fraction: true }).savings_pct, 35);
  assert.equal(normaliseRow({ [MAP.savings_pct]: "35%" }, { column_map: MAP, percent_as_fraction: true }).savings_pct, 35);   // an explicit % sign is never rescaled
  const serial = (Date.UTC(2026, 6, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  assert.deepEqual([toDate(serial), toDate("1 Jul 2026"), toDate("2026-07-01T10:00:00Z"), toDate("31/02/2026"), toDate("nonsense")], ["2026-07-01", "2026-07-01", "2026-07-01", null, null]);
});

test("a rule whose column is not in the file is skipped and reported, not guessed", () => {
  const rows = [R({ spec_number: "" })].map(({ [MAP.spec_number]: _gone, ...rest }) => rest);
  const res = runChecks(rows, { column_map: MAP, rules: [...buildRules("required_fields", {}), ...buildRules("auto_baseline", {})] });
  assert.equal(res.summary.skipped_rules.length >= 1, true);
  assert.match(res.summary.skipped_rules.find((s) => s.id === "required").reason, /Spec number|spec_number/);
  assert.equal(res.rows[0].approval, "pass");                                                  // never a false alarm from a column that is not there
  assert.equal(res.summary.by_rule.required, undefined);
});

test("the summary counts rows and each rule's hits; a single rule can be re-run", () => {
  const set = { column_map: MAP, rules: [...buildRules("required_fields", {}), ...buildRules("zero_savings_types", { types: ["Exempt"] })] };
  const rows = [R(), R({ buy_price: 0 }), R({ match_type: "Exempt", total_savings: 5 }), R({ buy_price: 0, match_type: "Exempt", total_savings: 5 })];
  const all = runChecks(rows, set);
  assert.deepEqual([all.summary.total, all.summary.pass, all.summary.issue], [4, 1, 3]);
  assert.deepEqual([all.summary.by_rule.required.fired, all.summary.by_rule.no_savings.fired, all.summary.by_rule.no_savings.in_scope], [2, 2, 4]);
  const one = runChecks(rows, set, { onlyRules: ["no_savings"] });
  assert.deepEqual([one.summary.issue, one.summary.pass, Object.keys(one.summary.by_rule)], [2, 2, ["no_savings"]]);
});

test("the output file is the input with only the two result columns added", () => {
  const rows = [R(), R({ buy_price: 0 })];
  const res = runChecks(rows, { column_map: MAP, rules: buildRules("required_fields", {}) });
  const out = annotate(rows, res.rows);
  assert.deepEqual(Object.keys(out[0]).slice(0, -2), Object.keys(rows[0]));
  assert.deepEqual(Object.keys(out[0]).slice(-2), ["Check approval", "Check comments"]);
  assert.deepEqual(out.map((r) => r["Check approval"]), ["", "Issue"]);
  assert.deepEqual(out.map((r) => Object.entries(r).filter(([k]) => !k.startsWith("Check")).map(([, v]) => v)), rows.map((r) => Object.values(r)));   // no other value changed
  assert.deepEqual(annotate(rows, res.rows, { approval: "Review", comment: "Notes" })[1].Review, "Issue");
});

test("conditions: all, any, not, lists, other-field comparisons and dates", () => {
  const row = normaliseRow(R({ fee_pct: 6, savings_pct: 6, category: "Category X", closed_date: "2026-08-15" }), { column_map: MAP });
  const t = (c, lists) => testCondition(c, row, lists);
  assert.equal(t({ all: [{ field: "fee_pct", op: "eq", other: "savings_pct" }, { field: "category", op: "in", list: "cats" }] }, { cats: ["category x"] }), true);
  assert.equal(t({ any: [{ field: "fee_pct", op: "gt", value: 9 }, { not: { field: "category", op: "eq", value: "Category Y" } }] }), true);
  assert.equal(t({ field: "closed_date", op: "after", value: "2026-08-01" }), true);
  assert.equal(t({ field: "closed_date", op: "before", value: "2026-08-01" }), false);
  assert.equal(t({ field: "owner", op: "not_in", value: ["Owner B"] }), true);
  assert.equal(t({ field: "missing_field", op: "blank" }), true);
});

test("rule sets are validated before saving", () => {
  assert.deepEqual(validateRuleset(exampleRuleset()), []);
  const bad = {
    regions: ["Region A"], column_map: { buy_price: "Price", "Bad Field": "x" }, lists: {},
    rules: [
      { id: "ok_rule", name: "x", kind: "condition", outcome: "issue", comment: "c", condition: { field: "fee_pct", op: "gt" } },
      { id: "ok_rule", name: "", kind: "condition", outcome: "block", comment: "", condition: { field: "category", op: "in", list: "nope" } },
      { id: "e1", name: "e", kind: "expected_value", outcome: "issue", comment: "c", expected: { field: "fee_pct" } },
      { id: "e2", name: "e", kind: "expected_value", outcome: "issue", comment: "c", expected: { field: "fee_pct", table: { a: 1 } } },
      { id: "s1", name: "s", kind: "condition", outcome: "hold", comment: "c", condition: { field: "owner", op: "blank" }, scope: { regions: ["Region Z"], from: "not a date" } },
    ],
  };
  const e = validateRuleset(bad).join("\n");
  for (const want of [/Bad Field/, /needs a value/, /used twice/, /give it a name/, /outcome must be/, /does not exist/, /expected value/, /looked up by/, /not a date/, /not one of this client's regions/]) assert.match(e, want);
});

test("the anonymised example set is valid, runs on a mixed file, and contains no real names", () => {
  const set = exampleRuleset();
  const rows = [
    R({ region: "Region B", fee_pct: 6, category: "Category Y", owner: "Owner B", job_ref: "JOB-7" }),
    R({ region: "Region B", fee_pct: 9, category: "Category Y", owner: "", job_ref: "JOB-7" }),
    R({ region: "Region A", savings_pct: 40, match_type: "Exempt", total_savings: 5 }),
    R({ buy_price: "", spec_number: "" }),
  ];
  const res = runChecks(rows, set);
  assert.equal(res.summary.total, 4);
  assert.equal(res.rows.every((r) => ["pass", "issue", "confirm", "hold"].includes(r.approval)), true);
  assert.equal(res.rows[3].approval, "issue");
  assert.equal(res.summary.skipped_rules.length, 0);
  const text = JSON.stringify(set) + Object.values(TEMPLATES).map((x) => x.label + x.what).join(" ");
  assert.doesNotMatch(text, /Pankaj|Christine|Felix|Helen|Yihua|TMICC|Smartsheet|Sourcing Hub|Ice Cream|Vietnam|China|Philippines|Thailand|Indonesia/i);
});
