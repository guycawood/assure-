import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getGateDefs, getInternalPeople } from "@/lib/data";
import {
  effectiveGateState, formatDate, GATE_STATUS, label, personName, TICKET_STATUS, TICKET_TYPES, ticketRef, timeAgo,
  RFI_COLUMNS, type Supplier, type SupplierGate, type Ticket, type TicketActivity, type VendorRfi,
} from "@/lib/srt";
import { Card, GateStrip, Pill, RagDot, TierPill } from "@/components/ui";
import { CommentForm, CreateSupplierButton, TicketUpdateForm } from "./forms";
import { OnboardingWorkflow } from "./workflow";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data: t } = await supabase.from("srt_tickets").select("*").eq("id", id).maybeSingle();
  if (!t) notFound();
  const ticket = t as Ticket;

  const [defs, people, activity, supplierRes, gatesRes, rfiRes, emailRes] = await Promise.all([
    getGateDefs(supabase),
    getInternalPeople(supabase),
    supabase.from("srt_ticket_activity").select("*").eq("ticket_id", id).order("created_at"),
    ticket.supplier_id ? supabase.from("suppliers").select("*").eq("id", ticket.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    ticket.supplier_id ? supabase.from("supplier_gates").select("*").eq("supplier_id", ticket.supplier_id) : Promise.resolve({ data: [] }),
    supabase.from("vendor_rfis").select(RFI_COLUMNS).eq("ticket_id", id).order("sent_at", { ascending: false }).limit(1),
    supabase.from("email_outbox").select("to_email, subject, link, created_at, status").eq("ticket_id", id).order("created_at", { ascending: false }).limit(1),
  ]);
  const supplier = supplierRes.data as Supplier | null;
  const rfi = ((rfiRes.data ?? []) as VendorRfi[])[0] ?? null;
  const { data: bankRows } = rfi
    ? await supabase.from("vendor_bank_details").select("bank_name, account_name, account_number, sort_code_or_swift, iban, bank_country").eq("rfi_id", rfi.id).order("submitted_at", { ascending: false }).limit(1)
    : { data: [] };
  const showWorkflow = ticket.type === "new_onboarding" || !!rfi;
  // Internal staff by name; anyone else who acted on the ticket is the vendor; no actor means the system.
  const actorName = (id: string | null) => (!id ? "System" : pMap.has(id) ? personName(pMap.get(id)) : "Vendor");
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
          <span>Raised {timeAgo(ticket.created_at)} by {actorName(ticket.created_by)}</span>
          {ticket.due_date && <span>· Due {formatDate(ticket.due_date)}</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {ticket.description && (
            <Card className="whitespace-pre-wrap p-4 text-sm">{ticket.description}</Card>
          )}
          {showWorkflow && (
            <OnboardingWorkflow
              ticketId={ticket.id}
              rfi={rfi}
              email={((emailRes.data ?? []) as { to_email: string; subject: string; link: string | null; created_at: string; status: string }[])[0] ?? null}
              bank={((bankRows ?? []) as never[])[0] ?? null}
              me={me}
              people={pMap}
              prospectEmail={supplier?.primary_contact_email ?? null}
            />
          )}
          <Card className="p-4">
            <h2 className="mb-3 font-display text-lg font-semibold">Activity</h2>
            <ol className="space-y-3">
              {((activity.data ?? []) as TicketActivity[]).map((a) => (
                <li key={a.id} className="text-sm">
                  <p className="text-xs text-muted"><span className="font-semibold text-fg">{actorName(a.actor)}</span> · {timeAgo(a.created_at)}</p>
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
                <Link href={`/assure/suppliers/${supplier.id}`} className="flex items-center gap-2 font-semibold hover:underline">
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
