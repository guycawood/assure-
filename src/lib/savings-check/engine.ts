// Savings-file check engine. Pure functions: a client's rule set + the rows of an uploaded file in, an approval and a comment per row out.
// Nothing here knows about a particular client. A client's file columns are mapped to the standard fields below, and its rules are data
// (conditions and expected values), so the same engine serves every client. No relative imports: it runs in the app and in plain Node tests.

// ---------------------------------------------------------------------------
// Standard fields: what a savings file is read into
// ---------------------------------------------------------------------------
export type FieldType = "text" | "number" | "percent" | "date" | "bool";
export const FIELDS: { key: string; label: string; type: FieldType }[] = [
  { key: "job_ref", label: "Job reference", type: "text" },
  { key: "spec_number", label: "Spec number", type: "text" },
  { key: "region", label: "Region", type: "text" },
  { key: "country", label: "Country", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "product_type", label: "Product type", type: "text" },
  { key: "owner", label: "Owner / approver", type: "text" },
  { key: "closed_date", label: "Bill closed date", type: "date" },
  { key: "buy_price", label: "Buy price (net total, local currency)", type: "number" },
  { key: "match_type", label: "Savings type", type: "text" },
  { key: "total_savings", label: "Total savings", type: "number" },
  { key: "savings_pct", label: "Savings %", type: "percent" },
  { key: "savings_pct_auto", label: "Savings % from the automatic baseline", type: "percent" },
  { key: "eligible_quotes", label: "Eligible quotes received", type: "number" },
  { key: "fee_pct", label: "Fee / mark-up %", type: "percent" },
  { key: "premium_flag", label: "Premium item?", type: "bool" },
  { key: "rate_card_spec", label: "Rate card spec code", type: "text" },
  { key: "exchange_rate", label: "Exchange rate used", type: "number" },
  { key: "rate_period", label: "Exchange rate set applied", type: "text" },
  { key: "addressable", label: "Addressable / non-addressable", type: "text" },
  { key: "missed_opp_savings", label: "Missed opportunity savings", type: "number" },
  { key: "baseline_matched", label: "Baseline matched?", type: "bool" },
  { key: "use_auto_baseline", label: "Use automatic baseline?", type: "bool" },
  { key: "client_comments", label: "Comments for the client", type: "text" },
  { key: "client_share", label: "Marked for client sharing?", type: "bool" },
];
const FIELD_TYPE = new Map(FIELDS.map((f) => [f.key, f.type]));
export const isFieldKey = (k: string) => /^[a-z][a-z0-9_]{0,40}$/.test(k);

// ---------------------------------------------------------------------------
// Rule set
// ---------------------------------------------------------------------------
export type Value = string | number | boolean | null;
export type Cmp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "blank" | "filled" | "zero" | "nonzero" | "empty" | "in" | "not_in" | "contains"
  | "before" | "after" | "on_or_after" | "on_or_before" | "is_true" | "is_false";
export type Leaf = { field: string; op: Cmp; value?: Value | Value[]; other?: string; list?: string; tol?: number };
export type Condition = Leaf | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export type Scope = { regions?: string[]; when?: Condition; date_field?: string; from?: string; to?: string };
// table: values written into the rule. table_ref: the name of an uploaded lookup table (effective-dated rows), read when the check runs.
export type ExpectedValue = { field: string; by?: string; table?: Record<string, number>; table_ref?: string; date_field?: string; default?: number; tolerance?: number; fire_when_blank?: boolean };

/** An uploaded table as a check run sees it: a list of values, or a lookup of key to value with optional effective dates on each row. */
export type LookupRow = { key: string; value: number; from?: string; to?: string };
export type TableData = { kind: "list"; rows: string[]; version?: number } | { kind: "lookup"; rows: LookupRow[]; version?: number };
export type Outcome = "issue" | "confirm" | "hold";
export type Rule = {
  id: string; name: string; template?: string; enabled?: boolean; outcome: Outcome; comment: string; scope?: Scope;
  kind: "condition" | "expected_value"; condition?: Condition; expected?: ExpectedValue;
};
export type Ruleset = {
  regions?: string[];
  column_map: Record<string, string>;
  percent_as_fraction?: boolean;
  lists?: Record<string, string[]>;
  method?: Record<string, unknown>;
  rules: Rule[];
};

