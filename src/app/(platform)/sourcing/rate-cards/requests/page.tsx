import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink, Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { fmtDateTime } from "@/components/sourcing/bits";
import { buildCardFromRequest, declineRequest, startPricing, takeRequest } from "../request-actions";

export const metadata: Metadata = { title: "Rate card requests" };

type Req = {
  id: string; request_no: string; title: string; spec_type: string; substrate_code: string | null; length_mm: number | null; width_mm: number | null;
  min_qty: number | null; max_qty: number | null; client_name: string | null; market: string | null; reason: string;
  status: "requested" | "taken" | "pricing" | "drafted" | "approved" | "declined"; requester_name: string | null; owner_name: string | null;
  rfq_id: string | null; card_code: string | null; card_status: string | null; decline_reason: string | null; waiting_briefs: number; age_days: number; created_at: string; mine: boolean;
};

const TONE = { requested: "warn", taken: "info", pricing: "info", drafted: "info", approved: "ok", declined: "neutral" } as const;
const LABEL = { requested: "Requested", taken: "Taken", pricing: "Pricing", drafted: "Card drafted", approved: "Approved", declined: "Declined" } as const;

// The sourcing team's queue for new rate cards: take it, price it, build the card; the request closes when the card is approved and graded.
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ show?: string; requested?: string }> }) {
  await requireInternal();
  const { show, requested } = await searchParams;
  const supabase = await createClient();
  const [list, suppliers, rfqs] = await Promise.all([
    supabase.rpc("rate_card_requests_list"),
    supabase.from("suppliers").select("supplier_code, name").eq("active", true).eq("purchasing_blocked", false).order("name"),
    supabase.from("rfqs").select("id, rfq_number, title").order("created_at", { ascending: false }).limit(50),
  ]);
  const all = (list.data as Req[] | null) ?? [];
  const open = all.filter((r) => r.status !== "approved" && r.status !== "declined");
  const shown = show === "closed" ? all.filter((r) => !open.includes(r)) : show === "mine" ? open.filter((r) => r.mine) : open;
  const tab = (key: string, label: string, n: number) => (
    <Link href={key === "open" ? "/sourcing/rate-cards/requests" : `/sourcing/rate-cards/requests?show=${key}`}
      className={`border-b-2 px-3 py-2 text-sm font-semibold ${(show ?? "open") === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>{label} ({n})</Link>
  );
  const sup = (suppliers.data ?? []) as { supplier_code: string; name: string }[];
  const rf = (rfqs.data ?? []) as { id: string; rfq_number: string; title: string }[];

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: "Rate cards", href: "/sourcing/rate-cards" }, { label: "Requests" }]} title="Rate card requests"
        sub="Cards people have asked for. Take one, get the price, build the card. It closes when the card is approved and its Impact Grade is reviewed.">
        <ButtonLink href="/briefing/new/rate-card/request" variant="primary">Request a rate card</ButtonLink>
      </PageHead>
      {requested && <Card className="border-ok/40 bg-ok-soft px-5 py-3 text-sm">Request sent. The sourcing leads have been told.</Card>}
      <nav className="flex gap-1 border-b border-line">{tab("open", "Open", open.length)}{tab("mine", "Mine", open.filter((r) => r.mine).length)}{tab("closed", "Closed", all.length - open.length)}</nav>

      <Panel title={show === "closed" ? "Closed requests" : show === "mine" ? "My requests" : "Open requests"} sub={`${shown.length} request(s), oldest first`}>
        {shown.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing here.</p> : (
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.id} className="space-y-3 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{r.title}</b> <span className="text-xs text-muted">{r.request_no}</span> <Pill tone={TONE[r.status]}>{LABEL[r.status]}</Pill>
                  {r.waiting_briefs > 0 && <Pill tone="warn">{r.waiting_briefs} brief{r.waiting_briefs === 1 ? "" : "s"} waiting</Pill>}
                </div>
                <p className="text-muted">
                  {r.length_mm && r.width_mm ? `${r.length_mm} × ${r.width_mm} mm · ` : ""}{r.min_qty || r.max_qty ? `${r.min_qty ?? 1} to ${r.max_qty ?? "no limit"} units · ` : ""}
                  {r.client_name ?? "any client"}{r.market ? ` · ${r.market}` : ""} · asked by {r.requester_name ?? "someone"} {r.age_days === 0 ? "today" : `${r.age_days} day${r.age_days === 1 ? "" : "s"} ago`}{r.owner_name ? ` · owned by ${r.owner_name}` : ""}
                </p>
                <p>{r.reason}</p>
                {r.decline_reason && <p className="text-muted">Declined: {r.decline_reason}</p>}

                {r.status === "requested" && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <ActionForm action={takeRequest} hidden={{ id: r.id }} submit="Take this request" variant="primary" />
                    <ActionForm action={declineRequest} hidden={{ id: r.id }} submit="Decline" variant="secondary">
                      <Field label="Reason" htmlFor={`dc-${r.id}`}><input id={`dc-${r.id}`} name="reason" required className="input" /></Field>
                    </ActionForm>
                  </div>
                )}
                {(r.status === "taken" || r.status === "pricing") && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <ActionForm action={startPricing} hidden={{ id: r.id }} submit={r.status === "pricing" ? "Update the RFQ link" : "Start pricing"} variant="secondary">
                      <Field label="RFQ used to get the price" htmlFor={`rf-${r.id}`} hint="Optional."><select id={`rf-${r.id}`} name="rfq" className="input"><option value="">None</option>{rf.map((x) => <option key={x.id} value={x.id}>{x.rfq_number} · {x.title}</option>)}</select></Field>
                    </ActionForm>
                    <ActionForm action={buildCardFromRequest} hidden={{ id: r.id }} submit="Build the card" variant="primary">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="Supplier" htmlFor={`sp-${r.id}`}><select id={`sp-${r.id}`} name="supplier" required className="input">{sup.map((s) => <option key={s.supplier_code} value={s.supplier_code}>{s.name}</option>)}</select></Field>
                        <Field label="Agreed unit price" htmlFor={`pr-${r.id}`}><input id={`pr-${r.id}`} name="price" type="number" min={0} step="any" required className="input" /></Field>
                        <Field label="Currency" htmlFor={`cu-${r.id}`}><input id={`cu-${r.id}`} name="currency" defaultValue="EUR" maxLength={3} className="input" /></Field>
                        <Field label="Valid from" htmlFor={`fr-${r.id}`} hint="Optional."><input id={`fr-${r.id}`} name="from" type="date" className="input" /></Field>
                      </div>
                    </ActionForm>
                  </div>
                )}
                {r.status === "drafted" && (
                  <p>Card <b>{r.card_code}</b> is {r.card_status === "pending_approval" ? "waiting for a different governor to approve it" : "approved and waiting for its Impact Grade to be reviewed"}. <Link className="font-semibold text-accent hover:underline" href="/sourcing/rate-cards?show=needs">Open it in Rate cards</Link>.</p>
                )}
                {r.status === "approved" && (
                  <p>Card <b>{r.card_code}</b> is approved. <Link className="font-semibold text-accent hover:underline" href="/briefing/new/rate-card">Start a brief from it</Link>.</p>
                )}
                <p className="text-xs text-muted">Sent {fmtDateTime(r.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
