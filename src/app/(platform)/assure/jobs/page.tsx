import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink, Card, PageHead } from "@/components/ui";
import { STAGES, VendorJobsSummaryCards, VendorJobsTable, type VendorJobRow, type VendorJobsSummary } from "@/components/assure/vendor-jobs";

export const metadata: Metadata = { title: "Vendor jobs and payments" };

type SP = { vendor?: string; client?: string; region?: string; market?: string; stage?: string; from?: string; to?: string };

// Every vendor and every job coming through, across all clients, with each vendor's payment journey and the expected pay date.
export default async function VendorJobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [res, vendors, clients, markets] = await Promise.all([
    supabase.rpc("srm_vendor_jobs", {
      p_vendor: sp.vendor || null, p_client: sp.client || null, p_region: sp.region || null, p_market: sp.market || null,
      p_stage: sp.stage || null, p_from: sp.from || null, p_to: sp.to || null, p_limit: 500,
    }),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("sourcing_clients").select("id, name").order("name"),
    supabase.from("markets").select("code, name").order("name"),
  ]);
  const data = (res.data as { rows: VendorJobRow[]; summary: VendorJobsSummary } | null) ?? { rows: [], summary: { total: 0, no_invoice: 0, invoice_received: 0, approved: 0, scheduled: 0, paid: 0, disputed: 0, overdue: 0, can_see_money: false } };
  const opt = (v: string | undefined, value: string, label: string) => <option key={value} value={value} selected={v === value}>{label}</option>;

  return (
    <>
      <PageHead crumbs={[{ label: "SRM", href: "/assure" }, { label: "Vendor jobs and payments" }]} title="Vendor jobs and payments"
        sub="Every job placed with a vendor, across all clients, and where each vendor is on the way to being paid." />
      <VendorJobsSummaryCards s={data.summary} base="/assure/jobs" />

      <Card className="p-4">
        <form action="/assure/jobs" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><label className="label" htmlFor="vendor">Vendor</label><select id="vendor" name="vendor" className="input"><option value="">All vendors</option>
            {((vendors.data ?? []) as { id: string; name: string }[]).map((v) => opt(sp.vendor, v.id, v.name))}</select></div>
          <div><label className="label" htmlFor="client">Client</label><select id="client" name="client" className="input"><option value="">All clients</option>
            {((clients.data ?? []) as { id: string; name: string }[]).map((c) => opt(sp.client, c.id, c.name))}</select></div>
          <div><label className="label" htmlFor="region">Region</label><select id="region" name="region" className="input"><option value="">All regions</option>
            {["APAC", "EMEA", "Americas", "GSC"].map((r) => opt(sp.region, r, r))}</select></div>
          <div><label className="label" htmlFor="market">Market</label><select id="market" name="market" className="input"><option value="">All markets</option>
            {((markets.data ?? []) as { code: string; name: string }[]).map((m) => opt(sp.market, m.code, m.name))}</select></div>
          <div><label className="label" htmlFor="stage">Payment</label><select id="stage" name="stage" className="input"><option value="">Any stage</option>
            {STAGES.map((s) => opt(sp.stage, s.key, s.label))}{opt(sp.stage, "overdue", "Late to pay")}</select></div>
          <div><label className="label" htmlFor="from">Ordered from</label><input id="from" name="from" type="date" defaultValue={sp.from} className="input" /></div>
          <div><label className="label" htmlFor="to">Ordered to</label><input id="to" name="to" type="date" defaultValue={sp.to} className="input" /></div>
          <div className="flex gap-2"><button className="inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg" type="submit">Filter</button><ButtonLink href="/assure/jobs">Clear</ButtonLink></div>
        </form>
      </Card>

      {!data.summary.can_see_money && <p className="text-xs text-muted">You see each vendor&apos;s payment status and expected date. Order values and invoice amounts are shown to procurement, finance and SRM leads.</p>}
      <VendorJobsTable rows={data.rows} money={data.summary.can_see_money} />
      {data.summary.total > data.rows.length && <p className="text-xs text-muted">Showing the first {data.rows.length} of {data.summary.total}. Narrow the filters to see the rest.</p>}
    </>
  );
}
