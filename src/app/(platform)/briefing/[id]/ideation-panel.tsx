"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { btn, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ConceptCard } from "@/components/briefing/concept-card";
import { CreativeSuggestionLabel, DemoNotice } from "@/components/briefing/labels";
import { DEFAULT_PARAMS, PARAM_LABEL, PARAM_OPTIONS, type ConceptRow, type CreativeParams, type MessageRow } from "@/lib/briefing";
import { runBriefIdeation, sendToSourcing, type ActionResult } from "../actions";

export function IdeationPanel({ briefId, open, demo, messages, concepts, sentConceptIds, initialParams }: {
  briefId: string; open: boolean; demo: boolean; messages: MessageRow[]; concepts: ConceptRow[]; sentConceptIds: string[];
  initialParams?: Partial<CreativeParams>;
}) {
  const router = useRouter();
  const [params, setParams] = useState<CreativeParams>({ ...DEFAULT_PARAMS, ...initialParams });
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const lastDemo = concepts.some((c) => c.demo) || (demo && concepts.length === 0);

  const run = (direction: string, fresh = false) => start(async () => {
    setRes(null);
    const r = await runBriefIdeation(briefId, { direction, params, fresh });
    setRes(r.ok && !r.message.startsWith("Demo") ? null : r);
    if (r.ok) { setInput(""); router.refresh(); }
  });
  const send = (conceptId: string) => {
    const note = window.prompt("Anything Sourcing+ should know about this concept? (optional)");
    if (note === null) return;
    setSending(conceptId);
    start(async () => { const r = await sendToSourcing(conceptId, note); setRes(r); setSending(null); if (r.ok) router.refresh(); });
  };

  if (!open) {
    return (
      <Panel title="Ideation" sub="AI concepts from the brief and the approved substrate library">
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted"><MSymbol name="lock" size={18} /> Ideation and hand-off to Sourcing+ open once a colleague has approved this brief.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Ideation" sub="Claude reads the brief, the approved substrates and what worked before, then proposes 2–3 buildable concepts. Refine in plain English."
      actions={<CreativeSuggestionLabel />}>
      <div className="space-y-4 p-5">
        {lastDemo && <DemoNotice />}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
          {(["innovation", "sustainability", "budget"] as const).map((k) => (
            <div key={k} className="min-w-[160px] flex-1">
              <label className="label" htmlFor={`p-${k}`}>{PARAM_LABEL[k]}</label>
              <select id={`p-${k}`} className="input" value={params[k]} onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))}>
                {PARAM_OPTIONS[k].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
          <button className={concepts.length ? btn.secondary : btn.primary} disabled={pending} onClick={() => run("", concepts.length > 0)}>
            <MSymbol name={concepts.length ? "refresh" : "auto_awesome"} size={17} /> {pending ? "Thinking…" : concepts.length ? "Start again with these settings" : "Generate concepts"}
          </button>
        </div>

        {messages.length > 0 && (
          <ol className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-label="Conversation">
            {messages.map((m) => (
              <li key={m.id} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <p className={clsx("max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm", m.role === "user" ? "bg-accent text-accent-fg" : "border border-line bg-surface-2")}>{m.content}</p>
              </li>
            ))}
          </ol>
        )}
        {pending && <p className="flex items-center gap-2 text-sm text-muted"><MSymbol name="progress_activity" size={18} className="animate-spin" /> Reading the brief, substrates and history…</p>}

        {concepts.length > 0 && (
          <div>
            <p className="eyebrow mb-2">Spec-direction concepts · {concepts[0].demo ? "demo rules" : concepts[0].model} · {concepts[0].prompt_version}</p>
            <div className="grid gap-3 lg:grid-cols-3">
              {concepts.map((c) => {
                const sent = sentConceptIds.includes(c.id);
                return (
                  <ConceptCard key={c.id} concept={c.data} top={c.is_top}
                    actions={sent ? <Pill tone="ok"><MSymbol name="check" size={13} /> Sent to Sourcing+</Pill> : (
                      <button className={clsx(btn.primary, "w-full")} disabled={pending} onClick={() => send(c.id)}>
                        <MSymbol name="send" size={16} /> {sending === c.id ? "Sending…" : "Send to Sourcing+"}
                      </button>
                    )} />
                );
              })}
            </div>
          </div>
        )}

        {concepts.length > 0 && (
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (input.trim()) run(input.trim()); }}>
            <div className="flex-1">
              <label className="label" htmlFor="direction">Refine the direction</label>
              <textarea id="direction" rows={2} className="input" value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000}
                placeholder="e.g. make it shelf-ready and fully recyclable, keep it under budget" />
            </div>
            <button type="submit" className={btn.primary} disabled={pending || !input.trim()}><MSymbol name="send" size={17} /> Send</button>
          </form>
        )}
        {res && <p className={res.ok ? "text-sm text-ok" : "text-sm text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
      </div>
    </Panel>
  );
}
