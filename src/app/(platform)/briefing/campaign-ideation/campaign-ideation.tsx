"use client";

import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { btn, Card, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { BundleEcoSummary, CreativeSuggestionLabel, DemoNotice, EcoGradeBadge, EcoTagInline } from "@/components/briefing/labels";
import { CLIENT_OPTIONS, MARKETS, SPEC_TYPE_LABEL } from "@/lib/briefing";
import { createBriefFromSuggestions, runCampaignIdeation, type CampaignIdeationState } from "../actions";

export function CampaignIdeation() {
  const [form, setForm] = useState({ objective: "", client: "", brand: "", division: "", market: "" });
  const [result, setResult] = useState<CampaignIdeationState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const generate = () => start(async () => {
    setError(null); setSelected([]);
    const r = await runCampaignIdeation(form);
    if (!r.ok) { setError(r.message); return; }
    setResult(r);
  });
  const use = (ids: string[]) => start(async () => {
    if (!result?.sessionId) return;
    const r = await createBriefFromSuggestions(result.sessionId, ids);
    if (r && !r.ok) setError(r.message);
  });
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const suggestions = result?.suggestions ?? [];
  const picks = suggestions.filter((s) => selected.includes(s.concept_id));

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <Card className="grid gap-4 p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="label" htmlFor="ci-client">Client <span className="font-normal text-muted">(optional)</span></label>
            <input id="ci-client" className="input" list="ci-clients" value={form.client} onChange={(e) => set("client", e.target.value)} />
            <datalist id="ci-clients">{CLIENT_OPTIONS.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div><label className="label" htmlFor="ci-brand">Brand</label><input id="ci-brand" className="input" value={form.brand} onChange={(e) => set("brand", e.target.value)} /></div>
          <div><label className="label" htmlFor="ci-division">Division</label><input id="ci-division" className="input" value={form.division} onChange={(e) => set("division", e.target.value)} /></div>
          <div>
            <label className="label" htmlFor="ci-market">Market</label>
            <select id="ci-market" className="input" value={form.market} onChange={(e) => set("market", e.target.value)}>
              <option value="">Any</option>{MARKETS.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ci-objective">Campaign objective <span className="text-bad">*</span></label>
          <textarea id="ci-objective" rows={3} className="input" maxLength={2000} value={form.objective} onChange={(e) => set("objective", e.target.value)}
            placeholder="e.g. Drive trial of the zero-alcohol range in the top 50 GB stores this summer" />
        </div>
        <div className="flex justify-end">
          <button className={btn.primary} disabled={pending || !form.objective.trim()} onClick={generate}>
            <MSymbol name={pending ? "progress_activity" : "auto_awesome"} size={17} className={pending ? "animate-spin" : undefined} /> {pending ? "Thinking…" : "Generate shortlist"}
          </button>
        </div>
      </Card>

      {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{error}</p>}

      {result && (
        <>
          {result.demo && <DemoNotice />}
          {result.reply && <Card className="p-4 text-sm italic text-muted">{result.reply}</Card>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold">Suggested product types</h2>
              <p className="text-xs text-muted">Select one or more, then bundle them into a single draft brief. Nothing is created until you choose.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CreativeSuggestionLabel />
              <button className={btn.secondary} disabled={!selected.length || pending} onClick={() => use(selected)}><MSymbol name="add" size={17} /> Bundle & use{selected.length ? ` (${selected.length})` : ""}</button>
            </div>
          </div>
          {picks.length > 0 && <BundleEcoSummary ecos={picks.map((p) => p.eco)} />}
          {suggestions.length === 0 ? <Card className="p-6 text-sm text-muted">No suggestions came back. Try rephrasing the objective.</Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {suggestions.map((s) => {
                const on = selected.includes(s.concept_id);
                return (
                  <div key={s.concept_id} role="button" tabIndex={0} aria-pressed={on} onClick={() => toggle(s.concept_id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(s.concept_id); } }}
                    className={clsx("flex cursor-pointer flex-col gap-2 rounded-xl border border-dashed p-4 transition", on ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-warn/40 bg-surface hover:border-warn")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={on} readOnly tabIndex={-1} className="pointer-events-none mt-1" aria-hidden />
                        <div>
                          <p className="font-bold">{s.product_type_name}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {s.suggested_spec_type && <Pill>{SPEC_TYPE_LABEL[s.suggested_spec_type] ?? s.suggested_spec_type}</Pill>}
                            <EcoTagInline eco={s.eco} />
                          </div>
                        </div>
                      </div>
                      {s.client_history_match ? <Pill tone="ok"><MSymbol name="history" size={13} /> Used before</Pill> : <Pill tone="info"><MSymbol name="auto_awesome" size={13} /> New direction</Pill>}
                    </div>
                    <p className="text-sm text-muted">{s.rationale}</p>
                    <EcoGradeBadge eco={s.eco} />
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[0.7rem] text-muted">{s.product_type_id ? "In the touchpoint taxonomy" : "Not in the taxonomy yet"}</span>
                      <button className={btn.primary} disabled={pending} onClick={() => use([s.concept_id])}><MSymbol name="add" size={16} /> Use this</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
