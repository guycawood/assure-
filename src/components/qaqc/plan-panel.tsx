import { clsx } from "clsx";
import { Pill } from "@/components/ui";
import { CheckList, evidenceFacts } from "@/components/qaqc/bits";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { checkpointStatus, levelLabel, planStatus, VERIFIER_LABEL, type QaqcPlan } from "@/lib/qaqc";
import { requestWaiver, reviewCheckpoint, setLevel } from "@/app/(platform)/orders/qaqc/actions";

const d = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");

/** Internal view of the QA/QC plans on a PO or job: level and why, checkpoints, evidence, checks, and the decisions. */
export function QaqcPlans({ plans, reviewable, poId, canManage = true }: { plans: QaqcPlan[]; reviewable: Set<string>; poId?: string; canManage?: boolean }) {
  return (
    <div className="divide-y divide-line">
      {plans.map((p) => {
        const st = planStatus(p.status);
        const open = !["passed", "waived"].includes(p.status);
        return (
          <section key={p.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft font-display text-sm font-bold text-accent">{levelLabel(p.required_level)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{p.level_name ?? levelLabel(p.required_level)} · {p.spec_title ?? "Whole order"}{p.quantity ? ` · ${p.quantity.toLocaleString("en-GB")} units` : ""}</p>
                <p className="text-xs text-muted">{p.plan_ref} · {VERIFIER_LABEL[p.verifier ?? "auto"] ?? ""}{p.required_level !== p.computed_level ? ` · rules ask for ${levelLabel(p.computed_level)}` : ""}</p>
              </div>
              <Pill tone={st.tone}>{st.label}</Pill>
            </div>
            {p.level_description && <p className="text-sm text-muted">{p.level_description}</p>}
            <details className="rounded-lg border border-line px-3 py-2 text-sm">
              <summary className="cursor-pointer font-semibold">Why {levelLabel(p.computed_level)}? ({p.rules?.length ?? 0} rule{p.rules?.length === 1 ? "" : "s"} fired)</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {(p.rules ?? []).map((r) => <li key={r.code}><b className="text-fg">{r.name}</b>{r.effect === "bump" ? ` (+${r.bump})` : r.level ? ` (L${r.level})` : ""}: {r.explanation}</li>)}
                {!p.rules?.length && <li>No rule fired, so the lowest level applies.</li>}
              </ul>
              {p.level_reason && <p className="mt-2 text-xs">Level changed: {p.level_reason}</p>}
            </details>
            <ol className="space-y-2">
              {p.checkpoints.map((c) => {
                const cs = checkpointStatus(c.status);
                return (
                  <li key={c.id} className={clsx("rounded-lg border p-3", c.failed && !["verified"].includes(c.status) ? "border-bad/40 bg-bad-soft/30" : "border-line")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 text-sm font-bold">{c.label}</span>
                      <span className="text-xs text-muted">Due {d(c.due_date)}</span>
                      <Pill tone={cs.tone}>{cs.label}</Pill>
                    </div>
                    <p className="mt-1 text-xs text-muted">Needs: {c.required.map((r) => r.names).join("; ") || "nothing"}{c.min_photos ? ` · at least ${c.min_photos} photos` : ""}
                      {c.aql ? ` · ${c.aql.name}` : ""}{c.approved_body_required ? " · approved body" : ""}</p>
                    {c.evidence.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {c.evidence.map((e) => (
                          <li key={e.id}>
                            {e.file_id ? <a className="font-semibold text-accent hover:underline" href={`/api/files/${e.file_id}`} target="_blank" rel="noreferrer">{e.file_name ?? e.type}</a> : <b>{e.type}</b>}
                            <span className="text-muted"> · {e.type.replace(/_/g, " ").toLowerCase()}{evidenceFacts(e) ? ` · ${evidenceFacts(e)}` : ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {c.checks.length > 0 && <div className="mt-2"><CheckList checks={c.checks} /></div>}
                    {c.rejection_reason && <p className="mt-1 text-xs text-bad">Rejected: {c.rejection_reason}</p>}
                    {c.review_note && <p className="mt-1 text-xs text-muted">Reviewer: {c.review_note}</p>}
                    {c.ncr_id && <a className="mt-1 inline-block text-xs font-semibold text-bad hover:underline" href={`/assure/quality/ncr/${c.ncr_id}`}>NCR raised in SRM quality</a>}
                    {reviewable.has(c.id) && (
                      <div className="mt-3 grid gap-2 border-t border-line pt-3 md:grid-cols-2">
                        {c.status === "needs_review" && (
                          <ActionForm action={reviewCheckpoint} hidden={{ id: c.id, po: poId, decision: "verify" }} submit="Verify">
                            <Field label={c.failed ? "Concession note (a check failed)" : "Note (optional)"} htmlFor={`vn-${c.id}`}>
                              <input id={`vn-${c.id}`} name="note" className="input" required={c.failed} />
                            </Field>
                          </ActionForm>
                        )}
                        <ActionForm action={reviewCheckpoint} hidden={{ id: c.id, po: poId, decision: "reject" }} submit="Reject" variant="danger">
                          <Field label="What is wrong" htmlFor={`rn-${c.id}`}><input id={`rn-${c.id}`} name="note" className="input" required /></Field>
                        </ActionForm>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {canManage && open && (
              <div className="grid gap-3 md:grid-cols-2">
                <details className="rounded-lg border border-line p-3 text-sm">
                  <summary className="cursor-pointer font-semibold">Change level</summary>
                  <div className="mt-3">
                    <ActionForm action={setLevel} hidden={{ id: p.id, po: poId }} submit="Set level">
                      <Field label="Level" htmlFor={`lv-${p.id}`} hint={`The rules ask for ${levelLabel(p.computed_level)}. Lower than that goes to a quality role for approval.`}>
                        <select id={`lv-${p.id}`} name="level" className="input" defaultValue={p.required_level}>
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>L{n}</option>)}
                        </select>
                      </Field>
                      <Field label="Reason" htmlFor={`lr-${p.id}`}><input id={`lr-${p.id}`} name="reason" className="input" required /></Field>
                    </ActionForm>
                  </div>
                </details>
                <details className="rounded-lg border border-line p-3 text-sm">
                  <summary className="cursor-pointer font-semibold">Ask for a waiver</summary>
                  <div className="mt-3">
                    <ActionForm action={requestWaiver} hidden={{ id: p.id, po: poId }} submit="Request waiver" variant="secondary">
                      <Field label="Reason (e.g. client concession)" htmlFor={`wr-${p.id}`}><input id={`wr-${p.id}`} name="reason" className="input" required /></Field>
                    </ActionForm>
                  </div>
                </details>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
