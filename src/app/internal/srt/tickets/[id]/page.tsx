import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getGateDefs, getInternalPeople } from "@/lib/data";
import {
  effectiveGateState, formatDate, GATE_STATUS, label, personName, TICKET_STATUS, TICKET_TYPES, ticketRef, timeAgo,
  type Supplier, type SupplierGate, type Ticket, type TicketActivity,
} from "@/lib/srt";
import { Card, GateStrip, Pill, RagDot, TierPill } from "@/components/ui";
import { CommentForm, CreateSupplierButton, TicketUpdateForm } from "./forms";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data: t } = await supabase.from("srt_tickets").select("*").eq("id", id).maybeSingle();
  if (!t) notFound();
  const ticket = t as Ticket;

  const [defs, people, activity, supplierRes, gatesRes] = await Promise.all([
    getGateDefs(supabase),
    getInternalPeople(supabase),
    supabase.from("srt_ticket_activity").select("*").eq("ticket_id", id).order("created_at"),
    ticket.supplier_id ? supabase.from("suppliers").select("*").eq("id", ticket.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    ticket.supplier_id ? supabase.from("supplier_gates").select("*").eq("supplier_id", ticket.supplier_id) : Promise.resolve({ data: [] }),
  ]);
  const supplier = supplierRes.data as Supplier | null;
  const gates = (gatesRes.data ?? []) as SupplierGate[];
  const pMap = byId(people);
  const st = TICKET_STATUS.find((s) => s.value === ticket.status)!;
  const gateDef = defs.find((d) => d.key === ticket.gate_key);
  const gate = gates.find((g) => g.gate_key === ticket.gate_key);
  const canChangeDue = me.is_admin || me.srt_role === "lead";

  return (
    <>
      <div>
        <p className="eyebrow">{ticketRef(ticket.ticket_no)} · {label(TICKET_TYPES, ticket.type)}</p>
        <h1 className="font-display text-[1.7rem] font-bold leading-tight">{ticket.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Pill tone={st.tone}>{st.label}</Pill>
          <span>Raised {timeAgo(ticket.created_at)} by {personName(ticket.created_by ? pMap.get(ticket.created_by) : null)}</span>
          {ticket.due_date && <span>· Due {formatDate(ticket.due_date)}</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {ticket.description && (
            <Card className="whitespace-pre-wrap p-4 text-sm">{ticket.description}</Card>
          )}
          <Card className="p-4">
            <h2 className="mb-3 font-display text-lg font-semibold">Activity</h2>
            <ol className="space-y-3">
              {((activity.data ?? []) as TicketActivity[]).map((a) => (
                <li key={a.id} className="text-sm">
                  <p className="text-xs text-muted"><span className="font-semibold text-fg">{a.actor ? personName(pMap.get(a.actor)) : "System"}</span> · {timeAgo(a.created_at)}</p>
                  {a.kind === "comment" ? <p className="mt-0.5 whitespace-pre-wrap rounded bg-surface-2 px-3 py-2">{a.body}</p> : <p>{a.body}</p>}
                </li>
              ))}
            </ol>
            <div className="mt-4"><CommentForm ticketId={ticket.id} /></div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <h2 className="mb-3 font-display text-lg font-semibold">Work this ticket</h2>
            <TicketUpdateForm
              ticket={{ id: ticket.id, status: ticket.status, priority: ticket.priority, assignee: ticket.assignee, owner: ticket.owner, due_date: ticket.due_date, resolution: ticket.resolution }}
              people={people.map((p) => ({ id: p.id, name: p.full_name || p.email }))}
              canChangeDue={canChangeDue}
              gateLabel={gateDef && supplier && gate && !["verified", "not_required"].includes(gate.status) ? gateDef.label : null}
            />
          </Card>

          <Card className="space-y-2 p-4 text-sm">
            <h2 className="font-display text-lg font-semibold">Supplier</h2>
            {supplier ? (
              <>
                <Link href={`/internal/suppliers/${supplier.id}`} className="flex items-center gap-2 font-semibold hover:underline">
                  <RagDot rag={supplier.rag} /> {supplier.name}
                </Link>
                <div className="flex items-center gap-2"><GateStrip defs={defs} gates={gates} /><TierPill tier={supplier.priority_tier} /></div>
                <p className="text-muted">{[supplier.client, supplier.market].filter(Boolean).join(" · ")}</p>
                {supplier.purchasing_blocked && <Pill tone="bad">Purchasing blocked</Pill>}
                {gateDef && gate && (
                  <p className="pt-1">
                    Gate: <span className="font-semibold">{gateDef.label}</span> — {GATE_STATUS.find((s) => s.value === effectiveGateState(gate))?.label ?? "Expired"}
                  </p>
                )}
              </>
            ) : (
              <>
                <p>New request for <span className="font-semibold">{ticket.prospect_name}</span>{ticket.market ? ` (${ticket.market})` : ""}.</p>
                <CreateSupplierButton ticketId={ticket.id} />
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
