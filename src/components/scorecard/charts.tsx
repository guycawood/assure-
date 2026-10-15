// Lightweight scorecard charts: plain SVG and CSS, server-rendered, no chart library.
import { clsx } from "clsx";
import { fmtShort, monthLabel, routeColor, routeLabel, ROUTES, type KpiUnit } from "@/lib/scorecard-reporting";

export type Series = { key: string; label: string; color: string; points: { x: string; y: number | null }[] };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <i className="block h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}

/** Line chart over months, one line per series; gaps where a month has no value. */
export function LineChart({ series, unit, target, height = 220, title }: { series: Series[]; unit: KpiUnit; target?: number | null; height?: number; title: string }) {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const vals = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v != null);
  if (xs.length === 0 || vals.length === 0) return <p className="py-6 text-sm text-muted">No data for this selection.</p>;
  const W = 640, H = height, L = 44, R = 12, T = 12, B = 28;
  const max = niceMax(Math.max(...vals, target ?? 0));
  const x = (i: number) => L + (xs.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (xs.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(xs.length / 8));
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[10px]">{fmtShort(unit, t)}</text>
          </g>
        ))}
        {target != null && target <= max && (
          <g>
            <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} stroke="#16a34a" strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={W - R} y={y(target) - 4} textAnchor="end" className="text-[10px]" fill="#16a34a">target {fmtShort(unit, target)}</text>
          </g>
        )}
        {xs.map((m, i) => i % every === 0 || i === xs.length - 1 ? (
          <text key={m} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[10px]">{monthLabel(m)}</text>
        ) : null)}
        {series.map((s) => {
          const byX = new Map(s.points.map((p) => [p.x, p.y]));
          const segs: string[] = [];
          let cur = "";
          xs.forEach((m, i) => {
            const v = byX.get(m);
            if (v == null) { if (cur) segs.push(cur); cur = ""; return; }
            cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
          });
          if (cur) segs.push(cur);
          return (
            <g key={s.key}>
              {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />)}
              {xs.map((m, i) => {
                const v = byX.get(m);
                return v == null ? null : <circle key={m} cx={x(i)} cy={y(v)} r={2.6} fill={s.color}><title>{`${s.label}, ${monthLabel(m)}: ${fmtShort(unit, v)}`}</title></circle>;
              })}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
    </figure>
  );
}

/** Horizontal bars with an optional target tick per row. */
export function HBars({ rows, unit, direction = "higher", empty = "No data for this selection." }: {
  rows: { label: string; value: number | null; target?: number | null; sub?: string }[]; unit: KpiUnit; direction?: "higher" | "lower"; empty?: string;
}) {
  const shown = rows.filter((r) => r.value != null);
  if (shown.length === 0) return <p className="py-6 text-sm text-muted">{empty}</p>;
  const max = niceMax(Math.max(...shown.map((r) => Math.max(Number(r.value), Number(r.target ?? 0)))));
  return (
    <ul className="space-y-2">
      {shown.map((r) => {
        const v = Number(r.value);
        const off = r.target != null && (direction === "lower" ? v > r.target : v < r.target);
        return (
          <li key={r.label} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm">
            <span className="truncate font-semibold" title={r.label}>{r.label}{r.sub && <span className="block text-[0.7rem] font-normal text-muted">{r.sub}</span>}</span>
            <span className="relative h-3 rounded-full bg-surface-2" aria-hidden>
              <span className={clsx("block h-full rounded-full", off ? "bg-bad/70" : "bg-accent")} style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
              {r.target != null && <span className="absolute -top-1 h-5 w-0.5 bg-ok" style={{ left: `${Math.min(100, (r.target / max) * 100)}%` }} title={`Target ${fmtShort(unit, r.target)}`} />}
            </span>
            <span className={clsx("text-right tabular-nums", off && "text-bad")}>{fmtShort(unit, v)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Rows x AAC routes as a shaded table (e.g. spec type x route). */
export function RouteMatrix({ rows, unit, rowLabel }: { rows: { row: string; route: string; value: number | null }[]; unit: KpiUnit; rowLabel: string }) {
  const names = [...new Set(rows.map((r) => r.row))].sort();
  const routes = ROUTES.filter((rt) => rows.some((r) => r.route === rt.key && r.value != null));
  const vals = rows.map((r) => r.value).filter((v): v is number => v != null);
  if (names.length === 0 || vals.length === 0) return <p className="py-6 text-sm text-muted">No data for this selection.</p>;
  const max = Math.max(...vals.map(Math.abs)) || 1;
  const get = (n: string, r: string) => rows.find((x) => x.row === n && x.route === r)?.value ?? null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">{rowLabel}</th>{routes.map((r) => <th key={r.key} className="th text-right">{r.label}</th>)}</tr></thead>
        <tbody>
          {names.map((n) => (
            <tr key={n}>
              <td className="td font-semibold">{n}</td>
              {routes.map((r) => {
                const v = get(n, r.key);
                return (
                  <td key={r.key} className="td text-right tabular-nums" style={v == null ? undefined : { background: `rgba(72,150,247,${(0.08 + 0.5 * Math.abs(v) / max).toFixed(2)})` }}>
                    {fmtShort(unit, v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Grouped horizontal bars: one group per row (e.g. business unit), one bar per AAC route. */
export function GroupedBars({ rows, unit }: { rows: { row: string; route: string; value: number | null }[]; unit: KpiUnit }) {
  const names = [...new Set(rows.filter((r) => r.value != null).map((r) => r.row))].sort();
  const vals = rows.map((r) => r.value).filter((v): v is number => v != null);
  if (names.length === 0) return <p className="py-6 text-sm text-muted">No data for this selection.</p>;
  const max = niceMax(Math.max(...vals.map(Math.abs)));
  const routes = ROUTES.filter((rt) => rows.some((r) => r.route === rt.key && r.value != null));
  return (
    <div className="space-y-3">
      <Legend items={routes.map((r) => ({ label: r.label, color: r.color }))} />
      <ul className="space-y-2.5">
        {names.map((n) => (
          <li key={n} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-2 text-sm">
            <span className="truncate font-semibold" title={n}>{n}</span>
            <span className="space-y-0.5">
              {routes.map((r) => {
                const v = rows.find((x) => x.row === n && x.route === r.key)?.value;
                if (v == null) return null;
                return (
                  <span key={r.key} className="flex items-center gap-2" title={`${routeLabel(r.key)}: ${fmtShort(unit, v)}`}>
                    <span className="block h-2 rounded-full" style={{ width: `${Math.max(1.5, (Math.abs(v) / max) * 85)}%`, background: routeColor(r.key) }} />
                    <span className="text-[0.7rem] tabular-nums text-muted">{fmtShort(unit, v)}</span>
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
