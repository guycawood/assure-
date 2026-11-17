// Line chart over quarters (e.g. 2026-Q2): plain SVG, server-rendered, no library. One line per metric; gaps where a quarter has no value.
export type PeriodSeries = { key: string; label: string; color: string; bold?: boolean; values: Record<string, number | null | undefined> };

const niceMax = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const qLabel = (p: string) => { const m = /^(\d{4})-Q(\d)$/.exec(p); return m ? `Q${m[2]} ${m[1].slice(2)}` : p; };

export function PeriodChart({ periods, series, title, unit = "", max, height = 220 }: {
  periods: string[]; series: PeriodSeries[]; title: string; unit?: string; max?: number; height?: number;
}) {
  const xs = [...periods].sort();
  const vals = series.flatMap((s) => xs.map((p) => s.values[p])).filter((v): v is number => v != null);
  if (xs.length === 0 || vals.length === 0) return <p className="py-6 text-sm text-muted">No data yet.</p>;
  const W = 640, H = height, L = 40, R = 14, T = 12, B = 28;
  const top = max ?? niceMax(Math.max(...vals));
  const x = (i: number) => L + (xs.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (xs.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const fmt = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[10px]">{fmt(t)}</text>
          </g>
        ))}
        {xs.map((p, i) => <text key={p} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[10px]">{qLabel(p)}</text>)}
        {series.map((s) => {
          const segs: string[] = []; let cur = "";
          xs.forEach((p, i) => { const v = s.values[p]; if (v == null) { if (cur) segs.push(cur); cur = ""; return; } cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
          if (cur) segs.push(cur);
          return (
            <g key={s.key}>
              {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={s.bold ? 3 : 1.8} strokeLinejoin="round" strokeLinecap="round" opacity={s.bold ? 1 : 0.85} />)}
              {xs.map((p, i) => { const v = s.values[p]; return v == null ? null : <circle key={p} cx={x(i)} cy={y(v)} r={s.bold ? 3.4 : 2.6} fill={s.color}><title>{`${s.label}, ${qLabel(p)}: ${fmt(v)}`}</title></circle>; })}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><i className="block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </figure>
  );
}

type Rec = { period: string; cost_score: number | null; otif_score: number | null; quality_score: number | null; compliance_score: number | null;
  sustainability_score: number | null; composite_score: number | null; ncr_count: number; defect_rate: number | null };

const num = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** The metric charts for one vendor, from their quarterly performance records: scores, then quality problems (NCRs and defect rate). */
export function VendorTrends({ records }: { records: Rec[] }) {
  const periods = [...new Set(records.map((r) => r.period))].sort();
  const by = (f: (r: Rec) => number | null) => Object.fromEntries(records.map((r) => [r.period, f(r)]));
  const scores: PeriodSeries[] = [
    { key: "composite", label: "Composite", color: "#1d2a7a", bold: true, values: by((r) => num(r.composite_score)) },
    { key: "cost", label: "Cost", color: "#d9a032", values: by((r) => num(r.cost_score)) },
    { key: "otif", label: "On time in full", color: "#2f9e6b", values: by((r) => num(r.otif_score)) },
    { key: "quality", label: "Quality", color: "#4896f7", values: by((r) => num(r.quality_score)) },
    { key: "compliance", label: "Compliance", color: "#8b5cf6", values: by((r) => num(r.compliance_score)) },
    { key: "sustain", label: "Sustainability", color: "#14b8a6", values: by((r) => num(r.sustainability_score)) },
  ];
  const quality: PeriodSeries[] = [{ key: "ncr", label: "NCRs raised", color: "#d64545", bold: true, values: by((r) => r.ncr_count) }];
  const defects: PeriodSeries[] = [{ key: "def", label: "Defect rate", color: "#e07b3c", bold: true, values: by((r) => num(r.defect_rate)) }];
  if (periods.length === 0) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <p className="mb-2 font-display text-[0.95rem] font-bold">Scores over time <span className="font-normal text-muted">(0 to 100, by quarter)</span></p>
        <PeriodChart periods={periods} series={scores} max={100} title="Performance scores by quarter" />
      </div>
      <div className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div><p className="mb-1 font-display text-[0.95rem] font-bold">NCRs raised</p><PeriodChart periods={periods} series={quality} title="NCRs raised by quarter" height={140} /></div>
        <div><p className="mb-1 font-display text-[0.95rem] font-bold">Defect rate</p><PeriodChart periods={periods} series={defects} unit="%" title="Defect rate by quarter" height={140} /></div>
      </div>
    </div>
  );
}
