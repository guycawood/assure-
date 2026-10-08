import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getGateDefs, getInternalPeople } from "@/lib/data";
import { formatDate, personName, RAG_LABEL, TIER_LABEL, timeAgo, type Supplier, type SupplierGate, type Ticket } from "@/lib/srt";
import { updateSupplier } from "@/app/internal/actions";
import { ButtonLink, Card, GateStrip, Pill, RagDot, TierPill } from "@/components/ui";
import { TicketTable } from "@/app/internal/srt/ticket-table";
import { SupplierForm } from "../supplier-form";
import { FastTrackForm, GapTicketsButton, GateTable } from "./gate-table";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const s = data as Supplier;

  const [defs, people, gatesRes, ticketsRes, auditRes] = await Promise.all([
    getGateDefs(supabase),
    getInternalPeople(supabase),
    supabase.from("supplier_gates").select("*").eq("supplier_id", id),
    supabase.from("srt_tickets").select("*").eq("supplier_id", id).order("created_at", { ascending: false }),
    supabase.from("gate_audit_log").select("*").eq("supplier_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  const gates = (gatesRes.data ?? []) as SupplierGate[];
  const tickets = (ticketsRes.data ?? []) as Ticket[];
  const pMap = byId(people);
  const peopleOpts = people.map((p) => ({ id: p.id, name: p.full_name || p.email }));
  const labelOf = new Map(defs.map((d) => [d.key, d.label]));
  const role = me.is_admin ? "admin" : me.srt_role;
  const isLead = me.is_admin || me.srt_role === "lead";
  const openTickets = tickets.filter((t) => t.status !== "resolved");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{[s.supplier_code, s.client, s.market].filter(Boolean).join(" · ") || "Supplier"}</p>
          <h1 className="font-display text-[1.7rem] font-bold leading-tight">{s.name}</h1>
        </div>
        <ButtonLink href={`/internal/srt/tickets/new?supplier=${s.id}`} variant="primary">Raise ticket</ButtonLink>
      </div>

      <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold"><RagDot rag={s.rag} /> {RAG_LABEL[s.rag]}</span>
        <GateStrip defs={defs} gates={gates} />
        <span className="font-mono">{s.gates_clear}/{defs.length} gates clear</span>
        <span className="inline-flex items-center gap-1.5"><TierPill tier={s.priority_tier} />{s.priority_tier && <span className="text-muted">{TIER_LABEL[s.priority_tier]}</span>}</span>
        {s.purchasing_blocked ? <Pill tone="bad">Purchasing blocked</Pill> : <Pill tone="ok">Purchasing allowed</Pill>}
        {s.onboarding_route === "fast_track" && (
          <Pill tone="warn">
            Fast-track{s.fast_track_close_by ? ` until ${formatDate(s.fast_track_close_by)}` : ""}{s.fast_track_approved_by ? "" : " · not approved"}
          </Pill>
        )}
      </Card>

      <Card className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Onboarding gates</h2>
            <p className="text-xs text-muted">Changes save immediately and are written to the audit trail. Vendor uploads never verify a gate.</p>
          </div>
          {s.critical_open > 0 && <GapTicketsButton supplierId={s.id} />}
        </div>
        <GateTable supplierId={s.id} defs={defs} gates={gates} people={Object.fromEntries(people.map((p) => [p.id, p.full_name || p.email]))} role={role} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <h2 className="px-4 pb-2 pt-4 font-display text-lg font-semibold">Tickets ({openTickets.length} open)</h2>
          {tickets.length ? <TicketTable tickets={tickets} suppliers={new Map([[s.id, s]])} people={pMap} compact /> : <p className="px-4 pb-5 text-sm text-muted">No tickets for this supplier.</p>}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">Fast-track exception</h2>
          {s.fast_track_approved_by ? (
            <div className="space-y-1 text-sm">
              <p>Approved by <b>{personName(pMap.get(s.fast_track_approved_by))}</b> {s.fast_track_approved_at ? timeAgo(s.fast_track_approved_at) : ""}.</p>
              <p>All critical gates must close by <b>{formatDate(s.fast_track_close_by)}</b>. After that date purchasing is blocked automatically.</p>
              {s.fast_track_justification && <p className="text-muted">Reason: {s.fast_track_justification}</p>}
            </div>
          ) : isLead ? (
            <FastTrackForm supplierId={s.id} />
          ) : (
            <p className="text-sm text-muted">An SRT lead can approve a time-limited fast-track exception, which lets purchasing continue while critical gates are closed.</p>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">Supplier details</h2>
        <SupplierForm action={updateSupplier.bind(null, s.id)} supplier={s} people={peopleOpts} submitLabel="Save details" />
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 font-display text-lg font-semibold">Audit trail</h2>
        {(auditRes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">No gate changes recorded yet.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {(auditRes.data ?? []).map((a) => (
              <li key={a.id}>
                <span className="font-semibold">{labelOf.get(a.gate_key) ?? a.gate_key}</span>
                {a.from_status !== a.to_status && <>: {a.from_status} → {a.to_status}</>}
                {a.expiry_from !== a.expiry_to && <>, expiry {a.expiry_to ? formatDate(a.expiry_to) : "cleared"}</>}
                {a.note && <span className="text-muted"> ({a.note})</span>}
                <span className="block text-xs text-muted">{personName(pMap.get(a.actor))} · {timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
