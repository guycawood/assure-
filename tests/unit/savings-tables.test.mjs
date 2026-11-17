// Uploaded tables in the savings check: reading a fee schedule or exception list from a file, dated lookups, exception lists as run inputs,
// and rules that point at a table nobody has uploaded being skipped rather than guessed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTableUpload, runChecks, validateRuleset, refsUsed } from "../../src/lib/savings-check/engine.ts";
import { buildRules, EXAMPLE_COLUMN_MAP } from "../../src/lib/savings-check/templates.ts";

const MAP = EXAMPLE_COLUMN_MAP;
const BASE = { [MAP.job_ref]: "JOB-9", [MAP.country]: "Country 1", [MAP.category]: "Business unit B", [MAP.closed_date]: "2026-08-15", [MAP.fee_pct]: 6 };
const R = (o = {}) => ({ ...BASE, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [MAP[k], v])) });
const approvals = (r) => r.rows.map((x) => x.approval);

test("a list upload takes the right column, drops blanks and repeats, and reports over-long values", () => {
  const t = parseTableUpload(["Notes", "Job reference"], [{ Notes: "a", "Job reference": "JOB-1" }, { Notes: "b", "Job reference": " job-1 " }, { Notes: "c", "Job reference": "JOB-2" }, { Notes: "d", "Job reference": "" }], "list");
  assert.deepEqual([t.rows, t.errors, t.columns], [["JOB-1", "JOB-2"], [], ["Job reference"]]);
  assert.deepEqual(parseTableUpload(["Anything", "Else"], [{ Anything: "X1", Else: "y" }], "list").rows, ["X1"]);          // no known heading: the first column
  assert.match(parseTableUpload(["Value"], [{ Value: "x".repeat(121) }], "list").errors[0], /Row 2: a value is over 120/);
  assert.match(parseTableUpload(["Value"], [], "list").errors[0], /no rows/);
});

test("a lookup upload reads key, value and optional dates, and reports bad rows by file row", () => {
  const rows = [
    { Country: "Country 1", "Fee %": "5.5%", "Valid from": "2026-07-01", "Valid to": "" },
    { Country: "Country 1", "Fee %": 6, "Valid from": "2026-01-01", "Valid to": "2026-06-30" },
    { Country: "Country 2", "Fee %": "n/a", "Valid from": "2026-07-01" },
    { Country: "Country 3", "Fee %": 7, "Valid from": "last week" },
    { Country: "Country 1", "Fee %": 5.5, "Valid from": "2026-07-01" },
    { Country: "", "Fee %": "" },
  ];
  const t = parseTableUpload(["Country", "Fee %", "Valid from", "Valid to"], rows, "lookup");
  assert.deepEqual(t.columns, ["Country", "Fee %", "Valid from", "Valid to"]);
  assert.deepEqual(t.rows, [{ key: "Country 1", value: 5.5, from: "2026-07-01" }, { key: "Country 1", value: 6, from: "2026-01-01", to: "2026-06-30" }]);
  assert.deepEqual(t.errors, ['Row 4: "n/a" in Fee % is not a number', 'Row 5: "last week" in Valid from is not a date', "Row 6: Country 1 from 2026-07-01 appears twice"]);
  assert.match(parseTableUpload(["Only"], [{ Only: "x" }], "lookup").errors[0], /key column and a value column/);
  assert.deepEqual(parseTableUpload(["Key", "Value"], [{ Key: "A", Value: 1 }], "lookup").rows, [{ key: "A", value: 1 }]);   // no dates is fine
});

