import { clsx } from "clsx";
import { PA_PIPELINE } from "@/lib/assure";

/** Pre-assessment progress: Submitted → VM review → Approved → Procurement → Negotiation → Onboarded. Rejections show red at the stage. */
export function Pipeline({ status }: { status: string }) {
  const steps = ["Submitted", "Vendor-manager review", "Approved", "Procurement", "Negotiation", "Onboarded"];
  const idx = PA_PIPELINE.indexOf(status);
  const failedAt = status === "vm_rejected" ? 1 : status === "rejected" ? 4 : -1;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[0.7rem]" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className={clsx("rounded-full px-2 py-0.5 font-semibold",
          i === failedAt ? "bg-bad-soft text-bad" : failedAt >= 0 && i > failedAt ? "bg-surface-2 text-muted" : i < idx || (failedAt >= 0 && i < failedAt) ? "bg-ok-soft text-ok" : i === idx ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>
          {s}
        </li>
      ))}
    </ol>
  );
}
