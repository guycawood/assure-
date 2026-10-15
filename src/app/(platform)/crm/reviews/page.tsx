import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getCadence, getClients, getContacts, getPeople, getReviews } from "@/lib/crm-data";
import { REVIEW_STATUS, REVIEW_TYPE } from "@/lib/crm";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { ClientLink, Disclosure, Input, Select, TextArea, clientOptions } from "@/components/crm/bits";
import { saveReview } from "../actions";

export const metadata: Metadata = { title: "Business reviews · CRM" };

// Client business reviews (QBR, half-year, annual, ad hoc) and who is overdue one by their tier's cadence.
export default async function CrmReviews({ searchParams }: { searchParams: Promise<{ status?: string; client?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, cadence, clients, accounts, contacts, people] = await Promise.all([getReviews(supabase, { client_id: sp.client }), getCadence(supabase), getClients(supabase),
    getAccounts(supabase), getContacts(supabase), getPeople(supabase)]);
  const rows = all.filter((r) => !sp.status || r.status === sp.status);
  const overdue = cadence.filter((c) => c.review_overdue);
  const upcoming = all.filter((r) => r.status === "planned" && !r.past_due);

  return (
    <>
      <PageHead title="Business reviews" sub="QBRs, half-year and annual reviews with each client: agenda, attendees, a pack built from CRM data, outcomes and actions. Planned, then held, then closed with outcomes recorded."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Business reviews" }]}>
        <Link href="/crm/calendar" className="text-sm font-semibold text-accent underline">Calendar</Link>
        <Link href="/crm/actions" className="text-sm font-semibold text-accent underline">Actions</Link>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Upcoming" value={upcoming.length} icon={<MSymbol name="event" />} />
        <Stat label="Held, outcomes to close" value={all.filter((r) => r.status === "held").length} tone={all.some((r) => r.status === "held") ? "warn" : undefined} icon={<MSymbol name="edit_note" />} />
        <Stat label="Clients overdue a review" value={overdue.length} tone={overdue.length ? "bad" : "ok"} hint="By their account tier's review cadence" icon={<MSymbol name="event_busy" />} />
        <Stat label="Planned but past the date" value={all.filter((r) => r.past_due).length} tone={all.some((r) => r.past_due) ? "warn" : undefined} icon={<MSymbol name="history" />} />
      </div>

      {overdue.length > 0 && (
        <Panel title="Overdue by cadence" sub="Last review (or first account, if never reviewed) plus the tier's review cadence has passed">
          <ul className="divide-y divide-line">{overdue.map((c) => (
            <li key={c.client_id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <ClientLink id={c.client_id} name={c.client_name} />
              <span className="text-xs text-muted">{c.tiers} · every {c.cadence_days} days · last review {fmtDate(c.last_review_on)} · due {fmtDate(c.review_due_on)}</span>
              <span className="ml-auto text-xs">{c.next_planned_on ? `Next planned ${fmtDate(c.next_planned_on)}` : <span className="text-bad">Nothing planned</span>}</span>
            </li>))}</ul>
        </Panel>
      )}

      <form className="flex flex-wrap items-end gap-3" method="get">
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <Select name="status" label="Status" options={Object.entries(REVIEW_STATUS).map(([v, s]) => ({ value: v, label: s.label }))} value={sp.status} empty="Any" />
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter</button>
      </form>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No reviews" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Review</Th><Th>Client</Th><Th>Date</Th><Th>Attendees</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><Td><Link className="font-semibold hover:underline" href={`/crm/reviews/${r.id}`}>{r.title}</Link><div className="text-xs text-muted">{REVIEW_TYPE[r.review_type]}</div></Td>
                <Td><ClientLink id={r.client_id} name={r.client_name} />{r.account_market && <div className="text-xs text-muted">{r.account_market}</div>}</Td>
                <Td className={r.past_due ? "text-warn" : ""}>{fmtDate(r.scheduled_on)}{r.past_due && <div className="text-xs">Past the date: mark held or cancel</div>}</Td>
                <Td className="text-xs">{[...(r.internal_attendee_names ?? []), ...(r.contact_attendee_names ?? [])].join(", ") || "—"}{r.client_confirmed > 0 && <div className="text-ok">{r.client_confirmed} confirmed in the portal</div>}</Td>
                <Td><StatusPill meta={REVIEW_STATUS} value={r.status} /></Td><Td>{r.actions}</Td></tr>))}</tbody>
          </table>
        )}
      </Card>

      <Disclosure summary="Plan a review">
        <ActionForm action={saveReview} submit="Plan review" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select name="client_id" label="Client" options={clientOptions(clients.filter((c) => c.active))} empty="Choose…" required value={sp.client} />
          <Select name="account_id" label="Account (market)" options={accounts.map((a) => ({ value: a.id, label: `${a.client_name} · ${a.market_name ?? a.market}` }))} empty="Whole client" />
          <Select name="review_type" label="Type" options={Object.entries(REVIEW_TYPE).map(([v, l]) => ({ value: v, label: l }))} value="qbr" />
          <Input name="title" label="Title" required />
          <Input name="scheduled_on" label="Date" type="date" required />
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="hidden" name="visible_field" value="1" /><input type="checkbox" name="client_visible" defaultChecked /> Show the date to the client in the portal</label>
          <TextArea name="agenda" label="Agenda (one item per line)" rows={4} required className="sm:col-span-2 lg:col-span-3" />
          <label className="block"><span className="label">adm Indicia attendees</span>
            <select name="internal_attendees" multiple size={5} className="input">{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block sm:col-span-2"><span className="label">Client attendees (contacts of that client; Ctrl to pick several)</span>
            <select name="contact_attendees" multiple size={5} className="input">{contacts.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.full_name} ({c.client_name})</option>)}</select></label>
        </ActionForm>
      </Disclosure>
      <Card className="px-5 py-3 text-xs text-muted">Review cadence per tier (strategic, key, growth, BAU) is set in the account tiers library in the <Link className="underline" href="/crm/watchtower">CRM Watchtower</Link>. <Pill>{cadence.filter((c) => c.cadence_days).length} clients have a cadence</Pill></Card>
    </>
  );
}