test("a fee rule reading an uploaded table picks the row that applies on the line's date", () => {
  const rules = buildRules("fee_schedule", { by: "country", table_ref: "fee_by_country", default: 9 });
  assert.deepEqual(rules[0].expected, { field: "fee_pct", by: "country", table_ref: "fee_by_country", default: 9, tolerance: 0.05 });
  const tables = { fee_by_country: { kind: "lookup", version: 3, rows: [{ key: "Country 1", value: 6, to: "2026-06-30" }, { key: "Country 1", value: 5.5, from: "2026-07-01" }, { key: "Country 2", value: 6.5 }] } };
  const run = (rows) => runChecks(rows, { column_map: MAP, rules }, { tables });
  const res = run([R({ fee_pct: 5.5 }), R({ fee_pct: 6 }), R({ fee_pct: 6, closed_date: "2026-03-01" }), R({ fee_pct: 5.5, closed_date: "2026-03-01" }), R({ country: "Country 2", fee_pct: 6.5 }), R({ country: "Country 9", fee_pct: 9 }), R({ country: "Country 9", fee_pct: 6 })]);
  assert.deepEqual(approvals(res), ["pass", "issue", "pass", "issue", "pass", "pass", "issue"]);
  assert.equal(res.rows[1].comment, "ISSUE: Fee % is 6, expected 5.5 for Country 1.");                            // from 1 July the new fee applies
  assert.deepEqual(res.summary.tables_used, { fee_by_country: 3 });                                               // the run records which version it read
});

test("an exception list uploaded as a table is used by name; it replaces a same-named list in the rule set", () => {
  const rules = buildRules("markup_exceptions", { list: "exc", on_list: 0, other: 5 });
  const tables = { exc: { kind: "list", version: 2, rows: ["JOB-1"] } };
  const rows = [R({ job_ref: "JOB-1", fee_pct: 0 }), R({ job_ref: "JOB-1", fee_pct: 5 }), R({ job_ref: "JOB-7", fee_pct: 5 })];
  const res = runChecks(rows, { column_map: MAP, lists: { exc: ["JOB-7"] }, rules }, { tables });
  assert.deepEqual(approvals(res), ["pass", "issue", "pass"]);                                                    // the uploaded list wins over the inline one
  assert.deepEqual(res.summary.tables_used, { exc: 2 });
});

test("a rule that reads a list or table nobody has uploaded is skipped and says why, instead of flagging every line", () => {
  const rules = [...buildRules("markup_exceptions", { list: "exc", other: 5 }), ...buildRules("fee_schedule", { table_ref: "fees", by: "country" })];
  const res = runChecks([R({ job_ref: "JOB-1", fee_pct: 3 })], { column_map: MAP, rules });
  assert.equal(res.rows[0].approval, "pass");
  const reasons = Object.fromEntries(res.summary.skipped_rules.map((s) => [s.id, s.reason]));
  assert.match(reasons.markup_exc_listed, /No live version of: exc/);
  assert.match(reasons.fee_schedule, /No live version of: fees/);
  assert.deepEqual(Object.keys(res.summary.by_rule), ["markup_exc_unknown"]);                                      // the one rule that does not read the list still runs
  assert.equal(res.summary.tables_used, undefined);
  // a list table of the wrong kind does not satisfy a lookup reference
  const wrong = runChecks([R({ fee_pct: 3 })], { column_map: MAP, rules: buildRules("fee_schedule", { table_ref: "fees", by: "country" }) }, { tables: { fees: { kind: "list", rows: ["x"] } } });
  assert.match(wrong.summary.skipped_rules[0].reason, /fees/);
});

test("validation knows which tables exist and what kind they are", () => {
  const rs = { column_map: MAP, rules: [...buildRules("fee_schedule", { table_ref: "fees", by: "country" }), ...buildRules("markup_exceptions", { list: "exc" })] };
  assert.deepEqual(refsUsed(rs.rules[0]), { lists: [], tables: ["fees"] });
  assert.deepEqual(validateRuleset(rs, { fees: "lookup", exc: "list" }), []);
  const errs = validateRuleset(rs, { fees: "list" }).join("\n");
  assert.match(errs, /table "fees" has not been uploaded as a lookup table/);
  assert.match(errs, /the list "exc" does not exist/);
  assert.match(validateRuleset({ column_map: MAP, rules: [{ id: "r1", name: "x", kind: "expected_value", outcome: "issue", comment: "c", expected: { field: "fee_pct", table_ref: "fees" } }] }, { fees: "lookup" }).join(), /looked up by/);
});
