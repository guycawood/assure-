import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople, getSuppliers, getTickets } from "@/lib/data";
import { isOverdue, TICKET_STATUS, TICKET_TYPES } from "@/lib/srt";
import { ButtonLink, Card, Empty, PageHead, Pill } from "@/components/ui";
import { TicketTable } from "../ticket-table";

export const metadata: Metadata = { title: "Ticket queue" };

const PRI_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const who = sp.who ?? "all";
  const type = sp.type ?? "all";
  const q = (sp.q ?? "").trim().toLowerCase();

  const supabase = await createClient();
  const [tickets, suppliers, people] = await Promise.all([getTickets(supabase), getSuppliers(supabase), getInternalPeople(supabase)]);
  const sMap = byId(suppliers);

  let list = tickets;
  if (status === "open") list = list.filter((t) => t.status !== "resolved");
  else if (status !== "all") list = list.filter((t) => t.status === status);
  if (who === "me") list = list.filter((t) => t.assignee === me.id);
  if (who === "none") list = list.filter((t) => !t.assignee);
  if (type !== "all") list = list.filter((t) => t.type === type);
  if (q) list = list.filter((t) => `${t.title} ${t.ticket_no} ${t.supplier_id ? sMap.get(t.supplier_id)?.name : t.prospect_name}`.toLowerCase().includes(q));
  list = [...list].sort(
    (a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || PRI_RANK[a.priority] - PRI_RANK[b.priority] || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"),
  );

  return (
    <>
      <PageHead title="Ticket queue" sub="Onboarding requests, document checks and remediation, each with an SLA due date set by ticket type.">
        <ButtonLink href="/internal/srt/tickets/new" variant="primary">Raise ticket</ButtonLink>
      </PageHead>

      <form className="flex flex-wrap items-center gap-2" method="get">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search title, supplier or number" className="input w-64" aria-label="Search tickets" />
        <select name="status" defaultValue={status} className="input w-auto" aria-label="Status">
          <option value="open">All open</option>
          <option value="all">All</option>
          {TICKET_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select name="who" defaultValue={who} className="input w-auto" aria-label="Assignee">
          <option value="all">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
        </select>
        <select name="type" defaultValue={type} className="input w-auto" aria-label="Type">
          <option value="all">All types</option>
          {TICKET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
      </form>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {TICKET_STATUS.map((s) => (
          <span key={s.value} className="inline-flex items-center gap-1.5">
            <Pill tone={s.tone}>{tickets.filter((t) => t.status === s.value).length}</Pill>
            {s.label}
          </span>
        ))}
      </div>

      <Card className="min-w-0">
        {tickets.length === 0 ? (
          <Empty title="No tickets yet">
            <p>Raise a ticket for each new onboarding request, missing document, certificate renewal, bank detail change or remediation task.</p>
          </Empty>
        ) : list.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No tickets match these filters.</p>
        ) : (
          <TicketTable tickets={list} suppliers={sMap} people={byId(people)} />
        )}
      </Card>
    </>
  );
}
