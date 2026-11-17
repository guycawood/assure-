"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { confirmCreativePo, kickoffCreative, saveCreativeQuote, sendCreativeQuote, type ActionResult } from "../actions";

// Creative work needed (Global Business Transformation): cr3 on a retainer?, cr4 kick off with no quote, cr5 the quote,
// cr6/cr9 the client's decision and reason, cr7 confirm the approval and the client PO. Creative work starts after cr4 or cr7.

export type QuoteView = {
  basis: "fixed" | "hourly" | "daily"; rate: number | null; units: number | null; amount: number; currency: string; scope_note: string | null;
  status: "draft" | "sent" | "approved" | "rejected"; version: number; reject_reason: string | null; client_po_number: string | null; po_confirmed_at: string | null;
};

const BASIS = { fixed: "Fixed fee", hourly: "Hourly rate", daily: "Daily rate" } as const;
const money = (n: number, c: string) => `${c} ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CommercialsPanel({ id, open, onRetainer, kickoffAt, kickoffNote, quote }: {
  id: string; open: boolean; onRetainer: boolean; kickoffAt: string | null; kickoffNote: string | null; quote: QuoteView | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [basis, setBasis] = useState<"fixed" | "hourly" | "daily">(quote?.basis ?? "fixed");
  const [rate, setRate] = useState(quote?.rate != null ? String(quote.rate) : "");
  const [units, setUnits] = useState(quote?.units != null ? String(quote.units) : "");
  const [amount, setAmount] = useState(quote && quote.basis === "fixed" ? String(quote.amount) : "");
  const [currency, setCurrency] = useState(quote?.currency ?? "EUR");
  const [scope, setScope] = useState(quote?.scope_note ?? "");
  const [note, setNote] = useState("");
  const [po, setPo] = useState(quote?.client_po_number ?? "");
  const run = (fn: () => Promise<ActionResult>) => start(async () => { const r = await fn(); setRes(r); if (r.ok) router.refresh(); });
  const total = basis === "fixed" ? Number(amount) : Number(rate) * Number(units);
  const started = !!kickoffAt || !!quote?.po_confirmed_at;
  const editable = open && (!quote || quote.status === "draft" || quote.status === "rejected");

  return (
    <Panel title="Creative commercials" sub="Retainer clients start with a kick-off. Everyone else gets a quote the client approves, with its PO, before creative work starts."
      actions={started ? <Pill tone="ok">Creative work can start</Pill> : <Pill tone="warn">Not started</Pill>}>
      <div className="space-y-4 p-5 text-sm">
        {onRetainer ? (
          <div className="rounded-lg border border-line p-3">
            <p className="font-semibold">Client on a retainer <Pill tone="accent">No quote needed</Pill></p>
            {kickoffAt ? <p className="text-muted">Kicked off on {new Date(kickoffAt).toLocaleDateString("en-GB")}.{kickoffNote ? ` ${kickoffNote}` : ""}</p> : open && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label className="label" htmlFor="kick-note">Kick-off note (optional)</label>
                  <input id="kick-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <button className={btn.primary} disabled={pending} onClick={() => run(() => kickoffCreative(id, note))}><MSymbol name="rocket_launch" size={16} /> Kick off, no quote</button>
              </div>
            )}
          </div>
        ) : (
          <>
            {quote && (
              <div className="rounded-lg border border-line bg-surface-2/60 p-3">
                <p className="font-semibold">
                  {money(quote.amount, quote.currency)} · {BASIS[quote.basis]}{quote.basis !== "fixed" && quote.rate != null ? ` (${quote.units} × ${quote.rate})` : ""}{" "}
                  <Pill tone={quote.status === "approved" ? "ok" : quote.status === "rejected" ? "bad" : quote.status === "sent" ? "info" : "neutral"}>
                    {{ draft: "Draft", sent: "With the client", approved: "Approved by the client", rejected: "Rejected by the client" }[quote.status]}
                  </Pill>
                </p>
                {quote.scope_note && <p className="text-muted">{quote.scope_note}</p>}
                {quote.status === "rejected" && <p className="mt-1 text-bad">The client said: {quote.reject_reason}</p>}
                {quote.status === "draft" && open && (
                  <button className={`${btn.primary} mt-2`} disabled={pending} onClick={() => run(() => sendCreativeQuote(id))}><MSymbol name="send" size={16} /> Send to the client</button>
                )}
                {quote.status === "approved" && !quote.po_confirmed_at && open && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="min-w-48 flex-1">
                      <label className="label" htmlFor="po">Client PO number</label>
                      <input id="po" className="input" value={po} onChange={(e) => setPo(e.target.value)} placeholder="From the client's approval or their PO" />
                    </div>
                    <button className={btn.primary} disabled={pending} onClick={() => run(() => confirmCreativePo(id, po))}><MSymbol name="verified" size={16} /> Confirm approval and PO</button>
                  </div>
                )}
                {quote.po_confirmed_at && <p className="mt-1 text-muted">Client PO {quote.client_po_number} confirmed on {new Date(quote.po_confirmed_at).toLocaleDateString("en-GB")}.</p>}
              </div>
            )}

            {editable && (
              <details open={!quote}>
                <summary className="cursor-pointer font-semibold text-accent">{quote ? "Revise the quote" : "Write the creative quote"}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <div>
                    <label className="label" htmlFor="q-basis">Quoting basis</label>
                    <select id="q-basis" className="input" value={basis} onChange={(e) => setBasis(e.target.value as "fixed" | "hourly" | "daily")}>
                      {Object.entries(BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  {basis === "fixed" ? (
                    <div className="sm:col-span-2">
                      <label className="label" htmlFor="q-amount">Amount</label>
                      <input id="q-amount" type="number" min="0" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                  ) : (
                    <>
                      <div><label className="label" htmlFor="q-rate">Rate per {basis === "hourly" ? "hour" : "day"}</label><input id="q-rate" type="number" min="0" step="0.01" className="input" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
                      <div><label className="label" htmlFor="q-units">{basis === "hourly" ? "Hours" : "Days"}</label><input id="q-units" type="number" min="0" step="0.5" className="input" value={units} onChange={(e) => setUnits(e.target.value)} /></div>
                    </>
                  )}
                  <div><label className="label" htmlFor="q-cur">Currency</label><input id="q-cur" maxLength={3} className="input uppercase" value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
                  <div className="sm:col-span-4"><label className="label" htmlFor="q-scope">What the quote covers</label><textarea id="q-scope" rows={2} className="input" value={scope} onChange={(e) => setScope(e.target.value)} /></div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <button className={btn.secondary} disabled={pending} onClick={() => run(() => saveCreativeQuote(id, { basis, rate, units, amount, currency, scope_note: scope }))}><MSymbol name="save" size={16} /> Save quote</button>
                  {Number.isFinite(total) && total > 0 && <span className="text-muted">Total {money(total, currency.toUpperCase() || "EUR")}</span>}
                </div>
              </details>
            )}
          </>
        )}
        {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
      </div>
    </Panel>
  );
}
