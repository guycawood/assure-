import { bandLabel, type Band, type CompositePart, type FullMethodology, type OptionBand } from "@/lib/scorecard";
import { Card } from "@/components/ui";

/** Plain-language explanation of a methodology, generated from the data so it can never drift from what's applied. */
export function MethodologyView({ m }: { m: FullMethodology }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="space-y-2 p-4 text-sm">
        <h3 className="font-display text-base font-semibold">How a supplier&apos;s score is worked out</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Each criterion is scored from 0 to 5 using the bands below.</li>
          <li>Criteria are weighted within their pillar to give a pillar score (0–5).</li>
          <li>
            Pillars are weighted into one overall score:{" "}
            {m.pillars.map((p, i) => <span key={p.key}><b>{p.label} {p.weight}%</b>{i < m.pillars.length - 1 ? ", " : "."}</span>)}
          </li>
          <li>
            Missing data:{" "}
            {m.missing_data === "redistribute"
              ? "a criterion with no data is left out and its weight is shared across the criteria that do have data. The scorecard shows how complete each supplier's data is."
              : "a criterion with no data scores 0."}
          </li>
          <li>
            A supplier is on the <b>Preferred Supplier List</b> when it is active, scores above <b>{m.preferred_threshold}</b>
            {m.require_coc ? <>, and has a <b>signed Code of Conduct</b></> : null}.
          </li>
        </ol>
      </Card>

      {m.pillars.map((p) => (
        <Card key={p.key} className="overflow-x-auto">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
            <h3 className="font-display text-base font-semibold">{p.label} <span className="text-muted">· {p.weight}% of the overall score</span></h3>
            {p.description && <p className="text-sm text-muted">{p.description}</p>}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr><th className="th">Criterion</th><th className="th text-right">Weight</th><th className="th">How it scores</th><th className="th">Source</th></tr>
            </thead>
            <tbody>
              {m.criteria.filter((c) => c.pillar_key === p.key).map((c) => (
                <tr key={c.key} className="align-top">
                  <td className="td">
                    <p className="font-semibold">{c.label}</p>
                    {c.description && <p className="text-xs text-muted">{c.description}</p>}
                    {c.open_point && <p className="mt-1 rounded bg-warn-soft px-2 py-1 text-xs"><b>Open point:</b> {c.open_point}</p>}
                  </td>
                  <td className="td text-right tabular-nums">{c.weight}%</td>
                  <td className="td"><Bands kind={c.kind} bands={c.bands} unit={c.unit} /></td>
                  <td className="td text-xs text-muted">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function Bands({ kind, bands, unit }: { kind: string; bands: unknown; unit: string | null }) {
  if (kind === "option") {
    return (
      <ul className="space-y-0.5 text-xs">
        {(bands as OptionBand[]).map((o) => <li key={o.value}><b className="tabular-nums">{o.score ?? "↪"}</b> {o.label}{o.score === null ? " (uses the fallback score)" : ""}</li>)}
      </ul>
    );
  }
  if (kind === "number") {
    return (
      <ul className="space-y-0.5 text-xs">
        {(bands as Band[]).map((b, i) => <li key={i}><b className="tabular-nums">{b.score}</b> {bandLabel(b, unit)}</li>)}
      </ul>
    );
  }
  return (
    <div className="space-y-1.5 text-xs">
      {(bands as { parts: CompositePart[] }).parts.map((p) => (
        <div key={p.key}>
          <p className="font-semibold">{p.label} · {p.weight}%</p>
          <p className="text-muted">{p.bands.map((b) => `${b.score} = ${bandLabel(b, p.unit)}`).join("; ")}</p>
        </div>
      ))}
    </div>
  );
}
