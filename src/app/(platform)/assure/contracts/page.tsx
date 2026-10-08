import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople, getSuppliers } from "@/lib/data";
import { rows, supplierOptions } from "@/lib/assure-data";
import { CONTRACT_EXPIRY_ALERT_DAYS, CONTRACT_STATUS, CONTRACT_TABS, daysBetween, DOCUMENT_TYPES, isContractExpiring, optLabel, type Contract } from "@/lib/assure";
import { personName, REGIONS, timeAgo } from "@/lib/srt";
import { ButtonLink, Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Chips, Date_, OptPill, SupplierLink, Tabs } from "@/components/assure/bits";
import { ContractForm } from "@/components/assure/forms";

export const metadata: Metadata = { title: "Contracts" };

type SP = Promise<{ tab?: string; q?: string; region?: string }>;

export default async function ContractsPage({ searchParams }: { searchParams: SP }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [contracts, suppliers, templates, activity, people] = await Promise.all([
    rows<Contract>(supabase, "contracts", { order: "updated_at" }),
    getSuppliers(supabase),
    rows<{ id: string; name: string; is_active: boolean }>(supabase, "contract_templates", { cols: "id, name, is_active" }),
    rows<{ id: number; contract_id: string; event_type: string; description: string | null; actor: string | null; created_at: string }>(supabase, "contract_activity", { order: "created_at", limit: 14 }),
    getInternalPeople(supabase),
  ]);
  const sMap = new Map(suppliers.map((s) => [s.id, s]));
  const cMap = new Map(contracts.map((c) => [c.id, c]));
  const pMap = byId(people);
  const q = sp.q?.toLowerCase();
  const scoped = contracts.filter((c) => (!sp.region || c.region === sp.region) && (!q || c.title.toLowerCase().includes(q) || (c.supplier_id && sMap.get(c.supplier_id)?.name.toLowerCase().includes(q))));
  const tab = CONTRACT_TABS.find((t) => t.key === sp.tab) ?? CONTRACT_TABS[0];
  const list = scoped.filter((c) => tab.statuses.includes(c.status));
  const today = new Date().toISOString().slice(0, 10);
  const expiring = contracts.filter((c) => isContractExpiring(c)).sort((a, b) => (a.end_date ?? "").localeCompare(b.end_date ?? ""));

  return (
    <>
      <PageHead title="Contracts" sub="Draft, send, sign and amend supplier contracts. Status only moves through the actions on each contract, and every step is logged."
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Contracts" }]}>
        <ButtonLink href="/assure/contracts/templates"><MSymbol name="library_books" size={18} /> Templates</ButtonLink>
      </PageHead>

      <Panel title={`Expiring in the next ${CONTRACT_EXPIRY_ALERT_DAYS} days (${expiring.length})`} sub="Fully signed contracts whose end date is close or has passed. Start the renewal or amendment now.">
        {expiring.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No live contracts end in the next {CONTRACT_EXPIRY_ALERT_DAYS} days.</p> : (
          <ul className="divide-y divide-line">
            {expiring.map((c) => {
              const d = daysBetween(today, c.end_date!);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div><Link href={`/assure/contracts/${c.id}`} className="font-semibold hover:text-accent">{c.title}</Link>
                    {c.supplier_id && <div className="text-xs"><SupplierLink id={c.supplier_id} name={sMap.get(c.supplier_id)?.name} tab="contracts" /></div>}</div>
                  <div className="text-right text-xs"><Date_ d={c.end_date} /><div><Pill tone={d < 0 ? "bad" : d <= 30 ? "warn" : "info"}>{d < 0 ? `Ended ${-d} days ago` : d === 0 ? "Ends today" : `${d} days left`}</Pill></div></div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-3">
          <Card className="p-4">
            <form method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value={tab.key} />
              <label className="min-w-[240px] flex-1"><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Title or supplier" className="input" /></label>
              <button className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg" type="submit">Search</button>
            </form>
            <div className="mt-3"><Chips label="Region:" param="region" options={REGIONS.map((r) => ({ value: r, label: r }))} active={sp.region} keep={{ tab: tab.key, q: sp.q, region: sp.region }} /></div>
          </Card>
          <Tabs tabs={CONTRACT_TABS.map((t) => ({ key: t.key, label: t.label, count: scoped.filter((c) => t.statuses.includes(c.status)).length }))} active={tab.key} base="/assure/contracts" keep={{ q: sp.q, region: sp.region }} />
          <Card className="overflow-x-auto">
            {list.length === 0 ? <Empty title="Nothing here" /> : (
              <table className="w-full text-sm">
                <thead><tr>{["Contract", "Supplier", "Type", "Status", "Ends", "Updated"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id}>
                      <td className="td"><Link href={`/assure/contracts/${c.id}`} className="font-semibold hover:text-accent">{c.title}</Link><div className="text-xs text-muted">{c.contract_ref}{c.version > 1 ? ` · v${c.version}` : ""}</div></td>
                      <td className="td">{c.supplier_id ? <SupplierLink id={c.supplier_id} name={sMap.get(c.supplier_id)?.name} tab="contracts" /> : <span className="text-muted">—</span>}</td>
                      <td className="td">{optLabel(DOCUMENT_TYPES, c.document_type)}</td>
                      <td className="td"><OptPill list={CONTRACT_STATUS} value={c.status} /></td>
                      <td className="td"><Date_ d={c.end_date} /></td>
                      <td className="td text-xs text-muted">{timeAgo(c.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <Panel title="Latest activity">
          {activity.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing yet.</p> : (
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-xs">
                  <p className="font-semibold capitalize">{a.event_type}: <Link href={`/assure/contracts/${a.contract_id}`} className="font-normal normal-case text-accent">{cMap.get(a.contract_id)?.title ?? "contract"}</Link></p>
                  {a.description && <p className="text-muted">{a.description}</p>}
                  <p className="text-muted">{a.actor ? personName(pMap.get(a.actor)) : "System"} · {timeAgo(a.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="New contract" sub="Starts as a draft. Add recipients on the next page, then send it for signature.">
        <div className="p-5"><ContractForm suppliers={supplierOptions(suppliers)} templates={templates.filter((t) => t.is_active)} /></div>
      </Panel>
    </>
  );
}
