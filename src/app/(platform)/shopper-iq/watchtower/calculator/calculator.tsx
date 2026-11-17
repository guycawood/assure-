"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { DE_ANSWERS, DE_ASSET_TYPES, scoreDesign, type DeAssetType, type DeCriterion, type DeInput, type DeSettings } from "@/lib/design-effectiveness";
import { letterFor } from "@/lib/pef";

type Letter = { letter: string; minScore: number; label: string; confirmed: boolean };
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(1)}%`);
const GROUPS = [["attract", "Attract"], ["engage", "Engage"], ["sell", "Sell"], ["sustainability", "Sustainability"]] as const;

export function DesignCalculator({ criteria, settings, specs, letters, presets }: {
  criteria: DeCriterion[]; settings: DeSettings; specs: { id: string; title: string; impactGrade: number }[]; letters: Letter[];
  presets: { code: string; label: string; input: DeInput }[];
}) {
  const [assetType, setAssetType] = useState<DeAssetType>("posm");
  const [answers, setAnswers] = useState<DeInput["answers"]>({});
  const [source, setSource] = useState<"spec" | "manual" | "none">("manual");
  const [specId, setSpecId] = useState("");
  const [manual, setManual] = useState<string>("");
  const spec = specs.find((s) => s.id === specId);
  const impactGrade = source === "spec" ? spec?.impactGrade ?? null : source === "manual" && manual.trim() !== "" ? Math.min(100, Math.max(0, Number(manual))) : null;
  const r = useMemo(() => scoreDesign({ assetType, impactGrade, answers }, criteria, settings), [assetType, impactGrade, answers, criteria, settings]);
  const letter = letterFor(impactGrade, letters);
  const s11 = criteria.find((c) => c.code === "S11");

  function loadPreset(code: string) {
    const p = presets.find((x) => x.code === code);
    if (!p) return;
    setAssetType(p.input.assetType); setAnswers(p.input.answers);
    if (p.input.impactGrade !== null) { setSource("manual"); setManual(String(p.input.impactGrade)); } else setSource("none");
  }
  const setAnswer = (code: string, answer: string) => setAnswers((a) => ({ ...a, [code]: { ...a[code], answer } }));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <Card className="grid gap-3 p-5 text-sm sm:grid-cols-3">
          <label><span className="label">Start from</span>
            <select className="input" defaultValue="" onChange={(e) => (e.target.value ? loadPreset(e.target.value) : setAnswers({}))}>
              <option value="">Blank</option>{presets.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select></label>
          <label><span className="label">Asset type</span>
            <select className="input" value={assetType} onChange={(e) => setAssetType(e.target.value as DeAssetType)}>
              {DE_ASSET_TYPES.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select></label>
          <div className="text-xs text-muted sm:pt-6">{r.lines.filter((l) => l.applies).length} criteria apply to this asset type.</div>
        </Card>

        <Card className="space-y-3 p-5 text-sm">
          <h3 className="flex items-center gap-2 font-bold"><MSymbol name="eco" size={18} /> Impact Grade for S11 (measured footprint)</h3>
          {!s11?.appliesTo[assetType] && <p className="text-xs text-muted">S11 does not apply to this asset type, so the Impact Grade does not change the score.</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="label">Source</span>
              <select className="input" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="spec">From a spec</option><option value="manual">Enter by hand (assumed)</option><option value="none">Not known yet</option>
              </select></label>
            {source === "spec" && (
              <label className="sm:col-span-2"><span className="label">Spec</span>
                <select className="input" value={specId} onChange={(e) => setSpecId(e.target.value)}>
                  <option value="">Choose a spec with an Impact Grade</option>
                  {specs.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.impactGrade}</option>)}
                </select></label>
            )}
            {source === "manual" && (
              <label><span className="label">Impact Grade (0-100)</span><input className="input" type="number" min={0} max={100} value={manual} onChange={(e) => setManual(e.target.value)} /></label>
            )}
            {impactGrade !== null && (
              <div className="sm:pt-6">
                <Pill tone={source === "spec" ? "ok" : "warn"}>{letter?.letter ?? "–"} · {impactGrade} {source === "spec" ? "(from spec)" : "(assumed)"}</Pill>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">The Impact Grade is built from the PEF score in the <Link className="text-accent hover:underline" href="/impact-grade/watchtower">Impact Grade Watchtower</Link>. S11 credit = grade ÷ 100.</p>
        </Card>

        {GROUPS.map(([key, label]) => {
          const list = criteria.filter((c) => c.pillar === key && c.appliesTo[assetType]);
          if (!list.length) return null;
          return (
            <Panel key={key} title={`${label} (${list.length})`}>
              <ul className="divide-y divide-line">
                {list.map((c) => (
                  <li key={c.code} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="w-9 font-mono text-xs font-bold">{c.code}</span>
                    <span className="min-w-[14rem] flex-1"><span className="font-semibold">{c.name}</span> <span className="text-xs text-muted">· {c.weight}</span>
                      {c.highScore && <span className="block text-xs text-muted">{c.highScore}</span>}</span>
                    {c.input === "impact_grade" ? (
                      <Pill tone={impactGrade === null ? "neutral" : "ok"}>{impactGrade === null ? "Unknown" : `${(impactGrade / 100).toFixed(2)} from Impact Grade`}</Pill>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {DE_ANSWERS.map((a) => (
                          <button key={a} type="button" onClick={() => setAnswer(c.code, a)}
                            className={`rounded-md border px-2 py-1 text-xs font-semibold ${answers[c.code]?.answer === a ? "border-accent bg-accent text-accent-fg" : "border-line hover:bg-surface-2"}`}>{a}</button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>

      <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card className="p-5">
          <p className="eyebrow">Overall effectiveness</p>
          <p className="mt-1 font-display text-[2.2rem] font-bold leading-none tabular-nums">{pct(r.overall)}</p>
          <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {r.band ? <Pill tone={r.band.confirmed ? "info" : "warn"}>{r.band.name}{r.band.confirmed ? "" : " (proposed bands)"}</Pill> : null}
            <Pill tone={r.valid ? "ok" : "warn"}>{r.valid ? "Valid" : "Incomplete: answer more criteria"}</Pill>
          </p>
        </Card>
        <Card className="p-5 text-sm">
          <table className="w-full">
            <tbody>
              {[["Design score", r.design], ["  Attract points", r.attract], ["  Engage points", r.engage], ["  Sell points", r.sell], ["Sustainability sub-score", r.sustainability]].map(([k, v]) => (
                <tr key={String(k)}><td className={`py-1 ${String(k).startsWith("  ") ? "pl-3 text-muted" : "font-semibold"}`}>{String(k).trim()}</td><td className="py-1 text-right tabular-nums">{pct(v as number | null)}</td></tr>
              ))}
              <tr><td className="pt-2 text-xs text-muted">Overall = {(1 - settings.sustainabilityWeight) * 100}% design + {settings.sustainabilityWeight * 100}% sustainability</td><td /></tr>
            </tbody>
          </table>
        </Card>
        <Card className="p-5 text-sm">
          <p className="eyebrow mb-1">Coverage (minimum {(settings.minCoverage * 100).toFixed(0)}%)</p>
          <p>Design {pct(r.coverageDesign)} · Sustainability {pct(r.coverageSustainability)}</p>
          <p className="mt-1 text-xs text-muted">Counted weight {r.weights.designCounted} of {r.weights.designApplicable} (design), {r.weights.sustCounted} of {r.weights.sustApplicable} (sustainability).</p>
        </Card>
      </div>
    </div>
  );
}
