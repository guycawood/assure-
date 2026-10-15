import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getClients, getLibrary, getMarkets, getPeople, getStakeholders } from "@/lib/crm-data";
import { DECISION_ROLES } from "@/lib/crm";
import { Card, Empty, PageHead } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Disclosure, Input, Select, clientOptions, libOptions, marketOptions, peopleOptions } from "@/components/crm/bits";
import { StakeholderGrid } from "@/components/crm/stakeholder-grid";
import { BulkForm } from "@/components/crm/bulk-form";
import { markContactLeft, markContactsReviewed, reassignContacts, saveContact } from "../actions";

export const metadata: Metadata = { title: "Contacts · CRM" };

// Stakeholder mapping per client account (the HubSpot view it replaces): spreadsheet-style editing, "my contacts",
// account filter, bulk owner reassignment, leavers and the quarterly review.
export default async function CrmContacts({ searchParams }: { searchParams: Promise<{ client?: string; account?: string; mine?: string; show?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, clients, accounts, markets, people, roles, services] = await Promise.all([
    getStakeholders(supabase, { client_id: sp.client, account_id: sp.account, owner: sp.mine === "1" ? me.id : undefined }), getClients(supabase), getAccounts(supabase),
    getMarkets(supabase), getPeople(supabase), getLibrary(supabase, "crm_owner_roles"), getLibrary(supabase, "crm_services"),
  ]);
  const rows = all.filter((r) => (sp.show === "left" ? !!r.left_at : !r.left_at) && (sp.show !== "review" || r.needs_review) && (sp.show !== "missing" || r.missing_fields.length > 0));
  const accOpts = accounts.filter((a) => !sp.client || a.client_id === sp.client).map((a) => ({ value: a.id, label: `${a.client_name} · ${a.market_name ?? a.market}` }));
  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
    return `/crm/contacts${p ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHead title="Contacts" sub="Stakeholder mapping for every client account. Click a cell to change it; it saves straight away and is audited. Review each account's map once a quarter."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Contacts" }]}>
        <Link href="/crm/stakeholders" className="text-sm font-semibold text-accent underline">Stakeholder dashboard</Link>
        <Link prefetch={false} href="/crm/export/contacts" className="text-sm font-semibold text-accent underline">Export CSV</Link>
      </PageHead>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <Select name="account" label="Account" options={accOpts} value={sp.account} empty="All accounts" />
        <Select name="show" label="Show" options={[{ value: "review", label: "Review due" }, { value: "missing", label: "Missing mandatory fields" }, { value: "left", label: "Leavers" }]} value={sp.show} empty="Current contacts" />
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> My contacts only</label>
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter</button>
        {(sp.client || sp.account || sp.mine || sp.show) && <Link href="/crm/contacts" className="pb-2 text-sm text-accent underline">Clear</Link>}
        <Link href={q({ mine: sp.mine === "1" ? undefined : "1" })} className="pb-2 text-sm text-accent underline">{sp.mine === "1" ? "Everyone's contacts" : "My contacts"}</Link>
      </form>

      <Card className="min-w-0">
        {rows.length === 0 ? <Empty title="No contacts match" /> : (
          <StakeholderGrid rows={rows} people={peopleOptions(people)} roles={libOptions(roles).map((r, i) => ({ value: r.value, label: roles[i].code ?? r.label }))} services={libOptions(services)} />
        )}
      </Card>

      <Card className="flex flex-wrap items-center gap-4 px-5 py-3">
        <span className="text-sm font-semibold">With the ticked contacts:</span>
        <BulkForm id="bulk-reassign" action={reassignContacts} submit="Reassign owner">
          <select name="owner" className="input w-48" aria-label="New owner" required defaultValue=""><option value="" disabled>New owner…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input name="note" className="input w-48" placeholder="Why (e.g. leaver)" aria-label="Reason" />
        </BulkForm>
        <BulkForm id="bulk-review" action={markContactsReviewed} submit="Mark reviewed" />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Disclosure summary="Add a contact (new joiner at the client)">
          <ActionForm action={saveContact} submit="Add contact" className="grid gap-3 sm:grid-cols-2">
            <Select name="client_id" label="Client" options={clientOptions(clients)} empty="Choose…" required value={sp.client} />
            <Input name="full_name" label="Name" required />
            <Input name="job_title" label="Job title" />
            <Input name="email" label="Email" type="email" />
            <Input name="phone" label="Phone" />
            <Select name="market" label="Market" options={marketOptions(markets)} empty="—" />
            <Select name="decision_role" label="Decision role" options={DECISION_ROLES.map((d) => ({ value: d.value, label: d.label }))} value="user" />
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="consent" /> Agreed to be contacted (consent)</label>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Then fill the stakeholder fields in the grid (owner, role, department, RAG, levels).</p>
        </Disclosure>
        <Disclosure summary="Mark a contact as left">
          <ActionForm action={markContactLeft} submit="Mark as left" variant="danger" className="grid gap-3 sm:grid-cols-2">
            <Select name="id" label="Contact" options={rows.filter((r) => !r.left_at).map((r) => ({ value: r.id, label: `${r.full_name} (${r.client_name})` }))} empty="Choose…" required />
            <Input name="note" label="Note" placeholder="e.g. moved to another company" />
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Leavers stay on record for history but are no longer contacted, surveyed or emailed.</p>
        </Disclosure>
      </div>
      <p className="text-xs text-muted">Owner roles and services come from the CRM Watchtower libraries; {peopleOptions(people).length} people at adm Indicia can own contacts.</p>
    </>
  );
}
