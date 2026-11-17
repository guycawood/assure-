import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SPEC_TYPES } from "@/lib/sourcing";
import { btn, Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { dismissOpportunity, restoreOpportunity } from "./actions";

export const metadata: Metadata = { title: "Rate card opportunities" };

type Opp = {
  key: string; example: string; title_key: string; len_mm: number | null; wid_mm: number | null; spec_type: string; substrate: string | null; substrate_code: string | null; currency: string;
  orders: number; jobs: number; clients: number; suppliers: number; qty: number; qty_min: number; qty_max: number; spend: number; avg_cost: number;
  min_cost: number; max_cost: number; spread_pct: number | null; last_at: string; card_share_pct: number; open_request: boolean; dismissed: boolean; dismissed_reason: string | null;
};

// Where the next rate card is worth building: what has actually been bought repeatedly, and what is not yet priced from a rate card.
export default async function Opportunities({ searchParams }: { searchParams: Promise<{ months?: string; min?: string; q?: string; dismissed?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const months = Math.min(60, Math.max(1, Number(sp.months) || 12));
  const min = Math.max(1, Number(sp.min) || 3);
  const showDismissed = sp.dismissed === "1";
  const supabase = await createClient();
  const { data } = await supabase.rpc("rate_card_opportunities", { p_months: months, p_min_orders: min, p_search: sp.q || null, p_include_dismissed: showDismissed });
  const list = (data as Opp[] | null) ?? [];
  const num = (n: number, d = 0) => Number(n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const typeLabel = (t: string) => SPEC_TYPES.find((s) => s.value === t)?.label ?? t;
  const reqHref = (o: Opp) => {
    const why = `Bought ${o.orders} times in ${months} months across ${o.jobs} job(s) and ${o.clients} client(s), ${o.currency} ${num(o.spend)} in total. Prices ranged ${num(o.min_cost, 2)} to ${num(o.max_cost, 2)} per unit${o.card_share_pct ? ` and ${o.card_share_pct}% was already priced from a rate card` : ""}.`;
    const p = new URLSearchParams({ title: o.example.replace(/\s*\([^)]*\)/g, "").trim(), type: o.spec_type, min: String(o.qty_min), max: String(o.qty_max), why, ...(o.substrate_code ? { substrate: o.substrate_code } : {}) });
    return `/briefing/new/rate-card/request?${p.toString()}`;
  };

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: "Rate cards", href: "/sourcing/rate-cards" }, { label: "Opportunities" }]} title="Rate card opportunities"
        sub="Repeat purchases that are not yet priced from a rate card, biggest spend first. Items are grouped by type, material and name, in one currency." />
      <Card className="p-4">
        <form action="/sourcing/rate-cards/opportunities" className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="months">Look back (months)</label><input id="months" name="months" type="number" min={1} max={60} defaultValue={months} className="input w-28" /></div>
          <div><label className="label" htmlFor="min">At least (orders)</label><input id="min" name="min" type="number" min={1} defaultValue={min} className="input w-28" /></div>
          <div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Name or material" className="input w-60" /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="dismissed" value="1" defaultChecked={showDismissed} /> Show dismissed</label>
          <button className={btn.secondary} type="submit">Update</button>
        </form>
      </Card>
      <Panel title="Candidates" sub={`${list.length} group(s). Only priced estimates that were not declined count. A group mostly priced from a rate card (80% or more) is left out.`}>
        {list.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing matches. Try a longer look-back or fewer orders.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Item", "Bought", "Spend", "Price per unit", "Reach", "On a rate card", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.key} className="align-top">
                    <td className="td"><b>{o.example.replace(/\s*\([^)]*\)/g, "")}</b><div className="text-xs text-muted">{typeLabel(o.spec_type)}{o.substrate ? ` · ${o.substrate}` : ""}{o.len_mm && o.wid_mm ? ` · about ${num(o.len_mm)} × ${num(o.wid_mm)} mm` : ""}</div>
                      {o.dismissed && <div className="mt-1"><Pill tone="neutral">Dismissed</Pill> <span className="text-xs text-muted">{o.dismissed_reason}</span></div>}
                      {o.open_request && <div className="mt-1"><Pill tone="info">Request open</Pill></div>}</td>
                    <td className="td tabular-nums">{o.orders} orders<div className="text-xs text-muted">{num(o.qty)} units, {num(o.qty_min)} to {num(o.qty_max)} each · last {new Date(o.last_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div></td>
                    <td className="td tabular-nums">{o.currency} {num(o.spend)}</td>
                    <td className="td tabular-nums">{num(o.min_cost, 2)} to {num(o.max_cost, 2)}<div className="text-xs text-muted">average {num(o.avg_cost, 2)}{o.spread_pct != null ? ` · ${o.spread_pct}% spread` : ""}</div></td>
                    <td className="td text-xs">{o.jobs} job(s)<br />{o.clients} client(s)<br />{o.suppliers} vendor(s)</td>
                    <td className="td tabular-nums">{o.card_share_pct}%</td>
                    <td className="td">
                      <div className="flex flex-col items-start gap-2">
                        {!o.dismissed && !o.open_request && <Link href={reqHref(o)} className={btn.primary}>Start a request</Link>}
                        {o.dismissed ? (
                          <ActionForm action={restoreOpportunity} hidden={{ key: o.key }} submit="Bring back" variant="secondary" inline />
                        ) : (
                          <details>
                            <summary className="cursor-pointer text-xs text-accent">Dismiss</summary>
                            <ActionForm action={dismissOpportunity} hidden={{ key: o.key, label: o.example }} submit="Dismiss" variant="secondary" className="mt-2 w-56">
                              <input name="reason" required aria-label="Why dismiss" placeholder="Why not worth a card" className="input py-1.5" />
                            </ActionForm>
                          </details>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
