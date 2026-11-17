"use client";

import { useActionState } from "react";
import { MSymbol } from "@/components/symbol";
import { Pill, btn } from "@/components/ui";
import { ImpactGradeBadge } from "./grade-badge";
import { calculateAllGrades, calculateSpecGrade, reviewGrade, saveGradeInputs, type GradeActionResult } from "@/app/(platform)/impact-grade/grade-actions";
import { confidenceLevel } from "@/lib/impact-grade-confidence";
import { IG_TIERS, TIER_LABEL, type IgTier } from "@/lib/impact-grade";
import { OVERRIDE_FIELDS, type Overrides } from "@/lib/impact-grade-fields";

// One Impact Grade record, as it appears on a spec and expanded under a job: the grade, how far to trust it,
// every sub-score with the evidence tier behind it, what is missing, and the controls to edit an input or review.

export type RecordView = {
  id: string; score: number | null; letter: string | null; coverage: number | null; confidence: number | null; rangeLow: number | null; rangeHigh: number | null;
  stage: string; reviewStatus: "unreviewed" | "reviewed" | "disputed"; reviewNote: string | null; updatedAt: string;
  subScores: { code: string; name: string; category: string; weight: number | null; score: number | null; why: string; status: string }[];
  tiers: Record<string, IgTier>; warnings: string[]; overrides: Overrides; supplierName: string | null; supplierScore: number | null; pefMpt: number | null;
};

const TIER_TONE = { assumed: "neutral", estimated: "warn", declared: "info", measured: "accent", verified: "ok" } as const;
const REVIEW_TONE = { unreviewed: "warn", reviewed: "ok", disputed: "bad" } as const;
const STAGE_LABEL: Record<string, string> = { ideation: "Ideation", spec: "Spec", sourcing: "Sourcing", order: "Order", logistics: "Logistics", execution: "Execution" };

function Msg({ s }: { s: GradeActionResult }) {
  if (s.error) return <p role="alert" className="text-sm text-bad">{s.error}</p>;
  if (s.message) return <p className="text-sm text-ok">{s.message}</p>;
  return null;
}

export function CalculateButton({ specId, label }: { specId: string; label?: string }) {
  const [s, run, pending] = useActionState<GradeActionResult, FormData>(calculateSpecGrade, {});
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="spec_id" value={specId} />
      <button className={btn.primary} disabled={pending}><MSymbol name="calculate" size={17} /> {pending ? "Calculating…" : label ?? "Calculate Impact Grade"}</button>
      <Msg s={s} />
    </form>
  );
}

