import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { fmtDateTime } from "@/components/sourcing/bits";
import { createProgramme } from "./actions";

export const metadata: Metadata = { title: "Rate card programmes" };

type Programme = { id: string; code: string; name: string; year: number; market: string | null; currency: string; status: string; updated_at: string; fee_percent: number };
const TONE = { draft: "neutral", bidding: "info", review: "warn", approved: "ok", published: "ok" } as const;

// A year's rate cards are built here: items and quantity tiers, supplier bids, then the analysis that sets buy and sell prices.
export default async function Programmes() {
  await requireInternal();
  const supabase = await createClient();
  const [{ data }, counts] = await Promise.all([
    supabase.from("rate_card_programmes").select("id, code, name, year, market, currency, status, updated_at, fee_percent").order("year", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("rate_card_items").select("programme_id"),
  ]);
  const list = (data ?? []) as Programme[];
  const n = new Map<string, number>();
  for (const r of (counts.data ?? []) as { programme_id: string }[]) n.set(r.programme_id, (n.get(r.programme_id) ?? 0) + 1);

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: "Rate cards", href: "/sourcing/rate-cards" }, { label: "Programmes" }]} title="Rate card programmes"
        sub="Build a year's rate cards: define the items and quantity tiers, collect supplier bids, and let the analysis set buy and sell prices, savings and checks." />
      <Panel title="Programmes" sub={`${list.length} programme(s)`}>
        {list.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No programme yet. Create the first one below.</p> : (
          <ul className="divide-y divide-line text-sm">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span><Link className="font-semibold hover:text-accent" href={`/sourcing/rate-cards/programmes/${p.id}`}>{p.name}</Link> <span className="text-xs text-muted">{p.code} · {p.year}{p.market ? ` · ${p.market}` : ""} · {p.currency} · fee {Number(p.fee_percent)}% · {n.get(p.id) ?? 0} items · updated {fmtDateTime(p.updated_at)}</span></span>
                <Pill tone={TONE[p.status as keyof typeof TONE] ?? "neutral"}>{p.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Card className="p-5">
        <h2 className="mb-3 font-display text-lg font-semibold">New programme</h2>
        <ActionForm action={createProgramme} submit="Create the programme">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Name" htmlFor="name"><input id="name" name="name" required maxLength={120} placeholder="RC 2026 Vietnam" className="input" /></Field>
            <Field label="Year" htmlFor="year"><input id="year" name="year" type="number" min={2000} max={2100} defaultValue={new Date().getFullYear() + 1} className="input" /></Field>
            <Field label="Market" htmlFor="market" hint="Two-letter code. Optional."><input id="market" name="market" maxLength={2} className="input uppercase" /></Field>
            <Field label="Currency" htmlFor="currency"><input id="currency" name="currency" maxLength={3} defaultValue="EUR" className="input uppercase" /></Field>
            <Field label="Fee on top of the buy price (%)" htmlFor="fee_percent" hint="Sell price = buy price plus this fee."><input id="fee_percent" name="fee_percent" type="number" step="any" min={0} defaultValue={5} className="input" /></Field>
            <Field label="Prices rounded to (decimals)" htmlFor="price_decimals" hint="0 for VND, 2 for EUR."><input id="price_decimals" name="price_decimals" type="number" min={0} max={4} defaultValue={2} className="input" /></Field>
            <Field label="Cap outlier bids at (%)" htmlFor="cap_percent" hint="Bids further than this from the average are left out of the market average."><input id="cap_percent" name="cap_percent" type="number" step="any" min={1} defaultValue={50} className="input" /></Field>
            <Field label="Minimum coverage (%)" htmlFor="min_coverage_percent" hint="Share of last year's spend the programme must cover."><input id="min_coverage_percent" name="min_coverage_percent" type="number" step="any" min={0} max={100} defaultValue={61} className="input" /></Field>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
