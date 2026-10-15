import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getLibrary, getStakeholders } from "@/lib/crm-data";
import { DEPARTMENTS, FREQUENCIES, LEVELS, QUADRANT, RAGS, countBy, labelOf } from "@/lib/crm";
import { Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Bars, Select, clientOptions } from "@/components/crm/bits";

export const metadata: Metadata = { title: "Stakeholders · CRM" };

const RAG_TONE: Record<string, string> = { green: "bg-ok", amber: "bg-warn", red: "bg-bad" };

export default async function CrmStakeholders({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, clients, services, quadrants] = await Promise.all([getStakeholders(supabase, { client_id: sp.client }), getClients(supabase),
    getLibrary(supabase, "crm_services"), getLibrary(supabase, "crm_stakeholder_quadrants")]);
  const rows = all.filter((r) => !r.left_at);
  const levelOrder = ["high", "medium", "low"];
  const cell = (inf: string, dec: string) => rows.filter((r) => r.influence_level === inf && r.decision_level === dec);
  const toOffer = services.map((s) => ({ s, n: rows.filter((r) => !r.services_offered.includes(s.id) && !r.services_declined.includes(s.id)).length }))
    .sort((a, b) => b.n - a.n);
  const bars = (pairs: [string, number][], label: (k: string) => string, tone?: (k: string) => string) =>
    pairs.map(([k, n]) => ({ label: label(k), value: n, text: String(n), tone: tone?.(k) }));

  return (
    <>
      <PageHead title="Stakeholders" sub="How well we know each client: relationship RAG, contact frequency, influence and decision-maker levels, the stakeholder matrix and the services still to offer."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Stakeholders" }]}>
        <Link href={`/crm/contacts${sp.client ? `?client=${sp.client}` : ""}`} className="text-sm font-semibold text-accent underline">Edit in the grid</Link>
      </PageHead>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Show</button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Contacts mapped" value={rows.length} hint={`${rows.filter((r) => r.missing_fields.length).length} missing mandatory fields`} icon={<MSymbol name="contacts" />} />
        <Stat label="Relationship red" value={rows.filter((r) => r.relationship_rag === "red").length} tone={rows.some((r) => r.relationship_rag === "red") ? "bad" : "ok"} icon={<MSymbol name="error" />} />
        <Stat label="Review due" value={rows.filter((r) => r.needs_review).length} tone={rows.some((r) => r.needs_review) ? "warn" : "ok"} hint="Quarterly review of the map"
          icon={<MSymbol name="event_repeat" />} />
        <Stat label="Can't be emailed" value={rows.filter((r) => r.send_block).length} hint="Opted out or no legal basis" icon={<MSymbol name="unsubscribe" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Stakeholder matrix" sub="Influence (rows) by decision-maker level (columns). Quadrants come from the CRM Watchtower grid.">
          <div className="overflow-x-auto px-5 py-4">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Influence \ decision</th>{levelOrder.map((d) => <th key={d} className="th text-center">{labelOf(LEVELS, d)}</th>)}</tr></thead>
              <tbody>{levelOrder.map((inf) => (
                <tr key={inf}><td className="td font-semibold">{labelOf(LEVELS, inf)}</td>
                  {levelOrder.map((dec) => {
                    const c = cell(inf, dec);
                    const qd = c[0]?.quadrant ?? null;
                    return (
                      <td key={dec} className="td text-center">
                        <span className="block font-display text-xl font-bold">{c.length}</span>
                        {qd && <Pill tone={QUADRANT[qd]?.tone ?? "neutral"}>{QUADRANT[qd]?.label ?? qd}{!c[0]?.quadrant_confirmed && " *"}</Pill>}
                      </td>
                    );
                  })}</tr>))}</tbody>
            </table>
            <p className="mt-2 text-xs text-muted">* default grid, still to be confirmed. {rows.filter((r) => !r.quadrant).length} contacts have no levels yet.</p>
          </div>
          <ul className="divide-y divide-line border-t border-line">{quadrants.map((qd) => (
            <li key={qd.id} className="px-5 py-2.5 text-sm"><Pill tone={QUADRANT[qd.code ?? ""]?.tone ?? "neutral"}>{qd.name}</Pill>{" "}
              <span className="font-semibold">{rows.filter((r) => r.quadrant === qd.code).length}</span> · {String(qd.data?.strategy ?? "")}
              <span className="block text-xs text-muted">{String(qd.data?.actions ?? "")}</span></li>))}</ul>
        </Panel>
        <div className="grid gap-4">
          <Panel title="Relationship RAG"><Bars rows={bars(RAGS.map((r) => [r.value, rows.filter((x) => x.relationship_rag === r.value).length] as [string, number]), (k) => labelOf(RAGS, k), (k) => RAG_TONE[k])} /></Panel>
          <Panel title="Contact frequency"><Bars rows={bars(countBy(rows, (r) => r.contact_frequency), (k) => labelOf(FREQUENCIES, k))} /></Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Influence level"><Bars rows={bars(countBy(rows, (r) => r.influence_level), (k) => labelOf(LEVELS, k))} /></Panel>
        <Panel title="Decision-maker level"><Bars rows={bars(countBy(rows, (r) => r.decision_level), (k) => labelOf(LEVELS, k))} /></Panel>
        <Panel title="Department"><Bars rows={bars(countBy(rows, (r) => r.department), (k) => labelOf(DEPARTMENTS, k))} /></Panel>
        <Panel title="Owner role"><Bars rows={bars(countBy(rows, (r) => r.owner_role), (k) => k)} /></Panel>
        <Panel title="Services to offer" sub="Contacts not yet offered a service (and who haven't declined it)" className="xl:col-span-2">
          <Bars rows={toOffer.slice(0, 8).map(({ s, n }) => ({ label: s.name, value: n, text: String(n) }))} />
        </Panel>
      </div>
      <Card className="px-5 py-3 text-sm text-muted">The matrix grid, quadrants, owner roles and services are governed libraries in the <Link href="/crm/watchtower" className="font-semibold text-accent underline">CRM Watchtower</Link>.</Card>
    </>
  );
}
