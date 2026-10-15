import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getClients, getHealth, getMarkets, getOpportunities } from "@/lib/crm-data";
import { OPEN_STAGES, SETUP_STATUS, money, moneyByCurrency } from "@/lib/crm";
import { Card, Empty, PageHead } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { StatusPill, Td, Th } from "@/components/sourcing/bits";
import { ClientLink, Disclosure, Input, RagPill, Select, TextArea, marketOptions } from "@/components/crm/bits";
import { createClientAccount } from "../actions";

export const metadata: Metadata = { title: "Clients · CRM" };

export default async function CrmClients() {
  await requireInternal();
  const supabase = await createClient();
  const [clients, accounts, health, opps, markets] = await Promise.all([getClients(supabase), getAccounts(supabase), getHealth(supabase), getOpportunities(supabase), getMarkets(supabase)]);
  const hById = new Map(health.map((h) => [h.client_id, h]));

  return (
    <>
      <PageHead title="Clients" sub="The client master every section uses, with CRM's view of each relationship: markets, account leads, pipeline and health."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Clients" }]} />

      <Disclosure summary="Set up a new client">
        <p className="mb-3 text-sm text-muted">New clients get a credit and KYC check. When the approval policy applies, Finance approves before the client can be used on jobs.</p>
        <ActionForm action={createClientAccount} submit="Set up client" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input name="code" label="Client code" required placeholder="e.g. NSF" />
          <Input name="name" label="Name" required />
          <Input name="currency" label="Default currency" value="EUR" />
          <Select name="hq_market" label="Head office market" options={marketOptions(markets)} empty="Choose…" />
          <Input name="sector" label="Sector" />
          <Input name="credit_limit" label="Credit limit requested" type="number" step="1000" />
          <TextArea name="note" label="Credit and KYC notes for Finance" className="sm:col-span-2 lg:col-span-3" />
        </ActionForm>
      </Disclosure>

      <Card className="overflow-x-auto">
        {clients.length === 0 ? <Empty title="No clients yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Client</Th><Th>Markets</Th><Th>Account leads</Th><Th>Open pipeline</Th><Th className="text-right">Spend this year</Th><Th>Health</Th><Th>Set-up</Th></tr></thead>
            <tbody>
              {clients.map((c) => {
                const acc = accounts.filter((a) => a.client_id === c.id);
                const h = hById.get(c.id);
                const open = opps.filter((o) => o.client_id === c.id && OPEN_STAGES.includes(o.stage));
                const leads = [...new Set(acc.map((a) => a.account_lead_name).filter(Boolean))];
                return (
                  <tr key={c.id} className="align-top">
                    <Td><ClientLink id={c.id} name={c.name} /><div className="text-xs text-muted">{c.code}{c.sector ? ` · ${c.sector}` : ""}{!c.active ? " · inactive" : ""}</div></Td>
                    <Td>{acc.length ? acc.map((a) => a.market).join(", ") : <span className="text-muted">None yet</span>}</Td>
                    <Td>{leads.join(", ") || <span className="text-muted">Not set</span>}</Td>
                    <Td>{open.length ? <>{moneyByCurrency(open.map((o) => ({ value: o.weighted_value, currency: o.currency })))}<div className="text-xs text-muted">weighted · {open.length} open</div></> : <span className="text-muted">—</span>}</Td>
                    <Td className="text-right tabular-nums">{h ? money(h.spend_ytd, h.currency) : "—"}</Td>
                    <Td>{h ? <RagPill rag={h.rag} title={h.reasons.join(" · ")} /> : "—"}</Td>
                    <Td><StatusPill meta={SETUP_STATUS} value={c.crm_setup_status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
