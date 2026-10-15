import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAudience, getClients, getContacts, getLibrary, getLists, getMarkets, getPeople } from "@/lib/crm-data";
import { DECISION_ROLES, DEPARTMENTS, LEVELS, QUADRANT, RAGS, type ListRow } from "@/lib/crm";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { Disclosure, Input, Select, clientOptions, marketOptions, peopleOptions } from "@/components/crm/bits";
import { addToList, removeFromList, saveList } from "../actions";

export const metadata: Metadata = { title: "Lists · CRM" };

const FILTER_LABEL: Record<string, string> = {
  client_id: "Client", department: "Department", relationship_rag: "RAG", influence_level: "Influence", decision_level: "Decision maker", quadrant: "Matrix",
  market: "Market", owner: "Owner", owner_role: "Owner role", decision_role: "Decision role", receive_survey: "Receive survey", all_staff: "All staff",
};

export default async function CrmLists({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [lists, clients, markets, people, roles] = await Promise.all([getLists(supabase), getClients(supabase), getMarkets(supabase), getPeople(supabase), getLibrary(supabase, "crm_owner_roles")]);
  const sel = lists.find((l) => l.id === sp.list) ?? null;

  return (
    <>
      <PageHead title="Lists" sub="Who an email goes to. Static lists are picked by hand; dynamic lists follow filters on contact fields. Client lists are external; staff lists are for internal comms."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Lists" }]}>
        <Link href="/crm/emails" className="text-sm font-semibold text-accent underline">Emails</Link>
      </PageHead>
      <Card className="overflow-x-auto">
        {lists.length === 0 ? <Empty title="No lists yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>List</Th><Th>Type</Th><Th>Audience</Th><Th>Filters / members</Th><Th>Emails</Th><Th>Created</Th></tr></thead>
            <tbody>{lists.map((l) => (
              <tr key={l.id}><Td><Link className="font-semibold hover:underline" href={`/crm/lists?list=${l.id}`}>{l.name}</Link><div className="text-xs text-muted">{l.description}</div></Td>
                <Td>{l.kind === "static" ? "Static" : "Dynamic"}</Td>
                <Td><Pill tone={l.audience === "external" ? "warn" : "info"}>{l.audience === "external" ? "Client contacts" : "Staff"}</Pill></Td>
                <Td className="text-xs">{l.kind === "static" ? `${l.static_members} members` : describe(l, clients, people)}</Td>
                <Td>{l.emails}</Td><Td>{fmtDate(l.created_at)}</Td></tr>))}</tbody>
          </table>
        )}
      </Card>

      {sel && <ListDetail list={sel} people={people} />}

      <Disclosure summary="Create a list">
        <ActionForm action={saveList} submit="Create list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input name="name" label="Name" required className="sm:col-span-2" />
          <Select name="kind" label="Type" options={[{ value: "dynamic", label: "Dynamic (filters)" }, { value: "static", label: "Static (pick people)" }]} value="dynamic" />
          <Select name="audience" label="Audience" options={[{ value: "external", label: "Client contacts" }, { value: "internal", label: "adm Indicia staff" }]} value="external" />
          <Input name="description" label="Description" className="sm:col-span-2 lg:col-span-4" />
          <p className="text-xs font-semibold text-muted sm:col-span-2 lg:col-span-4">Filters for a dynamic client list (leave empty for any):</p>
          <Select name="client_id" label="Client" options={clientOptions(clients)} empty="Any" />
          <Select name="department" label="Department" options={DEPARTMENTS} empty="Any" />
          <Select name="relationship_rag" label="Relationship RAG" options={RAGS} empty="Any" />
          <Select name="quadrant" label="Matrix quadrant" options={Object.entries(QUADRANT).map(([v, q]) => ({ value: v, label: q.label }))} empty="Any" />
          <Select name="influence_level" label="Influence" options={LEVELS} empty="Any" />
          <Select name="decision_level" label="Decision maker" options={LEVELS} empty="Any" />
          <Select name="market" label="Market" options={marketOptions(markets)} empty="Any" />
          <Select name="owner" label="Contact owner" options={peopleOptions(people)} empty="Any" />
          <Select name="owner_role" label="Owner role" options={roles.map((r) => ({ value: r.code ?? "", label: `${r.code} · ${r.name}` }))} empty="Any" />
          <Select name="decision_role" label="Decision role" options={DECISION_ROLES.map((d) => ({ value: d.value, label: d.label }))} empty="Any" />
          <Select name="receive_survey" label="Receive survey" options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} empty="Any" />
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="all_staff" /> All staff (dynamic staff list)</label>
        </ActionForm>
      </Disclosure>
    </>
  );
}

function describe(l: ListRow, clients: { id: string; name: string }[], people: { id: string; name: string }[]) {
  const parts = Object.entries(l.filters ?? {}).map(([k, v]) => {
    const value = k === "client_id" ? clients.find((c) => c.id === v)?.name : k === "owner" ? people.find((p) => p.id === v)?.name : String(v);
    return `${FILTER_LABEL[k] ?? k}: ${value ?? v}`;
  });
  return parts.length ? parts.join(" · ") : l.audience === "external" ? "All current client contacts" : "Nobody (add filters)";
}

async function ListDetail({ list, people }: { list: ListRow; people: { id: string; name: string; email: string }[] }) {
  const supabase = await createClient();
  const [audience, contacts] = await Promise.all([getAudience(supabase, list.id), list.audience === "external" && list.kind === "static" ? getContacts(supabase) : Promise.resolve([])]);
  const ok = audience.filter((a) => !a.block);
  const memberIds = new Set(audience.map((a) => a.contact_id ?? a.profile_id));
  return (
    <Panel title={list.name} sub={`${ok.length} can be emailed · ${audience.length - ok.length} excluded (reason shown)`} actions={<Link href="/crm/lists" className="text-xs underline">Close</Link>}>
      {list.kind === "static" && (
        <div className="border-b border-line px-5 py-3">
          <ActionForm action={addToList} hidden={{ id: list.id }} submit="Add" variant="secondary" inline>
            {list.audience === "external" ? (
              <select name="contact_ids" multiple size={5} className="input w-96" aria-label="Contacts to add">
                {contacts.filter((c) => c.active && !memberIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.full_name} ({c.client_name})</option>)}
              </select>
            ) : (
              <select name="profile_ids" multiple size={5} className="input w-96" aria-label="Staff to add">
                {people.filter((p) => !memberIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <span className="text-xs text-muted">Hold Ctrl to pick several.</span>
          </ActionForm>
        </div>
      )}
      {audience.length === 0 ? <Empty title="Nobody on this list yet" /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><Th>Name</Th><Th>Email</Th><Th>Client</Th><Th>Can be emailed?</Th>{list.kind === "static" && <Th></Th>}</tr></thead>
          <tbody>{audience.map((a) => (
            <tr key={(a.contact_id ?? a.profile_id)!}><Td className="font-semibold">{a.full_name}</Td><Td>{a.email ?? "—"}</Td><Td>{a.client_name}</Td>
              <Td>{a.block ? <span className="text-bad">No: {a.block}</span> : <span className="text-ok">Yes</span>}</Td>
              {list.kind === "static" && <Td><ActionForm action={removeFromList} hidden={{ id: list.id, member: a.contact_id ?? a.profile_id }} submit="Remove" variant="secondary" inline /></Td>}</tr>))}</tbody>
        </table></div>
      )}
    </Panel>
  );
}
