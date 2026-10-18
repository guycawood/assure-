import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { formatDate, formatEur, personName, ticketRef, timeAgo } from "@/lib/srt";
import { CASE_STATUS_LABEL, RELATIONSHIPS, SUPPLIER_TYPES, taxonomyOf, TAXONOMY } from "@/lib/onboarding";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { Facts } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { setCaseStatus, triageRequest, type DuplicateMatch } from "@/app/(platform)/assure/onboarding-actions";

export const metadata: Metadata = { title: "Onboarding request" };

type Case = {
  id: string; case_no: number; kind: string; status: string; business_case: string; supplier_type: string; category: string; client: string | null; market: string;
  region: string | null; urgency: string; urgency_reason: string | null; client_need: string | null; required_date: string | null; estimated_spend: number | null;
  currency: string; proposed_name: string; proposed_email: string | null; proposed_contact: string | null; proposed_website: string | null; proposed_vat: string | null;
  proposed_registration: string | null; duplicate_matches: DuplicateMatch[]; duplicate_confirmed: boolean; linked_supplier_id: string | null; supplier_id: string | null;
  ticket_id: string | null; route: string | null; relationship: string | null; triage_note: string | null; decline_reason: string | null; trigger_event: string | null;
  requested_by: string | null; requested_at: string; triaged_by: string | null; triaged_at: string | null; activated_by: string | null; activated_at: string | null;
};

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("onboarding_cases").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Case;
  const [people, { data: events }, { data: canTriage }, { data: ticket }] = await Promise.all([
    getInternalPeople(supabase),
    supabase.from("onboarding_events").select("*").eq("case_id", id).order("at", { ascending: false }),
    supabase.rpc("approval_has_role", { p_role: "procurement", p_module: "assure" }),
    c.ticket_id ? supabase.from("srt_tickets").select("id, ticket_no, status").eq("id", c.ticket_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pMap = byId(people);
  const t = taxonomyOf("case", c.status);
  const supplierMatches = (c.duplicate_matches ?? []).filter((m) => m.kind === "supplier");
  const isRequester = c.requested_by === me.id;

  return (
    <>
      <PageHead title={`Request #${c.case_no}: ${c.proposed_name}`} sub={[c.kind === "revalidation" ? "Revalidation" : "New supplier", c.client, c.market, c.category].filter(Boolean).join(" · ")}
        crumbs={[{ label: "SRM", href: "/assure" }, { label: "Onboarding control", href: "/assure/srt" }, { label: "Requests", href: "/assure/srt/requests" }, { label: `#${c.case_no}` }]} />

      <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <Pill tone={TAXONOMY[t].tone}>{TAXONOMY[t].label}</Pill>
        <span>{CASE_STATUS_LABEL[c.status] ?? c.status}</span>
        {c.urgency === "urgent" && <Pill tone="warn">Urgent</Pill>}
        {c.route && <span>Route: <b>{c.route === "exception" ? "Exception (fast-track)" : "Standard"}</b></span>}
        {c.supplier_id && <Link href={`/assure/suppliers/${c.supplier_id}?tab=record`} className="font-semibold text-accent underline">Open the supplier record</Link>}
        {ticket && <Link href={`/assure/srt/tickets/${(ticket as { id: string }).id}`} className="text-accent underline">{ticketRef((ticket as { ticket_no: number }).ticket_no)}</Link>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Business need and request">
          <div className="space-y-3 p-5 text-sm">
            <p className="whitespace-pre-wrap">{c.business_case}</p>
            <Facts items={[
              ["Supplier type", SUPPLIER_TYPES.find((x) => x.value === c.supplier_type)?.label ?? c.supplier_type], ["Category", c.category], ["Client", c.client],
              ["Market", [c.market, c.region].filter(Boolean).join(" · ")], ["Estimated annual spend", c.estimated_spend != null ? `${formatEur(c.estimated_spend)} (${c.currency})` : null],
              ["Urgency", c.urgency === "urgent" ? `Urgent: ${c.urgency_reason ?? ""}` : "Standard"], ["Client need", c.client_need],
              ["Needed by", c.required_date ? formatDate(c.required_date) : null],
              ["Requested by", `${personName(pMap.get(c.requested_by ?? ""))} · ${formatDate(c.requested_at)}`],
              ["Triaged by", c.triaged_by ? `${personName(pMap.get(c.triaged_by))} · ${formatDate(c.triaged_at)}` : null],
              ["Released by", c.activated_by ? `${personName(pMap.get(c.activated_by))} · ${formatDate(c.activated_at)}` : null],
            ]} />
          </div>
        </Panel>
        <Panel title="Proposed supplier and duplicate check">
          <div className="space-y-3 p-5 text-sm">
            <Facts items={[
              ["Company", c.proposed_name], ["Contact", [c.proposed_contact, c.proposed_email].filter(Boolean).join(" · ")], ["Website", c.proposed_website],
              ["Company registration number", c.proposed_registration], ["VAT / tax number", c.proposed_vat],
            ]} />
            {c.duplicate_matches?.length ? (
              <div className="rounded-lg border border-warn bg-warn-soft p-3">
                <p className="font-semibold">Possible duplicates found at intake{c.duplicate_confirmed ? "; the requester confirmed it is a different company" : ""}</p>
                <ul className="mt-1 space-y-0.5">{c.duplicate_matches.map((m, i) => (
                  <li key={i}>{m.kind === "supplier" ? <Link href={`/assure/suppliers/${m.supplier_id}`} className="underline">{m.name}</Link> : <Link href={`/assure/srt/requests/${m.case_id}`} className="underline">Request #{m.case_no}</Link>}
                    <span className="text-muted"> · {m.reasons.join(", ")}</span></li>
                ))}</ul>
              </div>
            ) : <p className="text-muted">No existing supplier or open request matched.</p>}
            {c.linked_supplier_id && <p>Linked to the existing supplier: <Link href={`/assure/suppliers/${c.linked_supplier_id}`} className="font-semibold underline">open</Link></p>}
            {c.decline_reason && <p className="text-bad">Reason: {c.decline_reason}</p>}
            {c.triage_note && <p className="text-muted">Triage note: {c.triage_note}</p>}
          </div>
        </Panel>
      </div>

      {c.status === "submitted" && (
        <Panel title="Triage (stage 3)" sub="Procurement approves the need and the route. The requester can never triage their own request.">
          <div className="p-5">
            {!canTriage ? <p className="text-sm text-muted">Waiting for Procurement (in-market procurement, the Procurement head or the Procurement Director).</p>
              : isRequester ? <p className="text-sm text-muted">You raised this request, so someone else in Procurement triages it.</p> : (
              <ActionForm action={triageRequest.bind(null, c.id)} submit="Record triage decision" className="grid gap-3 md:grid-cols-2">
                <Field label="Decision"><Select name="decision" required options={[{ value: "approve", label: "Approve the need" }, { value: "duplicate", label: "Duplicate: use the existing supplier" }, { value: "decline", label: "Decline" }]} /></Field>
                <Field label="Route"><Select name="route" defaultValue={c.urgency === "urgent" ? "exception" : "standard"} options={[{ value: "standard", label: "Standard: no PO until every stage is complete" }, { value: "exception", label: "Exception (fast-track): urgent, restricted scope" }]} /></Field>
                <Field label="Relationship"><Select name="relationship" blank="Choose" options={RELATIONSHIPS} /></Field>
                <Field label="Existing supplier (for a duplicate, or to extend an existing supplier)">
                  <Select name="existing_supplier" blank="New supplier" defaultValue={c.linked_supplier_id} options={supplierMatches.map((m) => ({ value: m.supplier_id!, label: `${m.name}${m.supplier_code ? ` (${m.supplier_code})` : ""}` }))} />
                </Field>
                <Field label="Note" className="md:col-span-2"><input name="note" className="input" placeholder="Required when declining" /></Field>
              </ActionForm>
            )}
          </div>
        </Panel>
      )}

      {["submitted", "in_onboarding", "on_hold"].includes(c.status) && (isRequester || canTriage) && (
        <Panel title={c.status === "on_hold" ? "Resume or withdraw" : "Put on hold or withdraw"}>
          <div className="p-5">
            <ActionForm action={setCaseStatus.bind(null, c.id)} submit="Save" variant="secondary" inline>
              <Field label="Change to"><Select name="status" options={c.status === "on_hold" ? [{ value: "in_onboarding", label: "Resume" }, { value: "withdrawn", label: "Withdraw" }] : [{ value: "on_hold", label: "On hold" }, { value: "withdrawn", label: "Withdraw" }]} /></Field>
              <Field label="Reason"><input name="note" required className="input min-w-[260px]" /></Field>
            </ActionForm>
          </div>
        </Panel>
      )}

      <Panel title="History">
        <ol className="space-y-2 p-5 text-sm">
          {((events ?? []) as { id: number; title: string; actor: string | null; at: string }[]).map((e) => (
            <li key={e.id}><span className="font-semibold">{e.title}</span><span className="block text-xs text-muted">{e.actor ? personName(pMap.get(e.actor)) : "System"} · {timeAgo(e.at)}</span></li>
          ))}
          {(events ?? []).length === 0 && <li className="text-muted">Nothing recorded yet.</li>}
        </ol>
      </Panel>
    </>
  );
}
