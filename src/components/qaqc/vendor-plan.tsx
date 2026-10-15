import { Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { canSubmit, checkpointStatus, levelLabel, planStatus, VERIFIER_LABEL, type QaqcPlan } from "@/lib/qaqc";
import { CheckList, evidenceFacts } from "@/components/qaqc/bits";
import { VendorCheckpointForm } from "@/components/qaqc/vendor-checkpoint-form";

type Body = { code: string; name: string; body_type: string | null };
const d = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");

/** Vendor view of the QA/QC plans on a PO: the level and why (in plain words), the checklist per checkpoint and the upload. */
export function VendorQaqcPlans({ plans, bodies, canAct, accepted }: { plans: QaqcPlan[]; bodies: Body[]; canAct: boolean; accepted: boolean }) {
  return (
    <div className="divide-y divide-line">
      {plans.map((p) => (
        <section key={p.id} className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft font-display text-sm font-bold text-accent">{levelLabel(p.required_level)}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{p.level_name ?? levelLabel(p.required_level)} · {p.spec_title ?? "Whole order"}</p>
              <p className="text-xs text-muted">{p.level_description} {VERIFIER_LABEL[p.verifier ?? "auto"] ?? ""}.</p>
            </div>
            <Pill tone={planStatus(p.status).tone}>{planStatus(p.status).label}</Pill>
          </div>
          {p.reasons.length > 0 && (
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              <p className="font-semibold">Why this level</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          <ol className="space-y-3">
            {p.checkpoints.map((c) => {
              const cs = checkpointStatus(c.status);
              const open = canSubmit(c) && !["passed", "waived"].includes(p.status);
              return (
                <li key={c.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <MSymbol name={["verified", "auto_verified"].includes(c.status) ? "check_circle" : c.status === "rejected" ? "cancel" : "pending"} size={18} fill
                      className={["verified", "auto_verified"].includes(c.status) ? "text-ok" : c.status === "rejected" ? "text-bad" : "text-warn"} />
                    <span className="flex-1 text-sm font-bold">{c.label}</span>
                    <span className="text-xs text-muted">Due {d(c.due_date)}</span>
                    <Pill tone={cs.tone}>{cs.label}</Pill>
                  </div>
                  <p className="mt-1 text-xs text-muted">Upload: {c.required.map((r) => r.names).join("; ")}{c.aql ? ` · sampled at ${c.aql.name}` : ""}{c.approved_body_required ? " · from an approved lab or inspection body" : ""}</p>
                  {c.evidence.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {c.evidence.map((e) => (
                        <li key={e.id}>{e.file_id ? <a className="font-semibold text-accent hover:underline" href={`/api/files/${e.file_id}`} target="_blank" rel="noreferrer">{e.file_name ?? e.type}</a> : e.type}
                          <span className="text-muted">{evidenceFacts(e) ? ` · ${evidenceFacts(e)}` : ""}</span></li>
                      ))}
                    </ul>
                  )}
                  {c.checks.length > 0 && <div className="mt-2"><CheckList checks={c.checks} /></div>}
                  {c.rejection_reason && <p className="mt-2 rounded bg-bad-soft px-2 py-1 text-xs text-bad">Rejected by adm Indicia: {c.rejection_reason}. Upload corrected evidence.</p>}
                  {open && canAct && accepted && (
                    <details className="mt-3" open={c.status === "required" || c.status === "rejected"}>
                      <summary className="cursor-pointer text-sm font-semibold text-accent">{c.submission_count > 0 ? "Upload again" : "Upload evidence and mark done"}</summary>
                      <div className="mt-2"><VendorCheckpointForm checkpoint={c} bodies={bodies} /></div>
                    </details>
                  )}
                  {open && !accepted && <p className="mt-2 text-xs text-muted">Accept the purchase order to upload QA/QC evidence.</p>}
                  {open && accepted && !canAct && <p className="mt-2 text-xs text-muted">Your account is view-only.</p>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
