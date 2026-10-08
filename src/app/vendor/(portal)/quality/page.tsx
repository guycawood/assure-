import { requireVendorCompany, rows, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionButton, ActionDialog } from "@/components/vendor/action-form";
import { markCorrectiveDone, respondNcr } from "../actions";

export const metadata = { title: "Quality & NCRs" };

type Inspection = { id: string; inspection_ref: string; po_reference: string | null; product_name: string | null; inspection_type: string; inspection_date: string;
  sample_size: number | null; defect_count: number; defects_found: string[]; aql_level: string | null; result: string; corrective_action_required: boolean; corrective_action_notes: string | null };
type Ncr = { id: string; ncr_ref: string; category_name: string; severity: string; title: string; description: string | null; po_reference: string | null; status: string;
  acknowledgement_status: string; supplier_response: string | null; root_cause: string | null; due_date: string | null; close_note: string | null; created_at: string };
type Ca = { id: string; ncr_id: string; description: string; owner_side: string; due_date: string | null; status: string; done_note: string | null };

function ResponseFields({ id }: { id: string }) {
  return (
    <div className="grid gap-3">
      <div><label className="label" htmlFor={`rc-${id}`}>Root cause</label><textarea id={`rc-${id}`} name="root_cause" rows={3} maxLength={4000} className="input" placeholder="What caused it?" /></div>
      <div><label className="label" htmlFor={`rs-${id}`}>Your response</label><textarea id={`rs-${id}`} name="response" required rows={4} maxLength={4000} className="input" placeholder="What you have done and will do to stop it happening again" /></div>
    </div>
  );
}

export default async function QualityPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const [inspections, ncrs, cas] = await Promise.all([
    rows<Inspection>(supabase.from("vendor_quality_inspections").select("*").order("inspection_date", { ascending: false })),
    rows<Ncr>(supabase.from("vendor_ncrs").select("*").order("created_at", { ascending: false })),
    rows<Ca>(supabase.from("ncr_corrective_actions").select("id, ncr_id, description, owner_side, due_date, status, done_note").order("created_at")),
  ]);
  const act = canAct(ctx.permission);

  return (
    <>
      <PageHead title="Quality & NCRs" sub="Inspection results for your orders and any non-conformance reports (NCRs). Acknowledge an NCR, then send your root cause and response, or dispute it. Mark your corrective actions done; adm Indicia verifies and closes them." />

      <Panel title="Non-conformance reports" sub={`${ncrs.filter((n) => n.status === "open").length} open`}>
        {ncrs.length === 0 ? <Empty title="No NCRs">Nothing has been raised against your orders.</Empty> : (
          <ul className="divide-y divide-line">
            {ncrs.map((n) => {
              const actions = cas.filter((a) => a.ncr_id === n.id);
              return (
                <li key={n.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{n.ncr_ref}: {n.title}</p>
                      <p className="text-xs text-muted">{n.category_name}{n.po_reference ? ` · ${n.po_reference}` : ""} · raised {formatDate(n.created_at)}{n.due_date ? ` · respond by ${formatDate(n.due_date)}` : ""}</p>
                    </div>
                    <Pill tone={statusTone(n.severity)}>{human(n.severity)}</Pill>
                    <Pill tone={statusTone(n.status === "open" ? n.acknowledgement_status : n.status)}>{n.status === "open" ? human(n.acknowledgement_status) : human(n.status)}</Pill>
                  </div>
                  {n.description && <p className="text-sm">{n.description}</p>}
                  {(n.root_cause || n.supplier_response) && (
                    <div className="rounded-lg bg-surface-2 p-3 text-sm">
                      {n.root_cause && <p><b>Root cause:</b> {n.root_cause}</p>}
                      {n.supplier_response && <p><b>Your response:</b> {n.supplier_response}</p>}
                    </div>
                  )}
                  {n.close_note && <p className="text-xs text-muted">Closed: {n.close_note}</p>}
                  {actions.length > 0 && (
                    <div className="rounded-lg border border-line">
                      <p className="border-b border-line px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted">Corrective actions</p>
                      <ul className="divide-y divide-line">
                        {actions.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                            <span className="min-w-0 flex-1">{a.description}<span className="block text-xs text-muted">{a.owner_side === "supplier" ? "Your action" : "adm Indicia's action"}{a.due_date ? ` · due ${formatDate(a.due_date)}` : ""}{a.done_note ? ` · ${a.done_note}` : ""}</span></span>
                            <Pill tone={statusTone(a.status)}>{human(a.status)}</Pill>
                            {act && a.status === "open" && a.owner_side === "supplier" && n.status === "open" && (
                              <ActionDialog label="Mark done" title="Mark corrective action done" sub={a.description} action={markCorrectiveDone} hidden={{ id: a.id }} submit="Mark done">
                                <label className="label" htmlFor={`cn-${a.id}`}>What did you do? (optional)</label>
                                <textarea id={`cn-${a.id}`} name="note" rows={3} maxLength={2000} className="input" />
                              </ActionDialog>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {act && n.status === "open" && (
                    <div className="flex flex-wrap gap-2">
                      {n.acknowledgement_status === "pending" && <ActionButton action={respondNcr} label="Acknowledge" hidden={{ id: n.id, action: "acknowledge" }} />}
                      <ActionDialog label={n.supplier_response ? "Update response" : "Respond"} variant="primary" title={`Respond to ${n.ncr_ref}`} wide action={respondNcr} hidden={{ id: n.id, action: "respond" }} submit="Send response">
                        <ResponseFields id={n.id} />
                      </ActionDialog>
                      {n.acknowledgement_status !== "disputed" && (
                        <ActionDialog label="Dispute" variant="danger" title={`Dispute ${n.ncr_ref}`} sub="Explain why you think this NCR is wrong." action={respondNcr} hidden={{ id: n.id, action: "dispute" }} submit="Send dispute">
                          <label className="label" htmlFor={`dp-${n.id}`}>Your reasons</label>
                          <textarea id={`dp-${n.id}`} name="response" required rows={4} maxLength={4000} className="input" />
                        </ActionDialog>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Card className="overflow-x-auto">
        <p className="border-b border-line px-5 py-3 font-display text-[0.95rem] font-bold">Inspections</p>
        {inspections.length === 0 ? <Empty title="No inspections yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Inspection</th><th className="th">Product / PO</th><th className="th">Date</th><th className="th text-right">Sample</th><th className="th text-right">Defects</th><th className="th">Result</th></tr></thead>
            <tbody>
              {inspections.map((q) => (
                <tr key={q.id}>
                  <td className="td font-semibold">{q.inspection_ref}<span className="block text-xs font-normal text-muted">{human(q.inspection_type)}{q.aql_level ? ` · AQL ${q.aql_level}` : ""}</span></td>
                  <td className="td">{q.product_name ?? "—"}<span className="block text-xs text-muted">{q.po_reference}</span></td>
                  <td className="td">{formatDate(q.inspection_date)}</td>
                  <td className="td text-right tabular-nums">{q.sample_size ?? "—"}</td>
                  <td className="td text-right tabular-nums">{q.defect_count}{q.defects_found.length > 0 && <span className="block text-xs text-muted">{q.defects_found.join(", ")}</span>}</td>
                  <td className="td"><Pill tone={statusTone(q.result)}>{human(q.result)}</Pill>{q.corrective_action_required && <span className="block text-xs text-warn">Corrective action needed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
