import { MSymbol } from "@/components/symbol";
import type { QaqcCheckpoint } from "@/lib/qaqc";

const d = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");

/** Key data recorded with a piece of evidence, in plain words. */
export function evidenceFacts(e: QaqcCheckpoint["evidence"][number]): string {
  return [
    e.issued_on && `issued ${d(e.issued_on)}`, e.inspection_date && `inspected ${d(e.inspection_date)}`, e.expires_on && `expires ${d(e.expires_on)}`,
    e.body_name || e.body_code, e.certificate_number && `no. ${e.certificate_number}`,
    e.sample_size != null && `sample ${e.sample_size}: ${e.defects_critical ?? 0} critical / ${e.defects_major ?? 0} major / ${e.defects_minor ?? 0} minor`,
    e.result && `result ${e.result}`,
  ].filter(Boolean).join(" · ");
}

/** The automatic checks run at upload, with what passed and what did not. */
export function CheckList({ checks }: { checks: QaqcCheckpoint["checks"] }) {
  if (!checks?.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {checks.map((c) => (
        <li key={c.code} className="flex gap-1.5">
          <MSymbol name={c.ok ? "check_circle" : c.hard ? "cancel" : "error"} size={16} fill className={c.ok ? "text-ok" : c.hard ? "text-bad" : "text-warn"} />
          <span><b>{c.label}.</b> <span className="text-muted">{c.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}
