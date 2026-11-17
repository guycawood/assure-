import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/sourcing";
import { btn, ButtonLink, Card, PageHead, Panel } from "@/components/ui";
import { ImpactGradeBadge } from "@/components/impact-grade/grade-badge";
import { Td, Th } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "Existing rate card" };

type CardRow = {
  id: string; code: string; name: string; spec_type: string | null; length_mm: string | null; width_mm: string | null; min_qty: string | null; max_qty: string | null;
  unit_price: string | null; currency: string | null; client_code: string | null; supplier_name: string | null; selectable: boolean;
  grade: { score: number | null; confidence: number | null } | null;
};

// The approved rate cards. Choosing one skips concepts and the RFQ: the brief, job and spec are created at once.
export default async function PickRateCard({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireInternal();
  const { q } = await searchParams;
  const supabase = await createClient();
  const all = ((await supabase.rpc("sourcing_rate_cards")).data as CardRow[] | null) ?? [];
  const term = (q ?? "").trim().toLowerCase();
  const list = all.filter((c) => c.selectable && (!term || `${c.name} ${c.code} ${c.supplier_name ?? ""} ${c.client_code ?? ""}`.toLowerCase().includes(term)))
    .sort((a, b) => (b.grade?.score ?? 0) - (a.grade?.score ?? 0));

  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "New brief", href: "/briefing/new" }, { label: "Existing rate card" }]} title="Existing rate card"
        sub="Pick an approved card for repeat work. If the size and quantity fit, it is Adopt: no concepts and no RFQ. A small change in size is Adapt." />
      <form className="flex flex-wrap items-end gap-3" action="/briefing/new/rate-card">
        <div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={q ?? ""} placeholder="Name, code, supplier or client" className="input w-72 max-w-full" /></div>
        <button className={btn.secondary} type="submit">Search</button>
        <ButtonLink href="/briefing/new">None of these: new brief</ButtonLink>
      </form>
      <Panel title="Approved rate cards" sub={`${list.length} card(s). Only cards with a reviewed Impact Grade and an eligible supplier are shown.`}>
        {list.length === 0 ? (
          <div className="space-y-2 px-5 py-4 text-sm"><p className="text-muted">No approved card matches. Request a new card, or start a normal brief so the work goes to an RFQ.</p>
            <Link className="font-semibold text-accent hover:underline" href="/briefing/new">Start a new brief</Link></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Card</Th><Th>Supplier</Th><Th>Size and quantity</Th><Th>Price</Th><Th>Impact Grade</Th><Th><span className="sr-only">Use</span></Th></tr></thead>
              <tbody className="divide-y divide-line">
                {list.map((c) => (
                  <tr key={c.id}>
                    <Td><b>{c.name}</b><br /><span className="text-xs text-muted">{c.code}{c.client_code ? ` · ${c.client_code} only` : ""}</span></Td>
                    <Td>{c.supplier_name}</Td>
                    <Td className="tabular-nums">{c.length_mm && c.width_mm ? `${c.length_mm} × ${c.width_mm} mm` : "No size"}<br /><span className="text-xs text-muted">{c.min_qty ?? 0} to {c.max_qty ?? "no limit"}</span></Td>
                    <Td className="tabular-nums">{c.unit_price ? money(Number(c.unit_price), c.currency ?? "EUR", 2) : "No price"}</Td>
                    <Td><ImpactGradeBadge score={c.grade?.score} /><p className="text-xs text-muted">{c.grade?.confidence ?? 0}% confidence</p></Td>
                    <Td><ButtonLink href={`/briefing/new/rate-card/${c.id}`} variant="primary">Use this card</ButtonLink></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
        <span className="text-muted">Can&apos;t find the card you need? Ask the sourcing team to build one, or start a new brief.</span>
        <ButtonLink href={`/briefing/new/rate-card/request${term ? `?title=${encodeURIComponent(q ?? "")}` : ""}`} variant="primary">Request a new rate card</ButtonLink>
      </Card>
    </>
  );
}
