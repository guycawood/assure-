import { clsx } from "clsx";
import { MSymbol } from "@/components/symbol";
import { MILESTONES, daysBetween, fmtDays, type JourneyRow } from "@/lib/qaqc";

const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Every milestone from brief to job close, with its timestamp, who did it and the time since the previous milestone.
 * Milestones not reached are shown greyed out (some never apply, e.g. no RFQ on an Adopt route).
 */
export function JourneyTimeline({ rows, compact }: { rows: JourneyRow[]; compact?: boolean }) {
  const byCode = new Map(rows.map((r) => [r.milestone_code, r]));
  const start = rows[0]?.at ?? null;
  let prev: string | null = null;
  const items = MILESTONES.map((m) => {
    const r = byCode.get(m.code);
    const gap = r ? daysBetween(prev, r.at) : null;
    if (r) prev = r.at;
    return { ...m, r, gap };
  }).filter((x) => !compact || x.r);
  const end = rows.find((r) => r.milestone_code === "delivered")?.at ?? rows.find((r) => r.milestone_code === "pod")?.at ?? null;
  return (
    <div className="p-5">
      {start && (
        <p className="mb-3 text-sm text-muted">
          {end ? <>Speed to market: <b className="text-fg">{fmtDays(daysBetween(start, end))}</b> from {rows[0].milestone_label.toLowerCase()} to delivery.</> : <>Started {fmt(start)}; not delivered yet.</>}
        </p>
      )}
      <ol className="relative space-y-0 border-l border-line pl-5">
        {items.map((x) => (
          <li key={x.code} className="relative pb-3">
            <span className={clsx("absolute -left-[1.85rem] top-0.5 grid h-5 w-5 place-items-center rounded-full border-2",
              x.r ? "border-ok bg-ok text-white" : "border-line bg-surface text-muted")}>
              <MSymbol name={x.r ? "check" : "remove"} size={12} />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className={clsx("text-sm font-semibold", !x.r && "text-muted")}>{x.label}</span>
              {x.r && <span className="text-xs tabular-nums text-muted">{fmt(x.r.at)}{x.gap != null && x.gap > 0 ? ` · +${fmtDays(x.gap)}` : ""}</span>}
            </div>
            {x.r && (x.r.ref || x.r.actor_name) && <p className="text-xs text-muted">{[x.r.ref, x.r.actor_name].filter(Boolean).join(" · ")}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
