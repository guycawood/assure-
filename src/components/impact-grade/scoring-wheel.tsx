// Impact Grade scoring wheel, drawn like the ecoGrade wheel (ecoGrade_extended version.pptx): equal segments, each
// showing its sub-score as a percentage on a coloured band, curved uppercase labels in a white outer ring, a soft
// halo, and the grade in a white centre. The sub-score weights are in the legend. Pure SVG: server or client.

export type WheelSegment = { code: string; name: string; category: string; weight: number | null; score: number | null };

/** Short two-line labels for the ring, in the ecoGrade style. */
const LABEL: Record<string, [string, string?]> = {
  DURABILITY: ["DURABILITY", "& LIFESPAN"], REUSABILITY: ["REUSE", "DESIGN"], REPAIRABILITY: ["REPAIR", "& MODULAR"],
  RECYCLABILITY: ["RECYCLE", "READY"], RESOURCE_USE: ["RESOURCE", "EFFICIENT"], SUBSTANCES: ["ENVIRONMENT", "SAFE"],
  RECYCLED_CONTENT: ["RECYCLED", "CONTENT"], PEF: ["PEF", "FOOTPRINT"], SUPPLIER: ["SUPPLIER", "SCORE"], LOGISTICS: ["SUPPLY CHAIN", "OPTIMISED"],
};
const CAT_COLOUR: Record<string, string> = {
  "Circular design": "#4896F7", "Resource use & efficiency": "#B776BC", "Environmental footprint": "#3fae7e", "Supplier score": "#6A2DD3", Logistics: "#FFB05B",
};
/** ecoGrade colours: cyan at the top, green for good, orange for middling, red for poor, grey for no data. */
export const scoreColour = (s: number | null) =>
  s === null ? "#8a9a9a" : s >= 90 ? "#36c9d6" : s >= 60 ? "#22c96b" : s >= 30 ? "#f28a1e" : "#ee4e4e";

const LETTERS = [["A", 80], ["B", 60], ["C", 40], ["D", 20], ["E", 0]] as const;

export function ScoringWheel({ segments, score, letter, provisional, size = 320 }: {
  segments: WheelSegment[]; score: number | null; letter: string | null; provisional?: boolean; size?: number;
}) {
  const segs = segments.filter((s) => (s.weight ?? 0) > 0);
  const c = 160;
  const step = (Math.PI * 2) / Math.max(segs.length, 1);
  const p = (r: number, a: number) => [c + r * Math.sin(a), c - r * Math.cos(a)] as const;
  const ring = (r0: number, r1: number, a0: number, a1: number) => {
    const [x0, y0] = p(r1, a0); const [x1, y1] = p(r1, a1); const [x2, y2] = p(r0, a1); const [x3, y3] = p(r0, a0);
    return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
  };
  // Text arcs: clockwise on the top half, anticlockwise on the bottom half so labels stay upright.
  const textArc = (r: number, a0: number, a1: number, bottom: boolean) => {
    if (!bottom) { const [x0, y0] = p(r, a0); const [x1, y1] = p(r, a1); return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`; }
    const [x0, y0] = p(r, a1); const [x1, y1] = p(r, a0); return `M${x0},${y0} A${r},${r} 0 0 0 ${x1},${y1}`;
  };
  const id = `w${segs.map((s) => s.code[0]).join("")}${segs.length}`;

  return (
    <svg viewBox="0 0 320 320" width={size} height={size} role="img" aria-label={`Impact Grade ${letter ?? ""} ${score ?? "not calculated"}`} style={{ maxWidth: "100%", height: "auto" }}>
      <circle cx={c} cy={c} r={158} fill="#9ad3d8" opacity={0.35} />
      <circle cx={c} cy={c} r={150} fill="#ffffff" stroke="#d8e6e6" />
      {segs.map((s, i) => {
        // Half a segment back, so the first segment sits centred at the top as on the ecoGrade wheel.
        const a0 = (i - 0.5) * step; const a1 = (i + 0.5) * step; const mid = (a0 + a1) / 2;
        const bottom = Math.cos(mid) < -0.05;
        const [l1, l2] = LABEL[s.code] ?? [s.name.toUpperCase()];
        const lines = l2 ? (bottom ? [l2, l1] : [l1, l2]) : [l1];
        const radii = l2 ? [138, 127] : [133];
        const [vx, vy] = p(86, mid);
        return (
          <g key={s.code}>
            <path d={ring(64, 112, a0, a1)} fill={scoreColour(s.score)} stroke="#ffffff" strokeWidth={3}>
              <title>{`${s.name}: ${s.score === null ? "no data" : `${Math.round(s.score)}%`} · weight ${s.weight}`}</title>
            </path>
            <path d={ring(112, 150, a0, a1)} fill="none" stroke="#e6eeee" strokeWidth={1} />
            {lines.map((txt, k) => (
              <g key={k}>
                <path id={`${id}-${s.code}-${k}`} d={textArc(radii[k], a0 + 0.04, a1 - 0.04, bottom)} fill="none" />
                <text fontSize={7.6} fontWeight={800} letterSpacing={0.6} fill="#1d2b2b">
                  <textPath href={`#${id}-${s.code}-${k}`} startOffset="50%" textAnchor="middle">{txt}</textPath>
                </text>
              </g>
            ))}
            <text x={vx} y={vy} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={800} fill="#ffffff">
              {s.score === null ? "–" : `${Math.round(s.score)}%`}
            </text>
          </g>
        );
      })}
      <circle cx={c} cy={c} r={60} fill="#ffffff" stroke="#e3ecec" strokeWidth={2} />
      <text x={c} y={c - 4} textAnchor="middle" fontSize={30} fontWeight={800} fill="#14202a">{score === null ? "–" : score.toFixed(1)}</text>
      <text x={c} y={c + 14} textAnchor="middle" fontSize={7.5} fontWeight={700} letterSpacing={0.8} fill="#4a5a5a">IMPACT GRADE</text>
      <text x={c} y={c + 30} textAnchor="middle" fontSize={11} fontWeight={800} fill="#010062">{letter ? `Grade ${letter}` : ""}{provisional ? " · provisional" : ""}</text>
    </svg>
  );
}

/** The ecoGrade header pill and A-E scale chips around the wheel. */
export function WheelFrame({ letter, children }: { letter: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm font-semibold shadow-sm">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#36c9d6" }} />Impact Grade
      </span>
      {children}
      <div className="flex gap-1.5">
        {LETTERS.map(([l, min]) => (
          <span key={l} title={`${l}: ${min} and above`} className="grid h-7 w-9 place-items-center rounded-full text-xs font-bold"
            style={letter === l ? { background: scoreColour(min + 10), color: "#fff" } : { background: "#eef3f3", color: "#6b7c7c" }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/** Legend: categories, then each sub-score with its weight and score. */
export function WheelLegend({ segments }: { segments: WheelSegment[] }) {
  const cats = [...new Set(segments.map((s) => s.category))];
  return (
    <div className="space-y-2 text-sm">
      {cats.map((cat) => (
        <div key={cat}>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: CAT_COLOUR[cat] ?? "#6b7c7c" }}>
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CAT_COLOUR[cat] ?? "#9DC5ED" }} />{cat}
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {segments.filter((s) => s.category === cat).map((s) => (
              <li key={s.code} className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: scoreColour(s.score) }} />
                <span className="flex-1">{s.name}</span>
                <span className="w-14 text-right text-xs text-muted">{s.weight ? `weight ${s.weight}` : "n/a"}</span>
                <span className="w-10 text-right tabular-nums">{s.score === null ? "–" : `${Math.round(s.score)}%`}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