// ---------------------------------------------------------------------------
// Reading values
// ---------------------------------------------------------------------------
const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[\s,]/g, "").replace(/%$/, "").replace(/^[^\d.+-]+/, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** ISO date from an ISO string, a day-first date (15/03/2027), "15 Mar 2027", a Date, or an Excel serial number. */
export function toDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = s.toLowerCase().match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*\.?,?[\s-]+(\d{4})/);
  if (m && MONTHS.includes(m[2])) return iso(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
  if (/^\d{5}$/.test(s)) return toDate(Number(s));
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (["yes", "y", "true", "1", "x"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return null;
}

export type Row = Record<string, Value>;

/** Read one file row into standard fields using the client's column map. A blank cell is null. */
export function normaliseRow(raw: Record<string, unknown>, ruleset: Pick<Ruleset, "column_map" | "percent_as_fraction">): Row {
  const out: Row = {};
  for (const [field, column] of Object.entries(ruleset.column_map ?? {})) {
    const cell = raw[column];
    if (isBlank(cell)) { out[field] = null; continue; }
    const type = FIELD_TYPE.get(field) ?? "text";
    if (type === "number") out[field] = toNumber(cell);
    else if (type === "percent") {
      const n = toNumber(cell);
      const text = typeof cell === "string" && cell.trim().endsWith("%");
      out[field] = n === null ? null : ruleset.percent_as_fraction && !text ? Math.round(n * 1e8) / 1e6 : n;
    } else if (type === "date") out[field] = toDate(cell);
    else if (type === "bool") out[field] = toBool(cell);
    else out[field] = typeof cell === "string" ? cell.trim() : String(cell);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------
const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v === null || v === undefined ? "" : String(v).trim().toLowerCase());
const num = (v: unknown) => (typeof v === "number" ? v : toNumber(v));

export function testLeaf(l: Leaf, row: Row, lists: Record<string, string[]> = {}): boolean {
  const a = row[l.field] ?? null;
  const target: Value | Value[] | undefined = l.other ? row[l.other] ?? null : l.value;
  const tol = l.tol ?? 0.0005;
  switch (l.op) {
    case "blank": return isBlank(a);
    case "filled": return !isBlank(a);
    case "zero": return num(a) !== null && Math.abs(num(a)!) <= tol;
    case "nonzero": return num(a) !== null && Math.abs(num(a)!) > tol;
    case "empty": return isBlank(a) || (num(a) !== null && Math.abs(num(a)!) <= tol);
    case "is_true": return a === true;
    case "is_false": return a === false;
    case "in": case "not_in": {
      const set = (l.list ? lists[l.list] ?? [] : Array.isArray(target) ? target : target === undefined ? [] : [target]).map(norm);
      const has = !isBlank(a) && set.includes(norm(a));
      return l.op === "in" ? has : !has;
    }
    case "contains": return !isBlank(a) && !Array.isArray(target) && norm(a).includes(norm(target));
    case "before": case "after": case "on_or_after": case "on_or_before": {
      const d = toDate(a), t = Array.isArray(target) ? null : toDate(target);
      if (!d || !t) return false;
      return l.op === "before" ? d < t : l.op === "after" ? d > t : l.op === "on_or_after" ? d >= t : d <= t;
    }
    default: {
      // A blank cell is "not equal" to a value, and satisfies no other comparison.
      if (Array.isArray(target) || isBlank(a)) return l.op === "ne" && isBlank(a) && !isBlank(target);
      const x = num(a), y = num(target);
      if (x !== null && y !== null) {
        switch (l.op) {
          case "eq": return Math.abs(x - y) <= tol;
          case "ne": return Math.abs(x - y) > tol;
          case "gt": return x > y;
          case "gte": return x >= y - tol;
          case "lt": return x < y;
          case "lte": return x <= y + tol;
        }
      }
      if (l.op === "eq") return norm(a) === norm(target);
      if (l.op === "ne") return norm(a) !== norm(target);
      return false;
    }
  }
}

export function testCondition(c: Condition, row: Row, lists: Record<string, string[]> = {}): boolean {
  if ("all" in c) return c.all.every((x) => testCondition(x, row, lists));
  if ("any" in c) return c.any.some((x) => testCondition(x, row, lists));
  if ("not" in c) return !testCondition(c.not, row, lists);
  return testLeaf(c, row, lists);
}

function fieldsIn(c: Condition | undefined, into = new Set<string>()): Set<string> {
  if (!c) return into;
  if ("all" in c) c.all.forEach((x) => fieldsIn(x, into));
  else if ("any" in c) c.any.forEach((x) => fieldsIn(x, into));
  else if ("not" in c) fieldsIn(c.not, into);
  else { into.add(c.field); if (c.other) into.add(c.other); }
  return into;
}

function listsIn(c: Condition | undefined, into = new Set<string>()): Set<string> {
  if (!c) return into;
  if ("all" in c) c.all.forEach((x) => listsIn(x, into));
  else if ("any" in c) c.any.forEach((x) => listsIn(x, into));
  else if ("not" in c) listsIn(c.not, into);
  else if (c.list) into.add(c.list);
  return into;
}

/** The named lists and lookup tables a rule reads when it runs. */
export function refsUsed(rule: Rule): { lists: string[]; tables: string[] } {
  const lists = listsIn(rule.scope?.when, listsIn(rule.condition));
  return { lists: [...lists], tables: rule.expected?.table_ref ? [rule.expected.table_ref] : [] };
}

export function fieldsUsed(rule: Rule): string[] {
  const s = fieldsIn(rule.condition);
  fieldsIn(rule.scope?.when, s);
  if (rule.scope?.regions?.length) s.add("region");
  if (rule.scope?.from || rule.scope?.to) s.add(rule.scope.date_field ?? "closed_date");
  if (rule.expected) { s.add(rule.expected.field); if (rule.expected.by) s.add(rule.expected.by); }
  return [...s];
}

// ---------------------------------------------------------------------------
// Validation (used before a rule set is saved)
// ---------------------------------------------------------------------------
const CMPS: Cmp[] = ["eq", "ne", "gt", "gte", "lt", "lte", "blank", "filled", "zero", "nonzero", "empty", "in", "not_in", "contains", "before", "after", "on_or_after", "on_or_before", "is_true", "is_false"];
const VALUE_NEEDED = new Set<Cmp>(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "before", "after", "on_or_after", "on_or_before"]);

function checkCondition(c: unknown, where: string, errs: string[], lists: Record<string, string[]>) {
  if (!c || typeof c !== "object") { errs.push(`${where}: a condition is needed`); return; }
  const o = c as Record<string, unknown>;
  for (const k of ["all", "any"]) if (k in o) {
    if (!Array.isArray(o[k]) || (o[k] as unknown[]).length === 0) errs.push(`${where}: "${k}" needs at least one condition`);
    else (o[k] as unknown[]).forEach((x, i) => checkCondition(x, `${where}.${k}[${i}]`, errs, lists));
    return;
  }
  if ("not" in o) { checkCondition(o.not, `${where}.not`, errs, lists); return; }
  const l = o as unknown as Leaf;
  if (typeof l.field !== "string" || !isFieldKey(l.field)) errs.push(`${where}: unknown field`);
  if (!CMPS.includes(l.op)) { errs.push(`${where}: unknown comparison "${String(l.op)}"`); return; }
  if (VALUE_NEEDED.has(l.op) && l.value === undefined && !l.other) errs.push(`${where}: "${l.op}" needs a value or another field`);
  if ((l.op === "in" || l.op === "not_in") && !l.list && !Array.isArray(l.value)) errs.push(`${where}: "${l.op}" needs a list`);
  if (l.list && !(l.list in lists)) errs.push(`${where}: the list "${l.list}" does not exist`);
}

/** known: the client's uploaded tables by name, so a rule that points at one is checked against what exists. */
export function validateRuleset(rs: Ruleset, known?: Record<string, "list" | "lookup">): string[] {
  const errs: string[] = [];
  const lists: Record<string, string[]> = { ...(rs.lists ?? {}), ...Object.fromEntries(Object.entries(known ?? {}).filter(([, k]) => k === "list").map(([n]) => [n, [] as string[]])) };
  if (!rs || typeof rs !== "object") return ["The rule set is empty"];
  if (!rs.column_map || typeof rs.column_map !== "object") errs.push("Map the file columns to the standard fields");
  for (const [f, col] of Object.entries(rs.column_map ?? {})) {
    if (!isFieldKey(f)) errs.push(`Column map: "${f}" is not a valid field name`);
    if (typeof col !== "string" || !col.trim()) errs.push(`Column map: the column for ${f} is empty`);
  }
  const ids = new Set<string>();
  for (const r of rs.rules ?? []) {
    const w = `Rule ${r.id}`;
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(r.id ?? "")) errs.push(`${w}: ids use letters, digits and underscores`);
    if (ids.has(r.id)) errs.push(`${w}: the id is used twice`);
    ids.add(r.id);
    if (!r.name?.trim()) errs.push(`${w}: give it a name`);
    if (!["issue", "confirm", "hold"].includes(r.outcome)) errs.push(`${w}: the outcome must be issue, confirm or hold`);
    if (!r.comment?.trim()) errs.push(`${w}: write the comment the person will see`);
    if (r.kind === "condition") checkCondition(r.condition, `${w}.condition`, errs, lists);
    else if (r.kind === "expected_value") {
      const e = r.expected;
      if (!e || !isFieldKey(e.field ?? "")) errs.push(`${w}: say which field is checked`);
      else if (!e.table && !e.table_ref && e.default === undefined) errs.push(`${w}: give the expected value, or a table to look it up in`);
      if ((e?.table || e?.table_ref) && !e.by) errs.push(`${w}: say which field the table is looked up by`);
      if (e?.table_ref && known && known[e.table_ref] !== "lookup") errs.push(`${w}: the table "${e.table_ref}" has not been uploaded as a lookup table`);
    } else errs.push(`${w}: unknown kind`);
    if (r.scope?.when) checkCondition(r.scope.when, `${w}.scope.when`, errs, lists);
    for (const d of [r.scope?.from, r.scope?.to]) if (d && !toDate(d)) errs.push(`${w}: "${d}" is not a date`);
    for (const reg of r.scope?.regions ?? []) if (rs.regions?.length && !rs.regions.map(norm).includes(norm(reg))) errs.push(`${w}: region "${reg}" is not one of this client's regions`);
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Running the rules
// ---------------------------------------------------------------------------
export type Approval = "pass" | "issue" | "confirm" | "hold";
const SEVERITY: Record<Approval, number> = { pass: 0, confirm: 1, hold: 2, issue: 3 };
export type RowResult = { index: number; approval: Approval; comment: string; rules: string[] };
export type Summary = {
  total: number; pass: number; issue: number; confirm: number; hold: number;
  by_rule: Record<string, { name: string; outcome: Outcome; fired: number; in_scope: number }>;
  skipped_rules: { id: string; reason: string }[];
  tables_used?: Record<string, number | null>;      // the uploaded tables the rules that ran read, with the version of each
};

function inScope(rule: Rule, row: Row, lists: Record<string, string[]>): boolean {
  const s = rule.scope;
  if (!s) return true;
  if (s.regions?.length && !s.regions.map(norm).includes(norm(row.region))) return false;
  if (s.from || s.to) {
    const d = toDate(row[s.date_field ?? "closed_date"]);
    if (!d) return false;                                    // a line with no date cannot be placed in the period
    if (s.from && d < (toDate(s.from) as string)) return false;
    if (s.to && d > (toDate(s.to) as string)) return false;
  }
  return s.when ? testCondition(s.when, row, lists) : true;
}

const show = (v: Value | undefined): string => {
  if (v === null || v === undefined) return "–";
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return v;
};
const fill = (tpl: string, row: Row, extra: Record<string, Value> = {}) => tpl.replace(/\{([a-z][a-z0-9_]*)\}/g, (_m, k: string) => show(k in extra ? extra[k] : row[k]));

/** The value from an uploaded lookup that applies to this line: the key matches and the line's date falls in the row's dates (the latest start wins). */
function lookupFor(rows: LookupRow[], key: string, date: string | null): number | null {
  const k = norm(key);
  const fits = rows.filter((r) => norm(r.key) === k && (!r.from || (date !== null && date >= r.from)) && (!r.to || (date !== null && date <= r.to)));
  if (fits.length === 0) return null;
  return fits.sort((a, b) => (b.from ?? "").localeCompare(a.from ?? ""))[0].value;
}

function expectedFor(e: ExpectedValue, row: Row, tables: Record<string, TableData>): number | null {
  if (e.table_ref) {
    const t = tables[e.table_ref];
    if (t?.kind === "lookup") {
      const found = lookupFor(t.rows, String(row[e.by as string] ?? ""), toDate(row[e.date_field ?? "closed_date"]));
      if (found !== null) return found;
    }
  } else if (e.table) {
    const key = norm(row[e.by as string]);
    for (const [k, v] of Object.entries(e.table)) if (norm(k) === key) return v;
  }
  return e.default ?? null;
}

export type RunOptions = { onlyRules?: string[]; headers?: string[]; tables?: Record<string, TableData> };

export function runChecks(rawRows: Record<string, unknown>[], ruleset: Ruleset, options: RunOptions = {}): { rows: RowResult[]; summary: Summary } {
  const tables = options.tables ?? {};
  // Named lists: the ones written in the rule set, and the uploaded list tables (an upload replaces a list of the same name).
  const lists: Record<string, string[]> = { ...(ruleset.lists ?? {}), ...Object.fromEntries(Object.entries(tables).filter(([, t]) => t.kind === "list").map(([n, t]) => [n, t.rows as string[]])) };
  const headers = new Set(options.headers ?? Object.keys(rawRows[0] ?? {}));
  const active: Rule[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const r of ruleset.rules ?? []) {
    if (r.enabled === false) continue;
    if (options.onlyRules && !options.onlyRules.includes(r.id)) continue;
    const missing = fieldsUsed(r).filter((f) => !ruleset.column_map?.[f] || (headers.size > 0 && !headers.has(ruleset.column_map[f])));
    if (missing.length) { skipped.push({ id: r.id, reason: `The file has no column for: ${missing.join(", ")}` }); continue; }
    // A rule that reads a list or table nobody has uploaded must not run: an empty list would flag (or clear) every line.
    const refs = refsUsed(r);
    const noList = refs.lists.filter((n) => !(n in lists)), noTable = refs.tables.filter((n) => tables[n]?.kind !== "lookup");
    if (noList.length || noTable.length) { skipped.push({ id: r.id, reason: `No live version of: ${[...noList, ...noTable].join(", ")}. Upload it in Method & rules.` }); continue; }
    active.push(r);
  }
  const by_rule: Summary["by_rule"] = Object.fromEntries(active.map((r) => [r.id, { name: r.name, outcome: r.outcome, fired: 0, in_scope: 0 }]));
  const used: Record<string, number | null> = {};
  for (const r of active) {
    const refs = refsUsed(r);
    for (const n of [...refs.tables, ...refs.lists]) if (tables[n]) used[n] = tables[n].version ?? null;
  }
  const summary: Summary = { total: rawRows.length, pass: 0, issue: 0, confirm: 0, hold: 0, by_rule, skipped_rules: skipped, ...(Object.keys(used).length ? { tables_used: used } : {}) };

  const rows = rawRows.map((raw, index): RowResult => {
    const row = normaliseRow(raw, ruleset);
    const hits: { rule: Rule; text: string }[] = [];
    for (const r of active) {
      if (!inScope(r, row, lists)) continue;
      by_rule[r.id].in_scope++;
      let fired = false, extra: Record<string, Value> = {};
      if (r.kind === "condition" && r.condition) fired = testCondition(r.condition, row, lists);
      else if (r.kind === "expected_value" && r.expected) {
        const exp = expectedFor(r.expected, row, tables);
        if (exp === null) continue;                        // nothing to compare with for this line
        const actual = num(row[r.expected.field]);
        extra = { expected: exp };
        fired = actual === null ? r.expected.fire_when_blank !== false : Math.abs(actual - exp) > (r.expected.tolerance ?? 0.05);
      }
      if (fired) { by_rule[r.id].fired++; hits.push({ rule: r, text: fill(r.comment, row, extra) }); }
    }
    if (hits.length === 0) { summary.pass++; return { index, approval: "pass", comment: "", rules: [] }; }
    hits.sort((a, b) => SEVERITY[b.rule.outcome] - SEVERITY[a.rule.outcome]);
    const approval = hits[0].rule.outcome;
    summary[approval]++;
    return { index, approval, comment: hits.map((h) => h.text).join(" | ").slice(0, 1500), rules: hits.map((h) => h.rule.id) };
  });
  return { rows, summary };
}

// ---------------------------------------------------------------------------
// Output: the same file with two result columns added, nothing else changed
// ---------------------------------------------------------------------------
export const APPROVAL_LABEL: Record<Approval, string> = { pass: "", issue: "Issue", confirm: "Need to Confirm", hold: "Hold" };

export function annotate(rawRows: Record<string, unknown>[], results: RowResult[], names: { approval?: string; comment?: string } = {}): Record<string, unknown>[] {
  const a = names.approval ?? "Check approval", c = names.comment ?? "Check comments";
  return rawRows.map((r, i) => ({ ...r, [a]: APPROVAL_LABEL[results[i].approval], [c]: results[i].comment }));
}

// ---------------------------------------------------------------------------
// Uploaded tables: reading a client's fee schedule or exception list from a file
// ---------------------------------------------------------------------------
const MAX_TABLE_ROWS = 50000;
const heading = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const pickColumn = (headers: string[], names: string[], fallback?: number): string | null => {
  const hit = headers.find((h) => names.includes(heading(h)));
  return hit ?? (fallback !== undefined ? headers[fallback] ?? null : null);
};

export type ParsedTable = { kind: "list"; rows: string[]; errors: string[]; columns: string[] } | { kind: "lookup"; rows: LookupRow[]; errors: string[]; columns: string[] };

/**
 * Read an uploaded table. A list takes one column (the one headed value, item, job, id or similar, else the first). A lookup takes a key column
 * (key, name, country, category or the first), a value column (value, fee, rate, percent or the second), and optionally "from" and "until" dates
 * so a schedule can change on a date without losing the old rows. Problems are reported by row number (the file's row, counting the heading as 1).
 */
export function parseTableUpload(headers: string[], rows: Record<string, unknown>[], kind: "list" | "lookup"): ParsedTable {
  const errors: string[] = [];
  const err = (m: string) => { if (errors.length < 10) errors.push(m); };
  if (rows.length === 0) return { kind, rows: [], errors: ["The file has no rows below the headings."], columns: [] } as ParsedTable;
  if (rows.length > MAX_TABLE_ROWS) return { kind, rows: [], errors: [`The file has ${rows.length.toLocaleString("en-GB")} rows. The limit is ${MAX_TABLE_ROWS.toLocaleString("en-GB")}.`], columns: [] } as ParsedTable;
  const cell = (v: unknown) => (v instanceof Date ? (toDate(v) ?? "") : v === null || v === undefined ? "" : String(v).trim());

  if (kind === "list") {
    const col = pickColumn(headers, ["value", "item", "items", "list", "id", "ref", "jobref", "job", "jobreference", "number"], 0);
    if (!col) return { kind, rows: [], errors: ["The file has no columns."], columns: [] };
    const seen = new Set<string>(), out: string[] = [];
    rows.forEach((r, i) => {
      const v = cell(r[col]);
      if (!v) return;
      if (v.length > 120) { err(`Row ${i + 2}: a value is over 120 characters`); return; }
      if (!seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
    });
    if (out.length === 0 && errors.length === 0) errors.push(`The column "${col}" has no values.`);
    return { kind, rows: out, errors, columns: [col] };
  }

  const keyCol = pickColumn(headers, ["key", "name", "country", "category", "market", "lookup", "by"], 0);
  const valCol = pickColumn(headers, ["value", "fee", "feepct", "rate", "percent", "pct", "markup"], 1);
  const fromCol = pickColumn(headers, ["from", "effectivefrom", "validfrom", "start", "startdate"]);
  const toCol = pickColumn(headers, ["to", "until", "validto", "end", "enddate", "effectiveto"]);
  if (!keyCol || !valCol || keyCol === valCol) return { kind, rows: [], errors: ["A lookup needs a key column and a value column, for example Country and Fee %."], columns: [] };
  const out: LookupRow[] = [], seen = new Set<string>();
  rows.forEach((r, i) => {
    const key = cell(r[keyCol]), raw = r[valCol];
    if (!key && (raw === null || raw === undefined || cell(raw) === "")) return;                 // a fully blank line
    if (!key) { err(`Row ${i + 2}: the ${keyCol} is empty`); return; }
    const value = toNumber(raw);
    if (value === null) { err(`Row ${i + 2}: "${cell(raw)}" in ${valCol} is not a number`); return; }
    const from = fromCol && cell(r[fromCol]) ? toDate(r[fromCol]) : null, to = toCol && cell(r[toCol]) ? toDate(r[toCol]) : null;
    if (fromCol && cell(r[fromCol]) && !from) { err(`Row ${i + 2}: "${cell(r[fromCol])}" in ${fromCol} is not a date`); return; }
    if (toCol && cell(r[toCol]) && !to) { err(`Row ${i + 2}: "${cell(r[toCol])}" in ${toCol} is not a date`); return; }
    if (from && to && to < from) { err(`Row ${i + 2}: ends before it starts`); return; }
    const id = `${key.toLowerCase()}|${from ?? ""}`;
    if (seen.has(id)) { err(`Row ${i + 2}: ${key}${from ? ` from ${from}` : ""} appears twice`); return; }
    seen.add(id);
    out.push({ key, value, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  });
  if (out.length === 0 && errors.length === 0) errors.push("The file has no values.");
  return { kind, rows: out, errors, columns: [keyCol, valCol, ...(fromCol ? [fromCol] : []), ...(toCol ? [toCol] : [])] };
}
