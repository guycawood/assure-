"use client";

import { useState } from "react";
import { ActionForm, Field, type FormResult } from "@/components/sourcing/action-form";
import { displayScore, type Criterion } from "@/lib/execution";

/** Audit form: one 0–100 score per display_scoring criterion with a live weighted total. The stored score is computed by the server. */
export function AuditForm({ deploymentId, criteria, passMark, action }: {
  deploymentId: string; criteria: Criterion[]; passMark: number; action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
}) {
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const s = displayScore(criteria, scores);
  return (
    <ActionForm action={action} hidden={{ id: deploymentId }} submit="Record audit">
      {!s.weightsOk && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">The criteria weights total {s.weightsTotal}%, not 100%. Fix them in the Execution+ Watchtower before auditing.</p>}
      <div className="space-y-2">
        {criteria.map((c) => (
          <div key={c.code} className="grid grid-cols-[1fr_6rem] items-center gap-3">
            <label htmlFor={`score-${c.code}`} className="text-sm">
              <span className="font-semibold">{c.name}</span> <span className="text-xs text-muted">({c.weight}%)</span>
              {c.guidance && <span className="block text-xs text-muted">{c.guidance}</span>}
            </label>
            <input id={`score-${c.code}`} name={`score:${c.code}`} type="number" min={0} max={100} step={1} required className="input text-right"
              onChange={(e) => setScores((p) => ({ ...p, [c.code]: e.target.value === "" ? null : Number(e.target.value) }))} />
          </div>
        ))}
      </div>
      <p className="text-sm">
        Weighted score <b className="tabular-nums">{s.complete ? `${s.total}%` : "—"}</b>
        {s.complete && <span className={s.total >= passMark ? "text-ok" : "text-bad"}> · {s.total >= passMark ? "pass" : "fail"} (pass mark {passMark}%)</span>}
      </p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="needs_review" /> Needs review (don&apos;t pass or fail yet)</label>
      <Field label="Notes (required if it doesn't pass)" htmlFor="audit-notes"><textarea id="audit-notes" name="notes" rows={2} className="input" /></Field>
    </ActionForm>
  );
}
