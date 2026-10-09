import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { moduleByKey, type ModuleKey } from "@/modules/registry";
import { Card, Empty, PageHead } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Search" };

type Hit = { module: ModuleKey; kind: string; title: string; sub: string; href: string };

// Search across every module. Each source is read with the signed-in user's permissions (RLS), then matched here.
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string; ask?: string }> }) {
  await requireInternal();
  const { q = "", ask } = await searchParams;
  const term = q.trim().toLowerCase();
  const supabase = await createClient();
  const hits: Hit[] = [];

  if (term.length >= 2) {
    const has = (...v: (string | null | undefined)[]) => v.some((x) => x && x.toLowerCase().includes(term));
    const [sup, briefs, camps, jobs, rfqs, pos, libs, outlets] = await Promise.all([
      supabase.from("suppliers").select("id, name, supplier_code, market, region").limit(2000),
      supabase.from("briefs").select("id, title, brief_code, market, status").limit(2000),
      supabase.from("campaigns").select("id, name, campaign_code").limit(2000),
      supabase.from("jobs").select("id, title, job_number, market, status").limit(2000),
      supabase.from("rfqs").select("id, title, rfq_number, status").limit(2000),
      supabase.from("purchase_orders").select("id, po_number, status").limit(2000),
      supabase.from("library_records").select("id, library_key, code, name, status").eq("status", "active").limit(5000),
      supabase.from("outlets").select("id, name, market").limit(5000),
    ]);
    for (const s of (sup.data ?? []) as { id: string; name: string; supplier_code: string | null; market: string | null; region: string | null }[])
      if (has(s.name, s.supplier_code)) hits.push({ module: "assure", kind: "Supplier", title: s.name, sub: [s.supplier_code, s.region, s.market].filter(Boolean).join(" · "), href: `/assure/suppliers/${s.id}` });
    for (const b of (briefs.data ?? []) as { id: string; title: string; brief_code: string; market: string | null; status: string }[])
      if (has(b.title, b.brief_code)) hits.push({ module: "briefing", kind: "Brief", title: b.title, sub: `${b.brief_code} · ${b.status}${b.market ? ` · ${b.market}` : ""}`, href: `/briefing/${b.id}` });
    for (const c of (camps.data ?? []) as { id: string; name: string; campaign_code: string }[])
      if (has(c.name, c.campaign_code)) hits.push({ module: "briefing", kind: "Campaign", title: c.name, sub: c.campaign_code, href: `/briefing/campaigns/${c.id}` });
    for (const j of (jobs.data ?? []) as { id: string; title: string; job_number: string; market: string; status: string }[])
      if (has(j.title, j.job_number)) hits.push({ module: "sourcing", kind: "Job", title: j.title, sub: `${j.job_number} · ${j.status} · ${j.market}`, href: `/sourcing/jobs/${j.id}` });
    for (const r of (rfqs.data ?? []) as { id: string; title: string; rfq_number: string; status: string }[])
      if (has(r.title, r.rfq_number)) hits.push({ module: "rfq", kind: "RFQ", title: r.title, sub: `${r.rfq_number} · ${r.status}`, href: `/rfq/${r.id}` });
    for (const p of (pos.data ?? []) as { id: string; po_number: string; status: string }[])
      if (has(p.po_number)) hits.push({ module: "orders", kind: "Purchase order", title: p.po_number, sub: p.status, href: `/orders/purchase-orders/${p.id}` });
    for (const o of (outlets.data ?? []) as { id: string; name: string; market: string | null }[])
      if (has(o.name)) hits.push({ module: "execution", kind: "Outlet", title: o.name, sub: o.market ?? "", href: `/execution/outlets/${o.id}` });
    for (const l of (libs.data ?? []) as { id: string; library_key: string; code: string | null; name: string }[])
      if (has(l.name, l.code)) hits.push({ module: "watchtower", kind: "Library record", title: l.name, sub: `${l.library_key.replace(/_/g, " ")}${l.code ? ` · ${l.code}` : ""}`, href: `/watchtower/libraries/${l.library_key}/${l.id}` });
  }
  const shown = hits.slice(0, 80);
  const kinds = [...new Set(shown.map((h) => h.kind))];

  return (
    <>
      <PageHead title={ask ? "Ask System Guy" : "Search"} sub={ask ? "Type what you're looking for. Search covers suppliers, briefs, campaigns, jobs, RFQs, POs, outlets and Watchtower libraries; a conversational assistant comes next." : "One search across every module, using your access rights."} />
      <form className="flex max-w-2xl items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 shadow-card">
        <MSymbol name="search" size={20} className="text-muted" />
        <input name="q" defaultValue={q} autoFocus placeholder="e.g. Vistula, BR-2026, wobbler, FSC…" className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
        <button className="rounded-full bg-brand-tech px-4 py-1.5 text-sm font-bold text-brand-navy">Search</button>
      </form>
      {term.length < 2 ? <p className="text-sm text-muted">Type at least two characters.</p> : shown.length === 0 ? (
        <Card><Empty title={`Nothing found for “${q}”`}>Try a code (JB-, BR-, RFQ-, PO-), a supplier name or a material.</Empty></Card>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{hits.length} result{hits.length === 1 ? "" : "s"}{hits.length > shown.length ? ` (showing ${shown.length})` : ""}</p>
          {kinds.map((k) => (
            <Card key={k}>
              <p className="border-b border-line px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-muted">{k}</p>
              <ul className="divide-y divide-line">
                {shown.filter((h) => h.kind === k).map((h) => {
                  const m = moduleByKey(h.module)!;
                  return (
                    <li key={h.href}>
                      <Link href={h.href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: m.colour + "2e", color: m.colour === "#9DC5ED" ? "#4896F7" : m.colour }}><MSymbol name={m.icon} size={17} /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{h.title}</span><span className="block truncate text-xs text-muted">{h.sub}</span></span>
                        <span className="text-xs font-semibold text-muted">{m.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
