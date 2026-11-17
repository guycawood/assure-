"use server";

import { revalidatePath } from "next/cache";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendly, id as uuidField, str, type FormResult } from "@/lib/sourcing-actions";
import { FIELDS, validateRuleset, type Ruleset } from "@/lib/savings-check/engine";
import { buildRules, exampleRuleset, TEMPLATES, type Params } from "@/lib/savings-check/templates";

// A client's savings method and check rules (CRM). Edits go into one open draft; a different CRM owner approves it before it applies.
type Version = { id: string; version: number; status: "draft" | "pending" | "published" | "retired"; doc: Ruleset; reason: string | null };
type Client = Awaited<ReturnType<typeof createClient>>;

const EMPTY: Ruleset = { regions: [], column_map: {}, lists: {}, method: {}, rules: [] };

async function load(supabase: Client, clientId: string) {
  const { data } = await supabase.rpc("crm_rulesets", { p_client: clientId });
  const versions = (data as Version[] | null) ?? [];
  const open = versions.find((v) => v.status === "draft" || v.status === "pending");
  const published = versions.find((v) => v.status === "published");
  return { open, published, doc: structuredClone((open ?? published)?.doc ?? EMPTY) as Ruleset, reason: open?.reason ?? "Draft edit" };
}

/** Change the draft (starting one from the live rule set if there is none) and save it. */
async function edit(fd: FormData, change: (doc: Ruleset) => string | void, message: string): Promise<FormResult> {
  await requireInternal();
  const clientId = uuidField(fd, "client_id");
  if (!clientId) return { error: "Client not found." };
  const supabase = await createClient();
  const cur = await load(supabase, clientId);
  if (cur.open?.status === "pending") return { error: "A change is waiting for approval. Withdraw it first to edit." };
  const problem = change(cur.doc);
  if (problem) return { error: problem };
  const { error } = await supabase.rpc("crm_ruleset_draft_save", { p_client: clientId, p_doc: cur.doc, p_reason: cur.reason });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${clientId}`);
  return { ok: true, message };
}

const lines = (s: string | null) => (s ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const items = (s: string | null) => (s ?? "").split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export async function startRuleDraft(_: FormResult, fd: FormData): Promise<FormResult> {
  const example = fd.get("from") === "example";
  return edit(fd, (doc) => { if (example && doc.rules.length === 0 && Object.keys(doc.column_map).length === 0) Object.assign(doc, exampleRuleset()); },
    example ? "Started from the example rule set. Replace its names and values with this client's own." : "Draft started.");
}

/** Read a template's parameter values out of the form according to the template's own parameter list. */
function readParams(key: string, fd: FormData): { params: Params } | { error: string } {
  const t = TEMPLATES[key];
  if (!t) return { error: "Choose a rule type." };
  const params: Params = {};
  for (const d of t.params) {
    const raw = str(fd, `p_${d.key}`);
    if (raw === null) continue;
    if (d.type === "number") { const n = Number(raw); if (!Number.isFinite(n)) return { error: `${d.label}: enter a number.` }; params[d.key] = n; }
    else if (d.type === "list") params[d.key] = items(raw);
    else if (d.type === "map") {
      const m: Record<string, number> = {};
      for (const l of lines(raw)) {
        const [k, v] = l.split(/[=:]/).map((x) => x.trim());
        if (!k || v === undefined || !Number.isFinite(Number(v))) return { error: `${d.label}: write each line as name = value, for example Country 1 = 5.5.` };
        m[k] = Number(v);
      }
      params[d.key] = m;
    } else if (d.type === "groups") {
      params[d.key] = lines(raw).map((l) => { const [c, o] = l.split(":"); return { category: (c ?? "").trim(), owners: items(o ?? "") }; }).filter((g) => g.category && g.owners.length);
    } else params[d.key] = raw;
  }
  return { params };
}

export async function addRulesFromTemplate(_: FormResult, fd: FormData): Promise<FormResult> {
  const key = str(fd, "template") ?? "";
  const read = readParams(key, fd);
  if ("error" in read) return { error: read.error };
  const rules = buildRules(key, read.params);
  if (rules.length === 0) return { error: "That setup gives no rules. Fill in the values it needs." };
  return edit(fd, (doc) => {
    const taken = new Set(doc.rules.map((r) => r.id));
    for (const r of rules) {                                           // keep ids unique when the same kind of rule is added twice
      let id = r.id, n = 2;
      while (taken.has(id)) id = `${r.id}_${n++}`.slice(0, 41);
      taken.add(id);
      doc.rules.push({ ...r, id });
    }
  }, `Added ${rules.length} rule${rules.length === 1 ? "" : "s"}.`);
}

export async function removeRule(_: FormResult, fd: FormData): Promise<FormResult> {
  const rid = str(fd, "rule");
  return edit(fd, (doc) => { doc.rules = doc.rules.filter((r) => r.id !== rid); }, "Rule removed.");
}

export async function toggleRule(_: FormResult, fd: FormData): Promise<FormResult> {
  const rid = str(fd, "rule");
  return edit(fd, (doc) => { const r = doc.rules.find((x) => x.id === rid); if (r) r.enabled = r.enabled === false; }, "Rule updated.");
}

export async function editRuleText(_: FormResult, fd: FormData): Promise<FormResult> {
  const rid = str(fd, "rule"), outcome = str(fd, "outcome"), comment = str(fd, "comment"), name = str(fd, "name");
  if (!comment || !name) return { error: "A rule needs a name and the comment people will see." };
  if (!["issue", "confirm", "hold"].includes(outcome ?? "")) return { error: "Choose Issue, Need to confirm or Hold." };
  return edit(fd, (doc) => {
    const r = doc.rules.find((x) => x.id === rid);
    if (!r) return "Rule not found.";
    r.name = name; r.comment = comment; r.outcome = outcome as "issue" | "confirm" | "hold";
  }, "Rule saved.");
}

export async function saveColumnMap(_: FormResult, fd: FormData): Promise<FormResult> {
  return edit(fd, (doc) => {
    const map: Record<string, string> = {};
    for (const f of FIELDS) { const c = str(fd, `col_${f.key}`); if (c) map[f.key] = c; }
    for (const extra of lines(str(fd, "extra_columns"))) {            // the client's own fields: name = column
      const [k, v] = extra.split("=").map((x) => x.trim());
      if (k && v && /^[a-z][a-z0-9_]{0,40}$/.test(slug(k))) map[slug(k)] = v;
    }
    doc.column_map = map;
    doc.percent_as_fraction = fd.get("percent_as_fraction") === "on";
  }, "Column map saved.");
}

export async function saveRegionsAndLists(_: FormResult, fd: FormData): Promise<FormResult> {
  return edit(fd, (doc) => {
    doc.regions = items(str(fd, "regions"));
    const lists: Record<string, string[]> = {};
    for (const l of lines(str(fd, "lists"))) {
      const [name, rest] = l.split(":");
      if (name && rest !== undefined) lists[slug(name)] = items(rest);
    }
    doc.lists = lists;
  }, "Regions and lists saved.");
}

export async function saveMethod(_: FormResult, fd: FormData): Promise<FormResult> {
  const yes = (s: string | undefined) => /^(y|yes|true|1)$/i.test((s ?? "").trim());
  const n = (k: string) => { const v = str(fd, k); return v === null ? undefined : Number(v); };
  for (const k of ["standard_pct", "premium_pct", "review_pct", "hard_pct"]) if (n(k) !== undefined && !Number.isFinite(n(k))) return { error: "Fees and thresholds are numbers." };
  return edit(fd, (doc) => {
    const types = lines(str(fd, "savings_types")).map((l) => {
      const [label, counts, addr, minq, band] = l.split("|").map((x) => x.trim());
      return { key: slug(label ?? ""), label, counts_in_total: yes(counts), addressable: yes(addr), ...(minq ? { min_quotes: Number(minq) } : {}), ...(band ? { band_pct: Number(band) } : {}) };
    }).filter((t) => t.label);
    doc.method = {
      ...(doc.method ?? {}), savings_types: types,
      fee_model: { standard_pct: n("standard_pct"), premium_pct: n("premium_pct") },
      thresholds: { savings_review_pct: n("review_pct"), savings_hard_pct: n("hard_pct") },
    };
  }, "Method saved.");
}

export async function discardRuleDraft(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const clientId = uuidField(fd, "client_id");
  if (!clientId) return { error: "Client not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_ruleset_discard", { p_client: clientId });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${clientId}`);
  return { ok: true, message: "Draft discarded." };
}

