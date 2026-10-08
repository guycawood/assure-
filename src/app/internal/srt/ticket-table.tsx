import Link from "next/link";
import { formatDate, isOverdue, label, personName, PRIORITIES, TICKET_STATUS, TICKET_TYPES, ticketRef, timeAgo, type Profile, type Supplier, type Ticket } from "@/lib/srt";
import { Pill } from "@/components/ui";

const priorityClass: Record<string, string> = { urgent: "text-bad", high: "text-warn", normal: "text-muted", low: "text-muted/70" };

export function TicketTable({
  tickets, suppliers, people, compact = false,
}: { tickets: Ticket[]; suppliers: Map<string, Supplier>; people: Map<string, Profile>; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="th">Ref</th>
            <th className="th">Ticket</th>
            {!compact && <th className="th">Type</th>}
            {!compact && <th className="th">Priority</th>}
            <th className="th">Status</th>
            <th className="th">Assignee</th>
            <th className="th">Due</th>
            {!compact && <th className="th">Opened</th>}
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const st = TICKET_STATUS.find((s) => s.value === t.status)!;
            const vendor = t.supplier_id ? suppliers.get(t.supplier_id)?.name : t.prospect_name;
            const od = isOverdue(t);
            return (
              <tr key={t.id} className="hover:bg-surface-2">
                <td className="td whitespace-nowrap font-mono text-xs text-muted">{ticketRef(t.ticket_no)}</td>
                <td className="td min-w-[220px]">
                  <Link href={`/internal/srt/tickets/${t.id}`} className="font-semibold hover:underline">{t.title}</Link>
                  <div className="text-xs text-muted">{[vendor, compact ? label(TICKET_TYPES, t.type) : null].filter(Boolean).join(" · ")}</div>
                </td>
                {!compact && <td className="td whitespace-nowrap text-xs text-muted">{label(TICKET_TYPES, t.type)}</td>}
                {!compact && <td className={`td text-xs font-bold ${priorityClass[t.priority]}`}>{label(PRIORITIES, t.priority)}</td>}
                <td className="td"><Pill tone={st.tone}>{st.label}</Pill></td>
                <td className="td whitespace-nowrap">{t.assignee ? personName(people.get(t.assignee)) : <span className="text-muted">Unassigned</span>}</td>
                <td className={`td whitespace-nowrap font-mono text-xs ${od ? "font-semibold text-bad" : ""}`}>{od ? `Overdue ${formatDate(t.due_date)}` : formatDate(t.due_date)}</td>
                {!compact && <td className="td whitespace-nowrap text-xs text-muted">{timeAgo(t.created_at)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
