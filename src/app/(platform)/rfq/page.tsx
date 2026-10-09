import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSpecs, rows } from "@/lib/sourcing-data";
import { money } from "@/lib/sourcing";
import { isBiddingOpen, RFQ_STATUS, rfqStatus, type Rfq } from "@/lib/rfq";
import { ButtonLink, Card, Empty, PageHead, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Td, Th, fmtDateTime } from "@/components/sourcing/bits";

export const metadata: Metadata = { title: "RFQ+" };

export default async function RfqDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [rfqs, specs] = await Promise.all([rows<Rfq>(supabase, "v_rfqs", { order: [["created_at", false]], limit: 2000 }), getSpecs(supabase)]);
  const below = (r: Rfq) => r.status === "sent" && r.quote_count < (r.min_quotes_required ?? 1);
  const open = rfqs.filter((r) => isBiddingOpen(r));
  const toAward = rfqs.filter((r) => r.status === "sent" && !isBiddingOpen(r));
  const hv = rfqs.filter((r) => r.status === "draft" && r.high_value_alert && !r.high_value_approved_by);
  const waitingCreate = specs.filter((s) => !s.is_draft && s.route === "create");

  let list = rfqs;
  if (sp.filter === "below_min") list = list.filter(below);
  else if (sp.status) list = list.filter((r) => r.status === sp.status);
  const q = (sp.q ?? "").toLowerCase().trim();
  if (q) list = list.filter((r) => `${r.rfq_number} ${r.title} ${r.job_number} ${r.client_name}`.toLowerCase().includes(q));

  return (
    <>
      <PageHead title="RFQ+" sub="Sealed requests for quote to suppliers from the Assure+ eligible pool, with minimum quotes from the Sourcing Control Matrix enforced.">
        <ButtonLink href="/rfq/new" variant="primary"><MSymbol name="add" size={18} />New RFQ</ButtonLink>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Lines waiting for an RFQ" value={waitingCreate.length} hint="Routed Create at triage" icon={<MSymbol name="alt_route" />} />
        <Stat label="Open for quotes" value={open.length} hint="Before the due date" icon={<MSymbol name="send" />} />
        <Stat label="Ready to evaluate" value={toAward.length} tone={toAward.length ? "warn" : undefined} hint="Due date passed" icon={<MSymbol name="gavel" />} />
        <Stat label="Below minimum quotes" value={rfqs.filter(below).length} tone={rfqs.filter(below).length ? "warn" : "ok"} hint="Fewer valid quotes than required" icon={<MSymbol name="report" />} />
        <Stat label="High-value approvals" value={hv.length} tone={hv.length ? "warn" : "ok"} hint="Over the country threshold" icon={<MSymbol name="priority_high" />} />
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search RFQ, job, client" className="input w-60" aria-label="Search RFQs" />
        <select name="status" defaultValue={sp.status ?? ""} className="input w-auto" aria-label="Status"><option value="">All statuses</option>{RFQ_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        <select name="filter" defaultValue={sp.filter ?? ""} className="input w-auto" aria-label="Filter"><option value="">Any</option><option value="below_min">Below minimum quotes</option></select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>

      <Card className="min-w-0 overflow-x-auto">
        {rfqs.length === 0 ? <Empty title="No RFQs yet"><p>Create one from spec lines routed to Create in the Sourcing+ triage basket.</p></Empty> : list.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No RFQs match.</p> : (
          <table className="w-full text-sm">
            <thead><tr><Th>RFQ</Th><Th>Job</Th><Th>Market</Th><Th>Status</Th><Th>Due</Th><Th>Value</Th><Th>Quotes / min</Th><Th>Awarded to</Th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <Td><Link className="font-semibold hover:underline" href={`/rfq/${r.id}`}>{r.rfq_number}</Link><div className="text-xs text-muted">{r.title}</div></Td>
                  <Td><Link className="hover:underline" href={`/sourcing/jobs/${r.job_id}`}>{r.job_number}</Link><div className="text-xs text-muted">{r.client_name}</div></Td>
                  <Td>{r.market} <span className="text-xs text-muted">· {r.region}</span></Td>
                  <Td><div className="flex flex-wrap gap-1"><Pill tone={rfqStatus(r.status).tone}>{r.status === "sent" && !isBiddingOpen(r) ? "Closed, to evaluate" : rfqStatus(r.status).label}</Pill>{r.high_value_alert && <Pill tone="bad">High value</Pill>}{(r as Rfq & { spec_changed?: boolean }).spec_changed && r.status === "sent" && <Pill tone="warn">Spec changed: re-quote</Pill>}</div></Td>
                  <Td>{fmtDateTime(r.due_at)}</Td>
                  <Td className="tabular-nums">{money(r.estimated_value, r.currency)}</Td>
                  <Td className="tabular-nums">{r.quote_count} / {r.min_quotes_required ?? "—"} {below(r) && <Pill tone="warn">Below</Pill>}</Td>
                  <Td>{r.awarded_supplier_name ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
