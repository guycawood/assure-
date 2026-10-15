import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getContacts, getMarkets } from "@/lib/crm-data";
import { DECISION_ROLES, decisionRole } from "@/lib/crm";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th } from "@/components/sourcing/bits";
import { ClientLink, Disclosure, Input, Select, clientOptions, marketOptions } from "@/components/crm/bits";
import { saveContact } from "../actions";

export const metadata: Metadata = { title: "Contacts · CRM" };

export default async function CrmContacts({ searchParams }: { searchParams: Promise<{ client?: string; role?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [contacts, clients, markets] = await Promise.all([getContacts(supabase), getClients(supabase), getMarkets(supabase)]);
  const rows = contacts.filter((c) => (!sp.client || c.client_id === sp.client) && (!sp.role || c.decision_role === sp.role));

  return (
    <>
      <PageHead title="Contacts" sub="The people we work with at each client, their decision role and whether they agreed to be contacted."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Contacts" }]} />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <Select name="role" label="Decision role" options={DECISION_ROLES.map((d) => ({ value: d.value, label: d.label }))} value={sp.role} empty="Any" />
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter</button>
        {(sp.client || sp.role) && <Link href="/crm/contacts" className="pb-2 text-sm text-accent underline">Clear</Link>}
      </form>
      <Disclosure summary="Add a contact">
        <ActionForm action={saveContact} submit="Add contact" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select name="client_id" label="Client" options={clientOptions(clients)} empty="Choose…" required value={sp.client} />
          <Input name="full_name" label="Name" required />
          <Input name="job_title" label="Job title" />
          <Input name="email" label="Email" type="email" />
          <Input name="phone" label="Phone" />
          <Select name="market" label="Market" options={marketOptions(markets)} empty="—" />
          <Select name="decision_role" label="Decision role" options={DECISION_ROLES.map((d) => ({ value: d.value, label: d.label }))} value="user" />
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="consent" /> Agreed to be contacted (consent)</label>
        </ActionForm>
      </Disclosure>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No contacts match" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Name</Th><Th>Client</Th><Th>Role</Th><Th>Contact</Th><Th>Market</Th><Th>Decision role</Th><Th>Consent</Th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                <Td className="font-semibold">{c.full_name}</Td>
                <Td><ClientLink id={c.client_id} name={c.client_name} /></Td>
                <Td>{c.job_title ?? "—"}</Td>
                <Td>{c.email ? <a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"}<div className="text-xs text-muted">{c.phone}</div></Td>
                <Td>{c.market_name ?? "—"}</Td>
                <Td><Pill tone={c.decision_role === "sponsor" ? "accent" : c.decision_role === "approver" ? "info" : "neutral"}>{decisionRole(c.decision_role)}</Pill></Td>
                <Td>{c.consent ? <Pill tone="ok">Yes</Pill> : <Pill tone="warn">No</Pill>}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
