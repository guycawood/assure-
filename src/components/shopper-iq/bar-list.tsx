import { clsx } from "clsx";
import { Panel } from "@/components/ui";
import { fmtMoney, fmtPct, type Group } from "@/lib/shopper-iq";

/** Simple HTML/CSS bars: spend as the bar, execution score and measured uplift alongside. */
export function BarList({ title, sub, groups, currency = "EUR", limit = 8 }: { title: string; sub?: string; groups: Group[]; currency?: string; limit?: number }) {
  const max = Math.max(1, ...groups.map((g) => g.spend));
  const shown = groups.slice(0, limit);
  return (
    <Panel title={title} sub={sub}>
      {shown.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No records yet.</p> : (
        <ul className="space-y-3 px-5 py-4">
          {shown.map((g) => (
            <li key={g.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-semibold">{g.label}</span>
                <span className="shrink-0 tabular-nums text-muted">{fmtMoney(g.spend, currency)}</span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${(g.spend / max) * 100}%`, background: "#EE4E62" }} />
              </div>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-[0.7rem] text-muted">
                <span>Execution <b className={clsx("tabular-nums", g.avgScore == null ? "" : g.avgScore >= 75 ? "text-ok" : g.avgScore >= 60 ? "text-warn" : "text-bad")}>{g.avgScore == null ? "—" : Math.round(g.avgScore)}</b></span>
                <span>Uplift <b className="tabular-nums">{fmtPct(g.avgUplift)}</b>{g.measured ? ` (${g.measured} measured)` : ""}</span>
                <span>{g.rows} record{g.rows === 1 ? "" : "s"}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
