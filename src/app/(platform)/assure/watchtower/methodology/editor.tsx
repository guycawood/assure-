"use client";

import { useState, useTransition } from "react";
import { bandLabel, weightProblems, type Band, type CompositePart, type Criterion, type FullMethodology, type OptionBand } from "@/lib/scorecard";
import { btn, Card } from "@/components/ui";
import { activateDraft, saveDraft, type ActionResult } from "../actions";

const COND = ["min", "above", "max", "below"] as const;

/** Edit a band's threshold (whichever condition it has) and its score. */
function BandRow({ b, unit, onChange }: { b: Band; unit: string | null; onChange: (b: Band) => void }) {
  const cond = COND.find((k) => b[k] !== undefined);
  const word = { min: "at least", above: "over", max: "up to", below: "under" };
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <input type="number" step="0.5" min={0} max={5} value={b.score} aria-label="Score"
        onChange={(e) => onChange({ ...b, score: Number(e.target.value) })} className="input w-16 py-0.5" />
      <span className="text-muted">if</span>
      {cond ? (
        <>
          <span>{word[cond]}</span>
          <input type="number" value={b[cond]} aria-label="Threshold"
            onChange={(e) => onChange({ ...b, [cond]: Number(e.target.value) })} className="input w-24 py-0.5" />
          <span className="text-muted">{unit}</span>
        </>
      ) : (
        <span className="text-muted">{bandLabel(b, unit)}</span>
      )}
    </div>
  );
}

function CriterionBands({ c, onChange }: { c: Criterion; onChange: (bands: Criterion["bands"]) => void }) {
  if (c.kind === "number") {
    const bands = c.bands as Band[];
    return <div className="space-y-1">{bands.map((b, i) => <BandRow key={i} b={b} unit={c.unit} onChange={(nb) => onChange(bands.map((x, j) => (j === i ? nb : x)))} />)}</div>;
  }
  if (c.kind === "option") {
    const opts = c.bands as OptionBand[];
    return (
      <div className="space-y-1">
        {opts.map((o, i) => (
          <label key={o.value} className="flex items-center gap-1.5 text-xs">
            {o.score === null ? (
              <span className="w-16 text-center text-muted" title="Uses the fallback criterion's score">fallback</span>
            ) : (
              <input type="number" step="0.5" min={0} max={5} value={o.score} aria-label={`Score for ${o.label}`}
                onChange={(e) => onChange(opts.map((x, j) => (j === i ? { ...x, score: Number(e.target.value) } : x)))} className="input w-16 py-0.5" />
            )}
            {o.label}
          </label>
        ))}
      </div>
    );
  }
  const parts = (c.bands as { parts: CompositePart[] }).parts;
  const setPart = (i: number, p: CompositePart) => onChange({ parts: parts.map((x, j) => (j === i ? p : x)) });
  return (
    <div className="space-y-2">
      {parts.map((p, i) => (
        <div key={p.key} className="rounded border border-line p-2">
          <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
            <input type="number" min={0} max={100} value={p.weight} aria-label={`Weight of ${p.label}`}
              onChange={(e) => setPart(i, { ...p, weight: Number(e.target.value) })} className="input w-16 py-0.5" />% {p.label}
          </label>
          <div className="space-y-1">{p.bands.map((b, k) => <BandRow key={k} b={b} unit={p.unit ?? null} onChange={(nb) => setPart(i, { ...p, bands: p.bands.map((x, j) => (j === k ? nb : x)) })} />)}</div>
        </div>
      ))}
    </div>
  );
}

