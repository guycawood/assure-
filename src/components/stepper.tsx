import { Check, ClipboardList, FileText, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { clsx } from "clsx";

export type Step = { label: string; detail?: string; icon: LucideIcon };

export const ONBOARDING_STEPS: Step[] = [
  { label: "Request", icon: ClipboardList },
  { label: "Vendor information", icon: FileText },
  { label: "Procurement head review", icon: ShieldCheck },
  { label: "Gates & final approval", icon: Check },
];

/**
 * Horizontal progress tracker. Only the current step shows its icon; completed steps
 * show a tick, upcoming steps a number, so the eye lands on where the work is.
 */
export function Stepper({ steps, current, failedAt }: { steps: Step[]; current: number; failedAt?: number }) {
  return (
    <ol className="flex items-start" aria-label="Onboarding progress">
      {steps.map((s, i) => {
        const failed = failedAt === i;
        const done = !failed && i < current;
        const active = !failed && i === current;
        const Icon = s.icon;
        return (
          <li key={s.label} className="relative flex flex-1 flex-col items-center text-center" aria-current={active ? "step" : undefined}>
            {i > 0 && (
              <span
                aria-hidden
                className={clsx("absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2", i <= current && !failed ? "bg-ok" : "bg-line")}
              />
            )}
            <span
              className={clsx(
                "relative z-10 grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-semibold",
                failed && "border-bad bg-bad text-surface",
                done && "border-ok bg-ok text-surface",
                active && "border-accent bg-surface text-accent ring-4 ring-accent-soft",
                !failed && !done && !active && "border-line bg-surface text-muted",
              )}
            >
              {failed ? <X size={16} strokeWidth={2.5} /> : done ? <Check size={16} strokeWidth={2.5} /> : active ? <Icon size={16} strokeWidth={2} /> : i + 1}
            </span>
            <span className={clsx("mt-1.5 px-1 text-xs leading-tight", active ? "font-semibold text-fg" : done ? "text-fg" : "text-muted")}>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
