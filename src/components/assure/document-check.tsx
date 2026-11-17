import { Pill } from "@/components/ui";
import { ActionForm } from "@/components/assure/action-form";
import { rerunCheck } from "@/app/(platform)/assure/compliance/review/actions";

export type DocCheck = {
  subject_id: string; status: "queued" | "running" | "done" | "failed"; outcome: "clear" | "review" | "fail" | null;
  findings: { rule: string; result: "pass" | "warn" | "fail"; detail: string }[]; engine: string | null; error: string | null; checked_at: string | null;
};

const OUTCOME = { clear: ["Looks right", "ok"], review: ["Look closely", "warn"], fail: ["Problem found", "bad"] } as const;
const MARK = { pass: "✓", warn: "!", fail: "✕" } as const;
const COLOR = { pass: "text-ok", warn: "text-warn", fail: "text-bad" } as const;

/** What the automatic check found in an uploaded document. It helps the reviewer; it never verifies or rejects anything. */
export function DocumentCheck({ type, id, check }: { type: "certificate" | "document"; id: string; check?: DocCheck }) {
  if (!check) return null;
  const waiting = check.status === "queued" || check.status === "running";
  return (
    <details className="mt-2 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs" open={check.outcome === "fail"}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <b>Automatic check</b>
        {waiting ? <Pill tone="neutral">Waiting to be read</Pill> : check.outcome ? <Pill tone={OUTCOME[check.outcome][1]}>{OUTCOME[check.outcome][0]}</Pill> : null}
        {check.status === "failed" && <span className="text-muted">The file could not be read{check.error ? `: ${check.error}` : ""}</span>}
      </summary>
      {check.findings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {check.findings.map((f, i) => <li key={i} className="flex gap-2"><span className={`w-3 font-bold ${COLOR[f.result]}`} aria-label={f.result}>{MARK[f.result]}</span><span>{f.detail}</span></li>)}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-3 text-muted">
        <span>This is a guide only. You still decide.{check.engine ? ` Read by: ${check.engine}.` : ""}</span>
        <ActionForm action={rerunCheck} hidden={{ type, id }} submit="Check again" variant="secondary" inline />
      </div>
    </details>
  );
}
