import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getCadence, getClients, getContracts, getCrmActions, getPeople, getReviews, getSurveyWaves } from "@/lib/crm-data";
import { REVIEW_TYPE } from "@/lib/crm";
import { monthGrid, monthLabel } from "@/lib/assure";
import { Card, PageHead, Panel, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { MonthCalendar, type CalEvent } from "@/components/assure/bits";
import { fmtDate } from "@/components/sourcing/bits";
import { ClientLink, Select, clientOptions, peopleOptions } from "@/components/crm/bits";

export const metadata: Metadata = { title: "Calendar · CRM" };

// Client reviews, contract renewals, survey waves and action due dates in one month view (like SRM's audit calendar).
export default async function CrmCalendar({ searchParams }: { searchParams: Promise<{ month?: string; lead?: string; client?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date().toISOString().slice(0, 7);
  const supabase = await createClient();
  const [reviews, contracts, waves, actions, cadence, accounts, clients, people] = await Promise.all([getReviews(supabase), getContracts(supabase), getSurveyWaves(supabase),
    getCrmActions(supabase), getCadence(supabase), getAccounts(supabase), getClients(supabase), getPeople(supabase)]);
  const leadClients = sp.lead ? new Set(accounts.filter((a) => a.account_lead === sp.lead).map((a) => a.client_id)) : null;
  const keep = (clientId: string) => (!sp.client || clientId === sp.client) && (!leadClients || leadClients.has(clientId));

  const events: CalEvent[] = [
    ...reviews.filter((r) => r.status !== "cancelled" && keep(r.client_id)).map((r) => ({
      date: r.scheduled_on, label: `${REVIEW_TYPE[r.review_type]}: ${r.client_name}`, href: `/crm/reviews/${r.id}`, icon: "groups",
      tone: (r.past_due ? "bad" : r.status === "planned" ? "info" : "ok") as CalEvent["tone"],
    })),
    ...contracts.filter((k) => k.status === "signed" && k.next_renewal && keep(k.client_id)).map((k) => ({
      date: k.next_renewal!, label: `Renewal: ${k.client_name}`, href: `/crm/contracts?contract=${k.id}`, icon: "contract", tone: "accent" as const,
    })),
    ...(sp.client || sp.lead ? [] : waves.flatMap((w) => [
      ...(w.sent_at ? [{ date: w.sent_at.slice(0, 10), label: `Survey sent: ${w.name}`, href: `/crm/surveys/${w.id}`, icon: "send", tone: "neutral" as const }] : []),
      ...(w.closes_on ? [{ date: w.closes_on, label: `Survey closes: ${w.name}`, href: `/crm/surveys/${w.id}`, icon: "reviews", tone: "warn" as const }] : []),
    ])),
    ...actions.filter((a) => a.due_date && (a.status === "open" || a.status === "in_progress") && keep(a.client_id)).map((a) => ({
      date: a.due_date!, label: `${a.title}: ${a.client_name}`, href: a.plan_id ? "/crm/plans" : a.review_id ? `/crm/reviews/${a.review_id}` : "/crm/actions",
      icon: "task_alt", tone: (a.overdue ? "bad" : "warn") as CalEvent["tone"],
    })),
  ];
  const inMonth = events.filter((e) => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
  const overdue = cadence.filter((c) => c.review_overdue && keep(c.client_id));
  const [y, m] = month.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const link = (mo: string) => `/crm/calendar?${new URLSearchParams(Object.entries({ month: mo, lead: sp.lead, client: sp.client }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const leads = people.filter((p) => accounts.some((a) => a.account_lead === p.id));

  return (
    <>
      <PageHead title="Calendar" sub="Client business reviews, contract renewals, survey waves and action due dates. Dates are changed on the record itself, with its audit trail."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Calendar" }]} />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="month" value={month} />
        <Select name="lead" label="Account lead" options={peopleOptions(leads)} value={sp.lead} empty="Everyone" />
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter</button>
        {(sp.lead || sp.client) && <Link href={`/crm/calendar?month=${month}`} className="pb-2 text-sm text-accent underline">Clear</Link>}
      </form>
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label={`Events in ${monthLabel(month)}`} value={inMonth.length} icon={<MSymbol name="calendar_month" />} />
        <Stat label="Reviews this month" value={inMonth.filter((e) => e.icon === "groups").length} icon={<MSymbol name="groups" />} />
        <Stat label="Clients overdue a review" value={overdue.length} tone={overdue.length ? "bad" : "ok"} hint="By the account tier's cadence" icon={<MSymbol name="event_busy" />} />
      </section>
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Link href={link(prev)} className="rounded-lg border border-line px-2 py-1" aria-label="Previous month"><MSymbol name="chevron_left" size={18} /></Link>
            <span className="min-w-36 text-center font-semibold">{monthLabel(month)}</span>
            <Link href={link(next)} className="rounded-lg border border-line px-2 py-1" aria-label="Next month"><MSymbol name="chevron_right" size={18} /></Link>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-info-soft" />Review planned</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-ok-soft" />Review held</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-accent-soft" />Contract renewal</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-warn-soft" />Action or survey due</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-bad-soft" />Overdue</span>
          </div>
        </div>
        <MonthCalendar weeks={monthGrid(month)} month={month} events={events} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="This month">
          {inMonth.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing due.</p> : (
            <ul className="divide-y divide-line">{inMonth.map((e, i) => <li key={i} className="flex justify-between gap-2 px-5 py-2 text-sm"><Link href={e.href ?? "#"} className="hover:text-accent">{e.label}</Link><span className="text-xs text-muted">{fmtDate(e.date)}</span></li>)}</ul>
          )}
        </Panel>
        <Panel title="Overdue reviews" sub="No review within the tier's cadence">
          {overdue.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Every client is within cadence.</p> : (
            <ul className="divide-y divide-line">{overdue.map((c) => (
              <li key={c.client_id} className="px-5 py-2 text-sm"><ClientLink id={c.client_id} name={c.client_name} />
                <span className="block text-xs text-muted">Due {fmtDate(c.review_due_on)} ({c.tiers}, every {c.cadence_days} days) · {c.next_planned_on ? `next planned ${fmtDate(c.next_planned_on)}` : "nothing planned"} · {c.account_leads ?? "no lead"}</span></li>))}</ul>
          )}
        </Panel>
      </div>
    </>
  );
}
