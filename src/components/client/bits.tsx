import Link from "next/link";
import { clsx } from "clsx";
import { MSymbol } from "@/components/symbol";
import { fmtDate, orderSteps, type OrderRow } from "@/lib/client-portal";

/** Shown on every page while adm Indicia staff preview a client's view. */
export function PreviewBanner({ name }: { name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-info/30 bg-info-soft px-4 py-2.5 text-sm text-info" role="status">
      <MSymbol name="visibility" size={18} />
      <span><b>Preview as client: {name}.</b> Read-only. This is exactly what their users see; nothing you do here is sent to them.</span>
      <Link href="/watchtower/client-access" className="ml-auto font-semibold underline underline-offset-2">Exit preview</Link>
    </div>
  );
}

/** Horizontal bar: value as a share of max. */
export function Bar({ label, value, max, display, sub, tone = "accent" }: { label: string; value: number; max: number; display: string; sub?: string; tone?: "accent" | "ok" | "info" }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const fill = tone === "ok" ? "bg-ok" : tone === "info" ? "bg-info" : "bg-accent";
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
      <span className="truncate font-semibold" title={label}>{label}</span>
      <span className="h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden><span className={clsx("block h-full rounded-full", fill)} style={{ width: `${pct}%` }} /></span>
      <span className="whitespace-nowrap text-right tabular-nums">{display}{sub && <span className="ml-1.5 text-xs text-muted">{sub}</span>}</span>
    </div>
  );
}

/** Order progress: estimate approved, order placed, in production, delivered, complete. */
export function OrderTimeline({ order }: { order: Pick<OrderRow, "status" | "milestones" | "estimates"> }) {
  const { steps, current } = orderSteps(order);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Order progress">
      {steps.map((s, i) => (
        <li key={s.key} className="min-w-0">
          <div className={clsx("h-1.5 rounded-full", s.done ? "bg-ok" : i === current ? "bg-accent/50" : "bg-surface-2")} />
          <p className={clsx("mt-1.5 truncate text-[0.72rem] font-semibold", s.done ? "text-fg" : i === current ? "text-accent" : "text-muted")}>
            {s.done && <MSymbol name="check" size={12} className="mr-0.5 align-[-1px] text-ok" />}{s.label}
          </p>
          {s.at && <p className="text-[0.68rem] text-muted">{fmtDate(s.at)}</p>}
        </li>
      ))}
    </ol>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm">{children}</dd>
    </div>
  );
}
