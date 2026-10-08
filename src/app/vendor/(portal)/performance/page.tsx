import { requireVendorCompany, rows, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { ActionButton, ActionDialog } from "@/components/vendor/action-form";
import { respondIssue } from "../actions";

export const metadata = { title: "Performance & issues" };

type Rec = { id: string; period: string; cost_score: number | null; otif_score: number | null; quality_score: number | null; compliance_score: number | null;
  sustainability_score: number | null; composite_score: number | null; ncr_count: number; defect_rate: number | null };
type Issue = { id: string; issue_type: string; title: string; period: string | null; severity: string; acknowledgement_status: string; supplier_response: string | null;
  corrective_action: string | null; target_resolution_date: string | null; resolved_at: string | null; created_at: string };

const score = (n: number | null) => (n === null || n === undefined ? "—" : Number(n).toFixed(0));
const scoreTone = (n: number | null) => (n === null ? undefined : n >= 80 ? "ok" as const : n >= 60 ? "warn" as const : "bad" as const);

export default async function PerformancePage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const [recs, issues] = await Promise.all([
    rows<Rec>(supabase.from("vendor_performance_records").select("*").order("period", { ascending: false })),
    rows<Issue>(supabase.from("vendor_performance_issues").select("*").order("created_at", { ascending: false })),
  ]);
  const latest = recs[0];
  const act = canAct(ctx.permission);

  return (
    <>
      <PageHead title="Performance & issues" sub="Your scores each quarter (the composite is the plain average of the scores with data) and any issues raised from them. Acknowledge an issue and tell adm Indicia what you are doing about it." />
      {latest ? (
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label={`Composite ${latest.period}`} value={score(latest.composite_score)} tone={scoreTone(latest.composite_score)} />
          <Stat label="Cost" value={score(latest.cost_score)} tone={scoreTone(latest.cost_score)} />
          <Stat label="On time in full" value={score(latest.otif_score)} tone={scoreTone(latest.otif_score)} />
          <Stat label="Quality" value={score(latest.quality_score)} tone={scoreTone(latest.quality_score)} />
          <Stat label="Compliance" value={score(latest.compliance_score)} tone={scoreTone(latest.compliance_score)} />
          <Stat label="Sustainability" value={score(latest.sustainability_score)} tone={scoreTone(latest.sustainability_score)} />
        </div>
      ) : <Card><Empty title="No scores yet">adm Indicia records scores each quarter.</Empty></Card>}

      <Panel title="Issues" sub={`${issues.filter((i) => i.acknowledgement_status !== "resolved").length} open`}>
        {issues.length === 0 ? <Empty title="No issues">Nothing has been flagged.</Empty> : (
          <ul className="divide-y divide-line">
            {issues.map((i) => (
              <li key={i.id} className="space-y-2 px-5 py-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1"><p className="font-semibold">{i.title}</p><p className="text-xs text-muted">{human(i.issue_type)}{i.period ? ` · ${i.period}` : ""} · raised {formatDate(i.created_at)}</p></div>
                  <Pill tone={statusTone(i.severity)}>{human(i.severity)}</Pill>
                  <Pill tone={statusTone(i.acknowledgement_status)}>{human(i.acknowledgement_status)}</Pill>
                </div>
                {(i.supplier_response || i.corrective_action) && (
                  <div className="rounded-lg bg-surface-2 p-3 text-sm">
                    {i.supplier_response && <p><b>Your response:</b> {i.supplier_response}</p>}
                    {i.corrective_action && <p><b>Corrective action:</b> {i.corrective_action}{i.target_resolution_date ? ` (target ${formatDate(i.target_resolution_date)})` : ""}</p>}
                  </div>
                )}
                {act && i.acknowledgement_status !== "resolved" && (
                  <div className="flex flex-wrap gap-2">
                    {i.acknowledgement_status === "pending" && <ActionButton action={respondIssue} label="Acknowledge" hidden={{ id: i.id, action: "acknowledge" }} />}
                    <ActionDialog label="Respond" variant="primary" title="Respond to this issue" sub={i.title} wide action={respondIssue} hidden={{ id: i.id, action: "respond" }} submit="Send response">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2"><label className="label" htmlFor={`r-${i.id}`}>Response</label><textarea id={`r-${i.id}`} name="response" required rows={3} maxLength={4000} className="input" /></div>
                        <div className="sm:col-span-2"><label className="label" htmlFor={`c-${i.id}`}>Corrective action</label><textarea id={`c-${i.id}`} name="corrective" rows={3} maxLength={4000} className="input" /></div>
                        <div><label className="label" htmlFor={`t-${i.id}`}>Target date</label><input id={`t-${i.id}`} name="target" type="date" className="input" /></div>
                      </div>
                    </ActionDialog>
                    {i.acknowledgement_status !== "disputed" && (
                      <ActionDialog label="Dispute" variant="danger" title="Dispute this issue" sub={i.title} action={respondIssue} hidden={{ id: i.id, action: "dispute" }} submit="Send dispute">
                        <label className="label" htmlFor={`d-${i.id}`}>Why do you disagree?</label>
                        <textarea id={`d-${i.id}`} name="response" required rows={4} maxLength={4000} className="input" />
                      </ActionDialog>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {recs.length > 0 && (
        <Card className="overflow-x-auto">
          <p className="border-b border-line px-5 py-3 font-display text-[0.95rem] font-bold">Score history</p>
          <table className="w-full text-sm">
            <thead><tr>{["Period", "Composite", "Cost", "OTIF", "Quality", "Compliance", "Sustainability", "NCRs", "Defect rate"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.id}>
                  <td className="td font-semibold">{r.period}</td>
                  <td className="td tabular-nums font-bold">{score(r.composite_score)}</td>
                  <td className="td tabular-nums">{score(r.cost_score)}</td><td className="td tabular-nums">{score(r.otif_score)}</td><td className="td tabular-nums">{score(r.quality_score)}</td>
                  <td className="td tabular-nums">{score(r.compliance_score)}</td><td className="td tabular-nums">{score(r.sustainability_score)}</td>
                  <td className="td tabular-nums">{r.ncr_count}</td><td className="td tabular-nums">{r.defect_rate === null ? "—" : `${r.defect_rate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
