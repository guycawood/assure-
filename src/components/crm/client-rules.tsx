import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Disclosure } from "@/components/crm/bits";
import { RuleTemplateForm } from "@/components/crm/rule-template-form";
import { ClientTables } from "@/components/crm/client-tables";
import { FIELDS, type Ruleset, type Rule } from "@/lib/savings-check/engine";
import {
  decideRules, discardRuleDraft, editRuleText, proposeRules, removeRule, saveColumnMap, saveMethod, saveRegionsAndLists, startRuleDraft, toggleRule, withdrawRules,
} from "@/app/(platform)/crm/clients/rules-actions";

type Version = {
  id: string; version: number; status: "draft" | "pending" | "published" | "retired"; doc: Ruleset; reason: string | null; created_at: string;
  proposed_by: string | null; proposed_by_name: string | null; proposed_at: string | null; decided_at: string | null; decision_note: string | null; published_at: string | null;
};
const OUTCOME = { issue: ["Issue", "bad"], confirm: ["Need to confirm", "warn"], hold: ["Hold", "info"] } as const;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const scopeText = (r: Rule) => {
  const s = r.scope, bits: string[] = [];
  if (s?.regions?.length) bits.push(s.regions.join(", "));
  if (s?.from || s?.to) bits.push(`${s.from ? `from ${s.from}` : ""}${s.from && s.to ? " " : ""}${s.to ? `until ${s.to}` : ""}`);
  if (s?.when) bits.push("some lines only");
  return bits.join(" · ") || "All lines";
};
const asText = (o: unknown) => (typeof o === "number" ? String(o) : "");