export function GradeRecordPanel({ specId, record, options, hideConfidence }: { specId: string; record: RecordView | null; options: Record<string, string[]>; hideConfidence?: boolean }) {
  const [editState, edit, editing] = useActionState<GradeActionResult, FormData>(saveGradeInputs, {});
  const [revState, review, reviewing] = useActionState<GradeActionResult, FormData>(reviewGrade, {});

  if (!record) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted">No Impact Grade has been calculated for this spec yet. It is worked out from the spec&apos;s substrates and weights, the supplier&apos;s SRM scorecard and the PEF model.</p>
        <CalculateButton specId={specId} />
      </div>
    );
  }
  const conf = record.confidence ?? 0;
  const level = confidenceLevel(record.coverage);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ImpactGradeBadge score={record.score} href="/impact-grade" />
        <div className="text-sm">
          <p className="font-bold">{record.score === null ? "Not enough data" : `${record.letter} · ${Math.round(record.score)} of 100`}
            {record.rangeLow !== null && record.rangeHigh !== null && <span className="ml-2 font-normal text-muted">range {Math.round(record.rangeLow)}–{Math.round(record.rangeHigh)}</span>}</p>
          <p className="text-xs text-muted">{STAGE_LABEL[record.stage] ?? record.stage} stage · {record.coverage ?? 0}% of the grade has data · updated {new Date(record.updatedAt).toLocaleDateString("en-GB")}</p>
        </div>
        {hideConfidence ? (
          <div className="min-w-40 flex-1" title="Based on data availability: the share of the grade's weighted inputs that have data">
            <div className="flex justify-between text-xs"><span className="eyebrow">Level of confidence</span><b>{level.pct}%</b></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${level.pct}%` }} /></div>
          </div>
        ) : (
          <div className="min-w-40 flex-1" title="Confidence rises as inputs move from Assumed to Verified">
            <div className="flex justify-between text-xs"><span className="eyebrow">Confidence</span><b>{conf}%</b></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${conf}%` }} /></div>
          </div>
        )}
        <Pill tone={REVIEW_TONE[record.reviewStatus]}>{record.reviewStatus === "reviewed" ? "Reviewed" : record.reviewStatus === "disputed" ? "Disputed" : "Needs review"}</Pill>
        <CalculateButton specId={specId} label="Recalculate" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-3 py-2">Sub-score</th><th className="px-3 py-2">Weight</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Evidence</th><th className="px-3 py-2">Why</th></tr>
          </thead>
          <tbody>
            {record.subScores.map((s) => (
              <tr key={s.code} className="border-t border-line align-top">
                <td className="px-3 py-2 font-semibold">{s.name}{s.code === "SUPPLIER" && <span className="block text-[0.7rem] font-normal text-muted">{record.supplierName ? `from SRM: ${record.supplierName}` : "from SRM"}</span>}</td>
                <td className="px-3 py-2">{s.weight ? `${s.weight}%` : <span className="text-muted" title="Weight is set in the Watchtower">0 (not weighted)</span>}</td>
                <td className="px-3 py-2 font-bold">{s.score === null ? <span className="font-normal text-muted">–</span> : Math.round(s.score)}</td>
                <td className="px-3 py-2">{s.score === null ? <span className="text-muted">–</span> : <Pill tone={TIER_TONE[record.tiers[s.code] ?? "assumed"]}>{TIER_LABEL[record.tiers[s.code] ?? "assumed"]}</Pill>}</td>
                <td className="px-3 py-2 text-xs text-muted">{s.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {record.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">
          {record.warnings.map((w) => <li key={w}>• {w}</li>)}
        </ul>
      )}

      <details className="rounded-xl border border-line">
        <summary className="cursor-pointer px-3 py-2 text-sm font-bold">Edit inputs</summary>
        <form action={edit} className="space-y-3 border-t border-line p-3">
          <input type="hidden" name="spec_id" value={specId} />
          <p className="text-xs text-muted">Answers the spec does not hold. Pick how well each is evidenced: Declared for what the client or supplier told you, Measured when weighed or tested, Verified when SRM or QA checked it. A blank answer removes your input.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {OVERRIDE_FIELDS.map((f) => {
              const cur = record.overrides[f.key];
              const val = cur?.value === undefined || cur?.value === null ? "" : typeof cur.value === "boolean" ? (cur.value ? "yes" : "no") : String(cur.value);
              return (
                <div key={f.key} className="space-y-1">
                  <label className="label" htmlFor={`v_${f.key}`}>{f.label}</label>
                  <div className="flex gap-2">
                    {f.kind === "option" ? (
                      <select id={`v_${f.key}`} name={`v_${f.key}`} defaultValue={val} className="input min-w-0 flex-1">
                        <option value="">Not given</option>
                        {(options[f.optionKind ?? ""] ?? []).map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : f.kind === "bool" ? (
                      <select id={`v_${f.key}`} name={`v_${f.key}`} defaultValue={val} className="input min-w-0 flex-1"><option value="">Not given</option><option value="yes">Yes</option><option value="no">No</option></select>
                    ) : (
                      <input id={`v_${f.key}`} name={`v_${f.key}`} defaultValue={val} inputMode={f.kind === "number" ? "decimal" : "text"} className="input min-w-0 flex-1" />
                    )}
                    <select name={`t_${f.key}`} defaultValue={cur?.tier ?? "declared"} className="input w-32" aria-label={`${f.label}: evidence`}>
                      {IG_TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <label className="label" htmlFor="reason">Why are you changing this? (kept in the history)</label>
            <input id="reason" name="reason" required minLength={3} className="input w-full" />
          </div>
          <div className="flex flex-wrap items-center gap-2"><button className={btn.primary} disabled={editing}>{editing ? "Saving…" : "Save and recalculate"}</button><Msg s={editState} /></div>
        </form>
      </details>

      <form action={review} className="flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="id" value={record.id} />
        <input name="note" placeholder="Note (needed to dispute)" defaultValue={record.reviewNote ?? ""} className="input min-w-48 flex-1" />
        <button name="status" value="reviewed" className={btn.secondary} disabled={reviewing}><MSymbol name="verified" size={16} /> Mark reviewed</button>
        <button name="status" value="disputed" className={btn.secondary} disabled={reviewing}><MSymbol name="flag" size={16} /> Dispute</button>
        <Msg s={revState} />
      </form>
    </div>
  );
}

export function CalculateAllButton({ jobId }: { jobId?: string }) {
  const [s, run, pending] = useActionState<GradeActionResult, FormData>(calculateAllGrades, {});
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      {jobId && <input type="hidden" name="job_id" value={jobId} />}
      <button name="scope" value="missing" className={btn.primary} disabled={pending}><MSymbol name="calculate" size={17} /> {pending ? "Calculating…" : "Calculate missing grades"}</button>
      <button name="scope" value="all" className={btn.secondary} disabled={pending}><MSymbol name="refresh" size={17} /> Recalculate all</button>
      <Msg s={s} />
    </form>
  );
}