export function MethodologyEditor({ draft }: { draft: FullMethodology }) {
  const [m, setM] = useState(draft);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const problems = weightProblems(m);

  const setCriterion = (key: string, patch: Partial<Criterion>) => setM({ ...m, criteria: m.criteria.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const payload = () => ({
    id: m.id,
    settings: { preferred_threshold: Number(m.preferred_threshold), require_coc: m.require_coc, missing_data: m.missing_data },
    pillars: m.pillars.map((p) => ({ key: p.key, weight: Number(p.weight) })),
    criteria: m.criteria.map((c) => ({ key: c.key, weight: Number(c.weight), bands: c.bands })),
  });

  const save = () => start(async () => setMsg(await saveDraft(payload())));
  const activate = () =>
    start(async () => {
      const r = await saveDraft(payload());
      if (!r.ok) return setMsg(r);
      const a = await activateDraft(m.id, note);
      if (a) setMsg(a);
    });

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-4 p-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="label">PSL threshold (overall score must be above)</span>
          <input type="number" step="0.1" min={0} max={5} value={m.preferred_threshold}
            onChange={(e) => setM({ ...m, preferred_threshold: Number(e.target.value) })} className="input" />
        </label>
        <label className="text-sm">
          <span className="label">Missing data</span>
          <select value={m.missing_data} onChange={(e) => setM({ ...m, missing_data: e.target.value as FullMethodology["missing_data"] })} className="input">
            <option value="redistribute">Share the weight across criteria with data</option>
            <option value="zero">Score missing data as 0</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
          <input type="checkbox" checked={m.require_coc} onChange={(e) => setM({ ...m, require_coc: e.target.checked })} />
          No signed Code of Conduct keeps a supplier off the PSL
        </label>
      </Card>

      {m.pillars.map((p) => {
        const crit = m.criteria.filter((c) => c.pillar_key === p.key);
        const sum = crit.reduce((a, c) => a + Number(c.weight), 0);
        return (
          <Card key={p.key} className="overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <h3 className="font-display text-base font-semibold">{p.label}</h3>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="number" min={0} max={100} value={p.weight} aria-label={`${p.label} weight`}
                  onChange={(e) => setM({ ...m, pillars: m.pillars.map((x) => (x.key === p.key ? { ...x, weight: Number(e.target.value) } : x)) })}
                  className="input w-20 py-1" />% of overall
              </label>
              <span className={`ml-auto text-xs font-semibold ${Math.abs(sum - 100) < 0.001 ? "text-ok" : "text-bad"}`}>Criteria total {sum}%</span>
            </div>
            <table className="w-full text-sm">
              <thead><tr><th className="th">Criterion</th><th className="th">Weight</th><th className="th">Scoring bands (0–5)</th></tr></thead>
              <tbody>
                {crit.map((c) => (
                  <tr key={c.key} className="align-top">
                    <td className="td w-[30%]"><p className="font-semibold">{c.label}</p><p className="text-xs text-muted">{c.description}</p></td>
                    <td className="td w-28">
                      <input type="number" min={0} max={100} value={c.weight} aria-label={`${c.label} weight`}
                        onChange={(e) => setCriterion(c.key, { weight: Number(e.target.value) })} className="input w-20 py-1" />
                    </td>
                    <td className="td"><CriterionBands c={c} onChange={(bands) => setCriterion(c.key, { bands })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}

      <Card className="sticky bottom-3 space-y-3 p-4 shadow-lg">
        {problems.length > 0 && (
          <ul className="rounded bg-bad-soft px-3 py-2 text-sm text-bad">{problems.map((x) => <li key={x}>{x}</li>)}</ul>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.message}</p>}
        <div className="flex flex-wrap items-end gap-3">
          <button type="button" onClick={save} disabled={pending} className={btn.secondary}>Save draft and preview</button>
          <label className="min-w-[260px] flex-1 text-sm">
            <span className="label">What changed and why (required to activate)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="e.g. Sustainability pillar to 20% as agreed at the July alignment" />
          </label>
          <button type="button" onClick={activate} disabled={pending || problems.length > 0 || !note.trim()} className={btn.primary}>Activate version {m.version}</button>
        </div>
      </Card>
    </div>
  );
}