// A client's savings and sourcing method, its check rules, and the map from its file's columns. Changes are drafted here and approved by another CRM owner.
export async function ClientRules({ clientId, meId }: { clientId: string; meId: string }) {
  const supabase = await createClient();
  const [vs, gov, tb] = await Promise.all([supabase.rpc("crm_rulesets", { p_client: clientId }), supabase.rpc("can_govern", { p_module: "crm" }), supabase.rpc("crm_client_tables", { p_client: clientId })]);
  const tableKeys = ((tb.data as { key: string; kind: "list" | "lookup" }[] | null) ?? []).map((t) => ({ key: t.key, kind: t.kind }));
  const versions = (vs.data as Version[] | null) ?? [];
  const canApprove = gov.data === true;
  const live = versions.find((v) => v.status === "published");
  const open = versions.find((v) => v.status === "draft" || v.status === "pending");
  const shown = open ?? live;
  const doc = shown?.doc;
  const editable = open?.status !== "pending";
  const method = (doc?.method ?? {}) as { savings_types?: { label: string; counts_in_total: boolean; addressable: boolean; min_quotes?: number; band_pct?: number }[]; fee_model?: Record<string, unknown>; thresholds?: Record<string, unknown> };
  const hidden = { client_id: clientId };

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-semibold">Savings method and check rules</h2>
          {live ? <Pill tone="ok">Live: version {live.version}, approved {day(live.published_at)}</Pill> : <Pill tone="neutral">No rules are live yet</Pill>}
          {live && <Link href={`/crm/clients/${clientId}/check`} className="btn-primary ml-auto inline-block">Check a savings file</Link>}
        </div>
        <p className="text-sm text-muted">How this client counts savings and fees, and the checks a savings file must pass before it is approved. Every client has its own. A change is drafted here, then a CRM owner other than the person who proposed it approves it.</p>

        {open?.status === "pending" && (
          <div className="space-y-2 rounded-xl bg-warn-soft p-4 text-sm">
            <p><b>Version {open.version} is waiting for approval.</b> Proposed by {open.proposed_by_name ?? "a colleague"} on {day(open.proposed_at)}: {open.reason}</p>
            {open.proposed_by === meId ? (
              <ActionForm action={withdrawRules} hidden={{ ...hidden, id: open.id }} submit="Withdraw to edit again" variant="secondary" inline />
            ) : canApprove ? (
              <div className="flex flex-wrap items-start gap-4">
                <ActionForm action={decideRules} hidden={{ ...hidden, id: open.id, decision: "approve" }} submit="Approve" inline><input name="note" aria-label="Approval note" placeholder="Note (optional)" className="input min-w-[220px] py-1.5" /></ActionForm>
                <ActionForm action={decideRules} hidden={{ ...hidden, id: open.id, decision: "reject" }} submit="Send back" variant="secondary" inline><input name="note" required aria-label="Reason" placeholder="Reason (needed)" className="input min-w-[220px] py-1.5" /></ActionForm>
              </div>
            ) : <p className="text-muted">Waiting for a CRM owner to approve it.</p>}
          </div>
        )}
        {open?.status === "draft" && (
          <div className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
            <p><b>Draft version {open.version}.</b> Your edits are kept here and do not apply until someone else approves them.{open.decision_note ? ` Last sent back: ${open.decision_note}` : ""}</p>
            <div className="flex flex-wrap items-end gap-4">
              <ActionForm action={proposeRules} hidden={hidden} submit="Send for approval" inline>
                <input name="note" required aria-label="What changed and why" placeholder="What changed and why" className="input min-w-[320px] py-1.5" />
              </ActionForm>
              <ActionForm action={discardRuleDraft} hidden={hidden} submit="Discard draft" variant="secondary" inline confirm="Discard this draft?" />
            </div>
          </div>
        )}
        {!open && !doc && (
          <div className="flex flex-wrap gap-3">
            <ActionForm action={startRuleDraft} hidden={{ ...hidden, from: "example" }} submit="Start from the example set" inline />
            <ActionForm action={startRuleDraft} hidden={{ ...hidden, from: "empty" }} submit="Start empty" variant="secondary" inline />
          </div>
        )}
      </Card>

      {doc && editable && (
        <>
          <Panel title={`Check rules (${doc.rules.length})`} sub="Each rule looks at one thing on every line and sets Need to confirm, Hold or Issue with a comment. Rules can be limited to a region or a period.">
            {doc.rules.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No rules yet. Add the first one below.</p> : (
              <ul className="divide-y divide-line text-sm">
                {doc.rules.map((r) => (
                  <li key={r.id} className="space-y-2 px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className={r.enabled === false ? "text-muted line-through" : ""}>{r.name}</b><Pill tone={OUTCOME[r.outcome][1]}>{OUTCOME[r.outcome][0]}</Pill>
                      <span className="text-xs text-muted">{scopeText(r)}</span>
                      <span className="ml-auto flex gap-2">
                        <ActionForm action={toggleRule} hidden={{ ...hidden, rule: r.id }} submit={r.enabled === false ? "Turn on" : "Turn off"} variant="secondary" inline />
                        <ActionForm action={removeRule} hidden={{ ...hidden, rule: r.id }} submit="Remove" variant="secondary" inline confirm="Remove this rule?" />
                      </span>
                    </div>
                    <p className="text-muted">{r.comment}</p>
                    <details className="text-xs"><summary className="cursor-pointer font-semibold text-accent">Edit the wording</summary>
                      <ActionForm action={editRuleText} hidden={{ ...hidden, rule: r.id }} submit="Save wording" variant="secondary" className="mt-2 space-y-2">
                        <div className="grid gap-2 md:grid-cols-3">
                          <input name="name" defaultValue={r.name} aria-label="Name" className="input md:col-span-2" />
                          <select name="outcome" defaultValue={r.outcome} aria-label="Outcome" className="input"><option value="issue">Issue</option><option value="confirm">Need to confirm</option><option value="hold">Hold</option></select>
                        </div>
                        <textarea name="comment" defaultValue={r.comment} rows={2} aria-label="Comment" className="input" />
                        <p className="text-muted">Use {"{savings_pct}"}, {"{fee_pct}"}, {"{match_type}"} and other field names in braces to put the line&apos;s own value in the comment.</p>
                      </ActionForm>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line p-5"><h3 className="mb-3 font-display text-base font-semibold">Add a check</h3><RuleTemplateForm clientId={clientId} tableKeys={tableKeys} /></div>
          </Panel>

          <Disclosure summary={`File columns (${Object.keys(doc.column_map).length} of ${FIELDS.length} mapped)`}>
            <p className="mb-3 text-sm text-muted">Type the exact heading each of this client&apos;s columns has in their savings file. Leave a field empty if the file does not have it: rules that need it are skipped and reported.</p>
            <ActionForm action={saveColumnMap} hidden={hidden} submit="Save the column map" variant="secondary">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((f) => <Field key={f.key} label={f.label} htmlFor={`col_${f.key}`}><input id={`col_${f.key}`} name={`col_${f.key}`} defaultValue={doc.column_map[f.key] ?? ""} className="input" /></Field>)}
              </div>
              <Field label="The client's own extra fields" hint="One per line: field name = column heading. Rules can use them like any other field." htmlFor="extra">
                <textarea id="extra" name="extra_columns" rows={2} className="input" defaultValue={Object.entries(doc.column_map).filter(([k]) => !FIELDS.some((f) => f.key === k)).map(([k, v]) => `${k} = ${v}`).join("\n")} />
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="percent_as_fraction" defaultChecked={doc.percent_as_fraction} /> Percentages are stored as fractions in this client&apos;s file (0.35 means 35%)</label>
            </ActionForm>
          </Disclosure>

          <Disclosure summary={`Regions and lists (${doc.regions?.length ?? 0} regions, ${Object.keys(doc.lists ?? {}).length} lists)`}>
            <ActionForm action={saveRegionsAndLists} hidden={hidden} submit="Save" variant="secondary">
              <Field label="This client's regions" hint="One per line. Rules can be limited to a region." htmlFor="regions"><textarea id="regions" name="regions" rows={2} className="input" defaultValue={(doc.regions ?? []).join("\n")} /></Field>
              <Field label="Lists" hint="One per line: list name: item, item. For example an exception list of job references." htmlFor="lists">
                <textarea id="lists" name="lists" rows={3} className="input" defaultValue={Object.entries(doc.lists ?? {}).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n")} />
              </Field>
            </ActionForm>
          </Disclosure>

          <Disclosure summary="Savings method">
            <p className="mb-3 text-sm text-muted">How this client counts each kind of saving. It is the reference the rules are written from.</p>
            <ActionForm action={saveMethod} hidden={hidden} submit="Save the method" variant="secondary">
              <Field label="Kinds of saving" hint="One per line: name | counts in total savings (yes/no) | spend is addressable (yes/no) | minimum quotes | quote band %" htmlFor="types">
                <textarea id="types" name="savings_types" rows={5} className="input font-mono text-xs"
                  defaultValue={(method.savings_types ?? []).map((t) => [t.label, t.counts_in_total ? "yes" : "no", t.addressable ? "yes" : "no", t.min_quotes ?? "", t.band_pct ?? ""].join(" | ").replace(/( \| )+$/, "")).join("\n")} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Standard fee %" htmlFor="sf"><input id="sf" name="standard_pct" type="number" step="any" defaultValue={asText(method.fee_model?.standard_pct)} className="input" /></Field>
                <Field label="Premium fee %" htmlFor="pf"><input id="pf" name="premium_pct" type="number" step="any" defaultValue={asText(method.fee_model?.premium_pct)} className="input" /></Field>
                <Field label="Savings % needing justification" htmlFor="rv"><input id="rv" name="review_pct" type="number" step="any" defaultValue={asText(method.thresholds?.savings_review_pct)} className="input" /></Field>
                <Field label="Savings % that is an issue" htmlFor="hd"><input id="hd" name="hard_pct" type="number" step="any" defaultValue={asText(method.thresholds?.savings_hard_pct)} className="input" /></Field>
              </div>
            </ActionForm>
          </Disclosure>
        </>
      )}

      <ClientTables clientId={clientId} meId={meId} canApprove={canApprove} />

      {versions.length > 0 && (
        <Panel title="Versions">
          <ul className="divide-y divide-line text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <b>Version {v.version}</b><Pill tone={v.status === "published" ? "ok" : v.status === "pending" ? "warn" : "neutral"}>{v.status === "published" ? "Live" : v.status === "pending" ? "Waiting for approval" : v.status === "draft" ? "Draft" : "Replaced"}</Pill>
                <span>{v.doc.rules?.length ?? 0} rules</span><span className="text-muted">{v.reason}</span>
                <span className="ml-auto text-xs text-muted">{v.published_at ? `Live ${day(v.published_at)}` : `Started ${day(v.created_at)}`}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
