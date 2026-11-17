"use client";

import { useActionState } from "react";
import { Card, Pill, Stat } from "@/components/ui";
import { runSavingsCheck, type CheckState } from "@/app/(platform)/crm/clients/check-actions";

const TONE = { issue: "bad", hold: "info", confirm: "warn" } as const;
const LABEL = { issue: "Issue", hold: "Hold", confirm: "Need to confirm" } as const;

/** Upload a client's savings file, see what the live rules found, and download the same file with the two result columns added. */
export function CheckRunner({ clientId, rules }: { clientId: string; rules: { id: string; name: string }[] }) {
  const [state, run, pending] = useActionState<CheckState, FormData>(runSavingsCheck, {});
  const r = state.result;
  const download = () => {
    if (!r) return;
    const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = r.download_name; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form action={run} className="space-y-3">
          <input type="hidden" name="client_id" value={clientId} />
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="file">Savings file (Excel or CSV)</label>
              <input id="file" name="file" type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className="input" />
              <p className="mt-1 text-xs text-muted">The first filled row is the column headings. The file is read here and not kept; only the summary of the run is.</p>
              <label className="label mt-3" htmlFor="sheet">Sheet (Excel only, optional)</label>
              <input id="sheet" name="sheet" className="input" placeholder="Leave empty to use the sheet with the most rows" />

            </div>
            <div>
              <label className="label" htmlFor="only">Run only these rules (optional)</label>
              <select id="only" name="only" multiple size={Math.min(6, Math.max(3, rules.length))} className="input">
                {rules.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted">Leave empty to run every rule. Hold Ctrl or Cmd to pick several.</p>
            </div>
          </div>
          <button type="submit" disabled={pending} className="btn-primary">{pending ? "Checking…" : "Check the file"}</button>
          {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
        </form>
      </Card>

      {r && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Lines checked" value={r.rows.toLocaleString("en-GB")} hint={`${r.file_name}${r.sheet ? `, sheet ${r.sheet}` : ""} · rules version ${r.version}`} />
            <Stat label="Pass" value={r.summary.pass.toLocaleString("en-GB")} tone="ok" />
            <Stat label="Issue" value={r.summary.issue.toLocaleString("en-GB")} tone={r.summary.issue ? "bad" : undefined} />
            <Stat label="Need to confirm" value={r.summary.confirm.toLocaleString("en-GB")} tone={r.summary.confirm ? "warn" : undefined} />
            <Stat label="Hold" value={r.summary.hold.toLocaleString("en-GB")} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={download} className="btn-primary">Download the checked file</button>
            <span className="text-sm text-muted">The same file with two columns added: Check approval and Check comments. Nothing else is changed.{r.saved ? "" : " This run was not recorded."}</span>
          </div>

          {r.summary.tables_used && Object.keys(r.summary.tables_used).length > 0 && (<p className="text-sm text-muted">Tables read: {Object.entries(r.summary.tables_used).map(([k, v]) => `${k}${v ? ` (version ${v})` : ""}`).join(", ")}.</p>)}

          {r.summary.skipped_rules.length > 0 && (
            <Card className="space-y-1 bg-warn-soft p-4 text-sm">
              <p className="font-semibold">{r.summary.skipped_rules.length} rule{r.summary.skipped_rules.length === 1 ? "" : "s"} could not run on this file</p>
              <ul className="list-disc pl-5">{r.summary.skipped_rules.map((s) => <li key={s.id}><b>{r.summary.by_rule[s.id]?.name ?? s.id}</b>: {s.reason}</li>)}</ul>
              <p className="text-muted">Check the client&apos;s column map in Method &amp; rules matches the headings in this file.</p>
            </Card>
          )}

          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Rule</th><th className="th">Result if it fires</th><th className="th">Lines it applied to</th><th className="th">Lines flagged</th></tr></thead>
              <tbody>
                {Object.entries(r.summary.by_rule).map(([id, b]) => (
                  <tr key={id}><td className="td font-semibold">{b.name}</td><td className="td"><Pill tone={TONE[b.outcome]}>{LABEL[b.outcome]}</Pill></td><td className="td tabular-nums">{b.in_scope.toLocaleString("en-GB")}</td><td className="td tabular-nums">{b.fired ? <b>{b.fired.toLocaleString("en-GB")}</b> : 0}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="overflow-x-auto">
            <div className="border-b border-line px-5 py-3 text-sm font-semibold">Flagged lines{r.flagged_total > r.flagged.length ? ` (the first ${r.flagged.length} of ${r.flagged_total.toLocaleString("en-GB")}; the download has all of them)` : ` (${r.flagged_total})`}</div>
            {r.flagged.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Every line passed.</p> : (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Row</th><th className="th">Line</th><th className="th">Result</th><th className="th">Comment</th></tr></thead>
                <tbody>
                  {r.flagged.map((f) => (
                    <tr key={f.index} className="align-top"><td className="td tabular-nums">{f.index}</td><td className="td">{f.label}</td><td className="td"><Pill tone={TONE[f.approval as keyof typeof TONE]}>{LABEL[f.approval as keyof typeof LABEL]}</Pill></td><td className="td">{f.comment}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