export async function proposeRules(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const clientId = uuidField(fd, "client_id"), note = str(fd, "note");
  if (!clientId) return { error: "Client not found." };
  if (!note) return { error: "Say what changed and where it comes from (the client policy, a contract clause)." };
  const supabase = await createClient();
  const cur = await load(supabase, clientId);
  if (cur.open?.status !== "draft") return { error: "There is no draft to send." };
  const { data: tbl } = await supabase.rpc("crm_client_tables", { p_client: clientId });
  const known = Object.fromEntries(((tbl as { key: string; kind: "list" | "lookup" }[] | null) ?? []).map((t) => [t.key, t.kind]));
  const problems = validateRuleset(cur.doc, known);
  if (problems.length) return { error: `Fix this first: ${problems.slice(0, 4).join("; ")}${problems.length > 4 ? ` (and ${problems.length - 4} more)` : ""}` };
  const saved = await supabase.rpc("crm_ruleset_draft_save", { p_client: clientId, p_doc: cur.doc, p_reason: note });
  if (saved.error) return { error: friendly(saved.error) };
  const { error } = await supabase.rpc("crm_ruleset_propose", { p_id: cur.open.id });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${clientId}`);
  return { ok: true, message: "Sent. A CRM owner other than you needs to approve it before it applies." };
}

export async function withdrawRules(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_ruleset_withdraw", { p_id: str(fd, "id") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${uuidField(fd, "client_id")}`);
  return { ok: true, message: "Withdrawn. It is a draft again." };
}

export async function decideRules(_: FormResult, fd: FormData): Promise<FormResult> {
  await requireInternal();
  const approve = fd.get("decision") === "approve";
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_ruleset_decide", { p_id: str(fd, "id"), p_approve: approve, p_note: str(fd, "note") });
  if (error) return { error: friendly(error) };
  revalidatePath(`/crm/clients/${uuidField(fd, "client_id")}`);
  return { ok: true, message: approve ? "Approved. These rules now apply to this client's checks." : "Sent back with your reason." };
}
