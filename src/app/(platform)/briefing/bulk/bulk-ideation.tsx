"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn, Card, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ConceptCard } from "@/components/briefing/concept-card";
import { CreativeSuggestionLabel, DemoNotice } from "@/components/briefing/labels";
import { DEFAULT_PARAMS, PARAM_LABEL, PARAM_OPTIONS, type ConceptRow, type CreativeParams } from "@/lib/briefing";
import { runBulkOne, startBulkRun } from "../actions";

type Eligible = { id: string; title: string; brief_code: string; client: string | null; brand: string | null; market: string | null };
type Column = { state: "queued" | "running" | "done" | "error"; message?: string };

const CONCURRENCY = 3;

export function BulkIdeation({ eligible, saved, savedRunAt }: { eligible: Eligible[]; saved: Record<string, ConceptRow[]>; savedRunAt: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [params, setParams] = useState<CreativeParams>(DEFAULT_PARAMS);
  const [cols, setCols] = useState<Record<string, Column>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function run() {
    if (!selected.length || running) return;
    setRunning(true); setError(null);
    const start = await startBulkRun(selected, params);
    if (!start.ok || !start.runId) { setError(start.message); setRunning(false); return; }
    const queue = [...selected];
    setCols(Object.fromEntries(queue.map((id) => [id, { state: "queued" }])));
    // Bounded concurrency: at most three briefs are with the model at once.
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        setCols((c) => ({ ...c, [id!]: { state: "running" } }));
        try {
          const r = await runBulkOne(start.runId!, id, params);
          setCols((c) => ({ ...c, [id!]: r.ok ? { state: "done" } : { state: "error", message: r.message } }));
        } catch (e) {
          setCols((c) => ({ ...c, [id!]: { state: "error", message: (e as Error).message } }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setRunning(false);
    router.refresh();
  }

  const shownIds = Object.keys(cols).length ? Object.keys(cols) : Object.keys(saved);
  const anyDemo = Object.values(saved).flat().some((c) => c.demo);

  if (!eligible.length && !Object.keys(saved).length) {
    return <Card className="p-8 text-sm text-muted">No approved briefs yet. Ideation opens once a brief has been approved by a colleague.</Card>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Approved briefs <span className="font-normal text-muted">({selected.length} selected)</span></p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="text-xs font-semibold text-accent hover:underline" onClick={() => setSelected(eligible.map((b) => b.id))}>Select all</button>
            <button className="text-xs font-semibold text-muted hover:underline" onClick={() => setSelected([])}>Clear</button>
            <button className={btn.primary} disabled={!selected.length || running} onClick={run}>
              <MSymbol name={running ? "progress_activity" : "auto_awesome"} size={17} className={running ? "animate-spin" : undefined} /> {running ? "Ideating…" : `Ideate ${selected.length || ""}`}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 border-b border-line bg-surface-2/60 px-4 py-3">
          {(["innovation", "sustainability", "budget"] as const).map((k) => (
            <label key={k} className="min-w-[150px] flex-1 text-xs">
              <span className="label">{PARAM_LABEL[k]}</span>
              <select className="input" value={params[k]} onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))}>{PARAM_OPTIONS[k].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </label>
          ))}
        </div>
        <ul className="max-h-64 divide-y divide-line overflow-y-auto">
          {eligible.map((b) => (
            <li key={b.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface-2/70">
                <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{b.title}</span><span className="text-xs text-muted">{b.brief_code} · {[b.client, b.brand, b.market].filter(Boolean).join(" · ")}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </Card>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}

      {shownIds.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{Object.keys(cols).length ? "This run" : `Last saved run${savedRunAt ? ` · ${new Date(savedRunAt).toLocaleString("en-GB")}` : ""}`}</p>
            <CreativeSuggestionLabel />
          </div>
          {anyDemo && <DemoNotice />}
          <div className="flex gap-4 overflow-x-auto pb-4">
            {shownIds.map((id) => {
              const b = eligible.find((x) => x.id === id);
              const col = cols[id];
              const concepts = col?.state === "done" || !col ? saved[id] ?? [] : [];
              return (
                <div key={id} className="w-[340px] shrink-0 space-y-2">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <div className="min-w-0"><p className="truncate text-sm font-bold">{b?.title ?? "Brief"}</p><p className="truncate text-xs text-muted">{b ? [b.client, b.brand, b.market].filter(Boolean).join(" · ") : ""}</p></div>
                    <Link href={`/briefing/${id}`} className="text-muted hover:text-fg" title="Open brief"><MSymbol name="open_in_new" size={17} /></Link>
                  </div>
                  {col?.state === "queued" && <Card className="p-6 text-center text-xs text-muted">Waiting in the queue…</Card>}
                  {col?.state === "running" && <Card className="flex items-center justify-center gap-2 p-6 text-xs text-muted"><MSymbol name="progress_activity" size={17} className="animate-spin" /> Ideating…</Card>}
                  {col?.state === "error" && <Card className="p-4 text-xs text-bad">{col.message}</Card>}
                  {col?.state === "done" && !concepts.length && <Card className="p-4 text-xs text-muted">Saved. Refreshing…</Card>}
                  {concepts.map((c) => <ConceptCard key={c.id} concept={c.data} top={c.is_top} compact actions={<Link href={`/briefing/${id}`} className="text-xs font-semibold text-accent hover:underline">Open the brief to refine or send to Sourcing+ →</Link>} />)}
                  {!col && !concepts.length && <Pill>No concepts</Pill>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
