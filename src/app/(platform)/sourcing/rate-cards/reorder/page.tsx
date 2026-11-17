import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/sourcing";
import { ButtonLink, Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { reorderFromCard } from "./actions";

export const metadata: Metadata = { title: "Reorder from a rate card" };

type Award = { supplier_id: string; supplier: string; share: number; buy: number; sell: number; ordered: number; deficit: number; suggested: boolean };
type Item = {
  item_id: string; programme_id: string; programme_code: string; programme_name: string; valid_from: string; valid_to: string; currency: string; subcode: string;
  product_type: string; product_code: string | null; channel: string; category: string | null; uom: string | null; qty_min: number | null; qty_max: number | null;
  spec_detail: string | null; awards: Award[];
};

// The approved price list: items with an accepted award, in date. Pick one, give a quantity, and the order goes to the awarded vendor at its price.
export default async function ReorderPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireInternal();
  const { q } = await searchParams;
  const supabase = await createClient();
  const [list, jobs, clients, markets] = await Promise.all([
    supabase.rpc("rate_card_price_list", { p_search: q ?? null, p_programme: null }),
    supabase.from("jobs").select("id, job_number, title, currency, status").in("status", ["open", "quoting"]).order("created_at", { ascending: false }).limit(200),
    supabase.from("sourcing_clients").select("id, name").eq("active", true).order("name"),
    supabase.from("markets").select("code, name").eq("active", true).order("name"),
  ]);
  const items = ((list.data as Item[] | null) ?? []);
  const J = (jobs.data ?? []) as { id: string; job_number: string; title: string; currency: string }[];
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: "Rate cards", href: "/sourcing/rate-cards" }, { label: "Reorder" }]} title="Reorder from a rate card"
        sub="Repeat work at a locked price. Pick an item and a quantity. The order goes to the awarded vendor at its price, with no RFQ. The client estimate, client PO and supplier PO approvals carry on as usual." />
      <form className="flex flex-wrap items-end gap-3" action="/sourcing/rate-cards/reorder">
        <div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={q ?? ""} placeholder="Product, code or category" className="input w-72 max-w-full" /></div>
        <button className="inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold" type="submit">Search</button>
        <ButtonLink href="/sourcing/rate-cards/programmes">Rate card programmes</ButtonLink>
      </form>
      <Panel title="Items you can reorder" sub={`${items.length} item(s). Only approved programmes in date, with a vendor that has accepted its award and is still eligible.`}>
        {items.length === 0 ? <p className="px-5 py-4 text-sm text-muted">{q ? "Nothing matches." : "Nothing is live yet. A rate card programme must be approved and accepted by its vendors."}</p> : (
          <ul className="divide-y divide-line">
            {items.map((i) => {
              const sug = i.awards.find((a) => a.suggested) ?? i.awards[0];
              return (
                <li key={i.item_id} className="space-y-3 px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p><b>{i.product_type}</b> <span className="font-mono text-xs text-muted">{i.subcode}</span> <span className="text-xs text-muted">{i.channel}{i.category ? ` · ${i.category}` : ""}</span></p>
                      <p className="text-xs text-muted">Quantity {i.qty_min == null ? "any" : Number(i.qty_min).toLocaleString("en-GB")} to {i.qty_max == null ? "no limit" : Number(i.qty_max).toLocaleString("en-GB")} {i.uom ?? ""} · {i.programme_name} ({i.programme_code}) · valid {fmtDate(i.valid_from)} to {fmtDate(i.valid_to)}</p>
                    </div>
                    <ul className="space-y-0.5 text-xs">
                      {i.awards.map((a) => (
                        <li key={a.supplier_id} className="tabular-nums"><b>{a.supplier}</b> {Number(a.share)}% · buy {money(a.buy, i.currency, 2)} · sell {money(a.sell, i.currency, 2)}{a.ordered ? ` · ${Number(a.ordered).toLocaleString("en-GB")} ordered` : ""} {a.suggested && i.awards.length > 1 && <Pill tone="info">Next in line</Pill>}</li>
                      ))}
                    </ul>
                  </div>
                  <details className="rounded-lg border border-line p-3">
                    <summary className="cursor-pointer font-semibold">Reorder this</summary>
                    <div className="mt-3">
                      <ActionForm action={reorderFromCard} hidden={{ item: i.item_id }} submit="Create the order line and estimate" variant="primary">
                        <div className="grid gap-3 md:grid-cols-3">
                          <Field label="Quantity" htmlFor={`q-${i.item_id}`} hint={`Within ${i.qty_min ?? 1} to ${i.qty_max ?? "no limit"}.`}><input id={`q-${i.item_id}`} name="quantity" type="number" min={1} required defaultValue={i.qty_min ?? 1} className="input" /></Field>
                          <Field label="Vendor" htmlFor={`v-${i.item_id}`} hint={i.awards.length > 1 ? "The system suggests the vendor furthest below its share." : undefined}>
                            <select id={`v-${i.item_id}`} name="supplier" defaultValue={sug?.supplier_id} className="input">{i.awards.map((a) => <option key={a.supplier_id} value={a.supplier_id}>{a.supplier} ({Number(a.share)}%){a.suggested ? " · suggested" : ""}</option>)}</select>
                          </Field>
                          {i.awards.length > 1 && <Field label="Why not the suggested vendor?" htmlFor={`r-${i.item_id}`} hint="Only needed if you change the vendor."><input id={`r-${i.item_id}`} name="reason" className="input" /></Field>}
                        </div>
                        <div className="grid gap-3 md:grid-cols-4">
                          <Field label="Add to a job" htmlFor={`j-${i.item_id}`} hint="Or leave blank and start a new job below."><select id={`j-${i.item_id}`} name="job" className="input"><option value="">New job</option>{J.filter((x) => x.currency === i.currency).map((x) => <option key={x.id} value={x.id}>{x.job_number} · {x.title}</option>)}</select></Field>
                          <Field label="New job: client" htmlFor={`c-${i.item_id}`}><select id={`c-${i.item_id}`} name="client" className="input"><option value="">Choose</option>{((clients.data ?? []) as { id: string; name: string }[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                          <Field label="New job: market" htmlFor={`m-${i.item_id}`}><select id={`m-${i.item_id}`} name="market" className="input"><option value="">Choose</option>{((markets.data ?? []) as { code: string; name: string }[]).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
                          <Field label="New job: title" htmlFor={`t-${i.item_id}`}><input id={`t-${i.item_id}`} name="title" defaultValue={`${i.product_type} reorder`} className="input" /></Field>
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Card className="px-5 py-3 text-sm text-muted">The reorder makes a job line, an Adopt decision and a draft estimate at the vendor&apos;s buy price plus the programme fee. Prices are in the programme&apos;s currency, so a job must be in the same currency.</Card>
    </>
  );
}
