import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJobs, rows } from "@/lib/sourcing-data";
import { money, REGIONS } from "@/lib/sourcing";
import { PSA_STAGES, psaStage } from "@/lib/orders";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { createPsa } from "../actions";

export const metadata: Metadata = { title: "PSA exceptions" };

type Psa = { id: string; reference: string; title: string; stage: string; fee: number; currency: string; supplier_name: string | null; job_number: string | null; requester_name: string | null; line_manager_name: string | null; market: string | null; created_at: string; outcome: string | null };

export default async function PsaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, jobs, suppliers] = await Promise.all([
    rows<Psa>(supabase, "v_psa_exceptions", { order: [["created_at", false]], limit: 1000 }), getJobs(supabase),
    rows<{ id: string; name: string }>(supabase, "v_eligible_suppliers", { order: [["name"]], limit: 5000 }),
  ]);
  const list = sp.stage ? all.filter((x) => x.stage === sp.stage) : all;
  return (
    <>
      <PageHead crumbs={[{ label: "Order Management+", href: "/orders" }, { label: "PSA exceptions" }]} title="Variable PSA exceptions"
        sub="A request to apply a variable fee to one order: line manager verifies, regional procurement tries to protect the PSA, a delegated approver confirms, Finance applies." />
      <ol className="flex flex-wrap gap-1.5 text-xs">{PSA_STAGES.filter((s) => !["resolved", "rejected"].includes(s.value)).map((s, i) => (
        <li key={s.value}><Link href={`/orders/psa?stage=${s.value}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-semibold hover:bg-surface-2" title={s.description}>{i + 1}. {s.label} <Pill tone={s.tone}>{all.filter((x) => x.stage === s.value).length}</Pill></Link></li>
      ))}</ol>
      <Card className="min-w-0 overflow-x-auto">
        {all.length === 0 ? <Empty title="No PSA exceptions"><p>Raise one below when a variable fee is needed on an order.</p></Empty> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Reference</Th><Th>Request</Th><Th>Supplier</Th><Th>Job</Th><Th>Fee</Th><Th>Requester</Th><Th>Stage</Th><Th>Raised</Th></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.id}>
                <Td><Link className="font-semibold hover:underline" href={`/orders/psa/${x.id}`}>{x.reference}</Link></Td><Td>{x.title}</Td><Td>{x.supplier_name ?? "—"}</Td><Td>{x.job_number ?? "—"}</Td>
                <Td className="tabular-nums">{money(x.fee, x.currency)}</Td><Td>{x.requester_name ?? "—"}</Td><Td><Pill tone={psaStage(x.stage).tone}>{psaStage(x.stage).label}</Pill></Td><Td>{fmtDate(x.created_at)}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <Panel title="Raise a PSA exception" sub="Saved as a draft; you then send it to your line manager.">
        <div className="p-5">
          <ActionForm action={createPsa} submit="Save request">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="What is the request" htmlFor="title" className="sm:col-span-2"><input id="title" name="title" required className="input" /></Field>
              <Field label="Fee" htmlFor="fee"><input id="fee" name="fee" required inputMode="decimal" className="input" /></Field>
              <Field label="Currency" htmlFor="currency"><input id="currency" name="currency" defaultValue="EUR" className="input uppercase" /></Field>
              <Field label="Job" htmlFor="job_id"><select id="job_id" name="job_id" className="input"><option value="">None</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.title}</option>)}</select></Field>
              <Field label="Supplier" htmlFor="supplier_id"><select id="supplier_id" name="supplier_id" className="input"><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Region (if no job)" htmlFor="region"><select id="region" name="region" className="input"><option value="">—</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
              <Field label="Market (if no job)" htmlFor="market"><input id="market" name="market" className="input" /></Field>
              <Field label="Business reason" htmlFor="business_reason" className="sm:col-span-2 lg:col-span-4"><textarea id="business_reason" name="business_reason" rows={3} required className="input" /></Field>
            </div>
          </ActionForm>
        </div>
      </Panel>
    </>
  );
}
