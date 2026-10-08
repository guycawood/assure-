import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEvents, getLibrary, getMyAccess, getPeople, getSpecs, one, rows } from "@/lib/sourcing-data";
import { money, unitMoney, type SourcingClient } from "@/lib/sourcing";
import {
  computeLineBenchmark, curveScenario, FINANCE_STATUS, INVITE_STATUS, isBiddingOpen, priceDispersion, QUOTE_STATUS, rfqStatus,
  type ResponsePrice, type Rfq, type RfqInvitation, type RfqLine, type RfqResponse,
} from "@/lib/rfq";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Facts, StatusPill, Td, Th, fmtDateTime } from "@/components/sourcing/bits";
import { approveHighValue, awardRfq, cancelRfq, financeDecide, logQuote, sendRfq, setSuppliers } from "../actions";

export const metadata: Metadata = { title: "RFQ" };

type Eligible = { id: string; supplier_code: string | null; name: string; market: string | null; region: string | null; category: string | null; rag: string };

export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const rfq = await one<Rfq>(supabase, "v_rfqs", id);
  if (!rfq) notFound();
  const [lines, invites, responses, specs, pool, bypass, events, people, access, job] = await Promise.all([
    rows<RfqLine>(supabase, "rfq_lines", { eq: { rfq_id: id }, order: [["line_no"]] }),
    rows<RfqInvitation>(supabase, "v_rfq_invitations", { eq: { rfq_id: id }, order: [["supplier_name"]] }),
    rows<RfqResponse>(supabase, "v_rfq_responses", { eq: { rfq_id: id }, order: [["total_value"]] }),
    getSpecs(supabase, rfq.job_id), rows<Eligible>(supabase, "v_eligible_suppliers", { order: [["name"]], limit: 5000 }),
    getLibrary(supabase, "bypass_reasons"), getEvents(supabase, { entity_id: id }), getPeople(supabase),
    getMyAccess(supabase, me.id, me.is_admin, me.srt_role), one<{ client_id: string }>(supabase, "jobs", rfq.job_id),
  ]);
  const client = job ? await one<SourcingClient>(supabase, "sourcing_clients", job.client_id) : null;
  const priceRows = (await Promise.all(responses.map((r) => rows<ResponsePrice>(supabase, "rfq_response_prices", { eq: { response_id: r.id } })))).flat();
  const specById = new Map(specs.map((s) => [s.id, s]));
  const priceOf = (resp: string, line: string, qty: number) => priceRows.find((p) => p.response_id === resp && p.line_id === line && Number(p.quantity) === Number(qty));
  const open = isBiddingOpen(rfq);
  const allResponded = invites.length > 0 && invites.every((i) => i.status === "quoted" || i.status === "declined");
  const sealed = rfq.status === "sent" && open && !allResponded;
  const valid = responses.filter((r) => r.status === "submitted" || r.status === "awarded");
  const tolerance = client?.quote_tolerance_percent ?? null;
  const invitedIds = new Set(invites.map((i) => i.supplier_id));
  const poolSorted = [...pool].sort((a, b) => Number(b.market === rfq.market) - Number(a.market === rfq.market) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHead crumbs={[{ label: "RFQ+", href: "/rfq" }, { label: rfq.rfq_number }]} title={rfq.title}
        sub={`${rfq.rfq_number} · job ${rfq.job_number} · ${rfq.client_name} · ${rfq.market} (${rfq.region})`}>
        <Pill tone={rfqStatus(rfq.status).tone}>{rfq.status === "sent" && !open ? "Closed, to evaluate" : rfqStatus(rfq.status).label}</Pill>
        {rfq.high_value_alert && <Pill tone="bad">High value</Pill>}
      </PageHead>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Controls" className="xl:col-span-2">
          <Facts items={[
            ["Job", <Link key="j" className="hover:underline" href={`/sourcing/jobs/${rfq.job_id}`}>{rfq.job_number}</Link>],
            ["Quotes due", fmtDateTime(rfq.due_at)], ["Estimated value", money(rfq.estimated_value, rfq.currency)],
            ["Control-matrix band", rfq.control_band ?? (rfq.status === "draft" ? "Set when sent" : "No band matched")],
            ["Minimum quotes", rfq.min_quotes_required ?? (rfq.status === "draft" ? "Set when sent" : "—")],
            ["Valid quotes", `${valid.length}${rfq.min_quotes_required ? ` of ${rfq.min_quotes_required} needed` : ""}`],
            ["High-value threshold", rfq.high_value_threshold ? `${money(rfq.high_value_threshold, rfq.currency)}${rfq.high_value_alert ? (rfq.high_value_approved_by ? " · approved" : " · needs approval") : ""}` : "None for this market"],
            ["Bidding", "Sealed: suppliers never see each other"], ["Client tolerance", tolerance != null ? `±${tolerance}%` : "None"],
          ]} />
          {rfq.min_quotes_basis && <p className="border-t border-line px-5 py-2 text-xs text-muted">{rfq.min_quotes_basis}</p>}
          {rfq.award_reason && <p className="border-t border-line px-5 py-2 text-sm">Awarded to <b>{rfq.awarded_supplier_name}</b>: {rfq.award_reason}{rfq.bypass_reason_code ? ` (bypass ${rfq.bypass_reason_code})` : ""}</p>}
          {rfq.cancelled_reason && <p className="border-t border-line px-5 py-2 text-sm text-bad">Cancelled: {rfq.cancelled_reason}</p>}
        </Panel>
        <Panel title="Next step">
          <div className="space-y-3 p-5 text-sm">
            {rfq.status === "draft" && (
              <>
                {rfq.high_value_alert && !rfq.high_value_approved_by && (
                  access.is_lead && rfq.created_by !== me.id ? (
                    <ActionForm action={approveHighValue} hidden={{ id }} submit="Approve high value" variant="secondary">
                      <Field label="Why this value is justified" htmlFor="note"><input id="note" name="note" required className="input" /></Field>
                    </ActionForm>
                  ) : <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">Over the {rfq.market} high-value threshold. A different sourcing lead must approve it before it can be sent.</p>
                )}
                <p>Choose eligible suppliers below, then send. When you send, the database works out the control-matrix band from the value and checks you have invited enough suppliers.</p>
                <ActionForm action={sendRfq} hidden={{ id }} submit="Send to suppliers" confirm="Send this RFQ? Lines and suppliers are locked once it goes out." />
              </>
            )}
            {rfq.status === "sent" && (open ? <p>Bidding is open until {fmtDateTime(rfq.due_at)}. {allResponded ? "Every supplier has responded, so you can evaluate now." : "Prices stay sealed until then."}</p>
              : <p>Bidding has closed. Get Finance approval on the quote you want, then award it.</p>)}
            {rfq.status === "awarded" && <p>Awarded. The estimate is in <Link className="font-semibold underline" href="/orders/estimates">Order Management+</Link>.</p>}
            {(rfq.status === "draft" || rfq.status === "sent") && (
              <details className="rounded-lg border border-line p-3">
                <summary className="cursor-pointer font-semibold">Cancel RFQ</summary>
                <div className="mt-3"><ActionForm action={cancelRfq} hidden={{ id }} submit="Cancel RFQ" variant="danger"><Field label="Reason" htmlFor="reason"><input id="reason" name="reason" required className="input" /></Field></ActionForm></div>
              </details>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Lines" sub="Quantity breaks and target prices">
        <table className="w-full text-sm">
          <thead><tr><Th>#</Th><Th>Spec</Th><Th>Quantity breaks</Th><Th>Target unit prices</Th><Th>Targets shown to suppliers</Th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <Td>{l.line_no}</Td>
              <Td><Link className="font-semibold hover:underline" href={`/sourcing/specs/${l.spec_id}`}>{specById.get(l.spec_id)?.title ?? "Spec"}</Link></Td>
              <Td className="tabular-nums">{l.quantity_breaks.map((q) => Number(q).toLocaleString("en-GB")).join(" · ")}</Td>
              <Td className="tabular-nums">{l.target_prices ? l.target_prices.map((t) => (t == null ? "—" : unitMoney(Number(t), rfq.currency))).join(" · ") : "—"}</Td>
              <Td>{l.show_targets ? "Yes" : "No"}</Td>
            </tr>))}</tbody>
        </table>
      </Panel>

      {rfq.status === "draft" ? (
        <Panel title="Choose suppliers" sub="Only suppliers that are active and not blocked for purchasing in Assure+ can be invited. Same-market suppliers are listed first.">
          <ActionForm action={setSuppliers} hidden={{ id }} submit="Save supplier selection" className="p-5">
            <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {poolSorted.map((s) => (
                <label key={s.id} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">
                  <input type="checkbox" name="supplier" value={s.id} defaultChecked={invitedIds.has(s.id)} className="mt-1" />
                  <span><span className="font-semibold">{s.name}</span><span className="block text-xs text-muted">{s.supplier_code} · {s.category ?? "—"} · {s.market ?? "—"}{s.market !== rfq.market ? " · cross-border" : " · in-country"}</span></span>
                </label>
              ))}
            </div>
            {pool.length === 0 && <p className="text-sm text-muted">No eligible suppliers in Assure+ right now.</p>}
          </ActionForm>
          {invites.length > 0 && <p className="border-t border-line px-5 py-2 text-sm">{invites.length} chosen: {invites.map((i) => i.supplier_name).join(", ")}</p>}
        </Panel>
      ) : (
        <Panel title="Invited suppliers">
          <table className="w-full text-sm">
            <thead><tr><Th>Supplier</Th><Th>Market</Th><Th>Response</Th><Th>Assure+ now</Th><Th>Note</Th></tr></thead>
            <tbody>{invites.map((i) => (
              <tr key={i.supplier_id}>
                <Td className="font-semibold">{i.supplier_name}</Td><Td>{i.supplier_market}{i.cross_border && <span className="text-xs text-muted"> · cross-border</span>}</Td>
                <Td><StatusPill meta={INVITE_STATUS} value={i.status} /></Td>
                <Td>{i.purchasing_blocked || !i.supplier_active ? <Pill tone="bad">Blocked</Pill> : <Pill tone="ok">Eligible</Pill>}</Td>
                <Td className="text-xs text-muted">{i.decline_reason ?? ""}</Td>
              </tr>))}</tbody>
          </table>
        </Panel>
      )}

      {rfq.status !== "draft" && (
        <Panel title="Quote comparison" sub={sealed ? "Sealed until the due date or until every invited supplier has responded." : "Benchmark = average of quotes, re-averaged within the client's tolerance. Outliers are flagged on the price curve."}>
          {sealed ? (
            <p className="px-5 py-6 text-sm text-muted">{valid.length} quote(s) received so far. Prices open on {fmtDateTime(rfq.due_at)}.</p>
          ) : responses.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No quotes.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Line / quantity</Th><Th>Target</Th>{responses.map((r) => <Th key={r.id}>{r.supplier_name}</Th>)}<Th>Benchmark</Th><Th>Spread</Th></tr></thead>
                <tbody>
                  {lines.flatMap((l) => l.quantity_breaks.map((q, bi) => {
                    const prices = valid.map((r) => priceOf(r.id, l.id, q)).filter(Boolean).map((p) => Number(p!.unit_price));
                    const bench = computeLineBenchmark(prices, tolerance);
                    const disp = priceDispersion(prices);
                    const target = l.target_prices?.[bi];
                    return (
                      <tr key={`${l.id}-${q}`}>
                        <Td><span className="font-semibold">{l.line_no}. {specById.get(l.spec_id)?.title}</span><div className="text-xs text-muted">{Number(q).toLocaleString("en-GB")} units{bi === 0 ? " · main break" : ""}</div></Td>
                        <Td className="tabular-nums">{target != null ? unitMoney(Number(target), rfq.currency) : "—"}</Td>
                        {responses.map((r) => {
                          const p = priceOf(r.id, l.id, q);
                          const c = p && bench ? curveScenario(Number(p.unit_price), bench, Math.max(15, tolerance ?? 0)) : null;
                          return <Td key={r.id} className="tabular-nums">{p ? <>{unitMoney(Number(p.unit_price), rfq.currency)}{c && c.scenario !== "in_range" && <div><Pill tone={c.tone}>{c.label}</Pill></div>}</> : "—"}</Td>;
                        })}
                        <Td className="tabular-nums font-semibold">{bench ? unitMoney(bench, rfq.currency) : "—"}</Td>
                        <Td className="tabular-nums">{disp != null ? `${disp.toFixed(0)}%` : "—"}</Td>
                      </tr>
                    );
                  }))}
                  <tr className="bg-surface-2/50">
                    <Td className="font-semibold">Total at main breaks</Td><Td />
                    {responses.map((r) => <Td key={r.id} className="tabular-nums font-semibold">{money(r.total_value, rfq.currency)}<div className="text-xs font-normal text-muted">{r.lead_time_days != null ? `${r.lead_time_days} days lead time` : ""}</div></Td>)}
                    <Td /><Td />
                  </tr>
                  <tr>
                    <Td className="font-semibold">Status</Td><Td />
                    {responses.map((r) => <Td key={r.id}><div className="flex flex-col items-start gap-1"><StatusPill meta={QUOTE_STATUS} value={r.status} /><StatusPill meta={FINANCE_STATUS} value={r.finance_status} />{r.source === "internal_entry" && <Pill>Logged by buyer</Pill>}{(r.purchasing_blocked || !r.supplier_active) && <Pill tone="bad">Blocked in Assure+</Pill>}</div></Td>)}
                    <Td /><Td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {rfq.status === "sent" && !sealed && valid.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Finance approval" sub="A quote must be approved by Finance before it can be awarded.">
            <div className="divide-y divide-line">
              {valid.filter((r) => r.status === "submitted").map((r) => (
                <div key={r.id} className="space-y-2 px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{r.supplier_name} · {money(r.total_value, rfq.currency)}</span><StatusPill meta={FINANCE_STATUS} value={r.finance_status} /></div>
                  {r.finance_notes && <p className="text-xs text-muted">{r.finance_notes}</p>}
                  {access.is_finance ? (
                    <ActionForm action={financeDecide} hidden={{ id, response_id: r.id }} submit="Record decision" variant="secondary" inline>
                      <select name="decision" className="input w-auto" aria-label="Decision"><option value="approve">Approve</option><option value="decline">Decline</option></select>
                      <input name="notes" placeholder="Notes (needed to decline)" className="input w-56" aria-label="Notes" />
                    </ActionForm>
                  ) : r.finance_status === "pending" && <p className="text-xs text-muted">Waiting for Finance.</p>}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Award" sub="Checked again in the database: bidding closed, Finance approved, supplier not blocked in Assure+, minimum valid quotes (or a governed bypass reason). Losing quotes are marked not awarded.">
            <div className="p-5">
              <ActionForm action={awardRfq} hidden={{ id }} submit="Award and draft the estimate" confirm="Award this RFQ? Every other quote is marked not awarded.">
                <Field label="Winning quote" htmlFor="response_id">
                  <select id="response_id" name="response_id" className="input">
                    {valid.filter((r) => r.status === "submitted").map((r) => <option key={r.id} value={r.id}>{r.supplier_name} · {money(r.total_value, rfq.currency)} · {FINANCE_STATUS[r.finance_status]?.label}</option>)}
                  </select>
                </Field>
                <Field label="Why this supplier" htmlFor="reason"><input id="reason" name="reason" required className="input" placeholder="e.g. Lowest price, good lead time" /></Field>
                {valid.filter((r) => r.status === "submitted").length < (rfq.min_quotes_required ?? 1) && (
                  <Field label="Bypass reason (fewer valid quotes than the minimum)" htmlFor="bypass_code">
                    <select id="bypass_code" name="bypass_code" className="input"><option value="">None</option>{bypass.map((b) => <option key={b.id} value={b.code ?? ""}>{b.name}</option>)}</select>
                  </Field>
                )}
              </ActionForm>
            </div>
          </Panel>
        </div>
      )}

      {rfq.status === "sent" && invites.some((i) => i.status !== "declined" && !responses.some((r) => r.supplier_id === i.supplier_id && r.status !== "draft")) && lines.length > 0 && (
        <Panel title="Log a quote received by email" sub="For an invited supplier who can't use the vendor portal. Marked as logged by a buyer in the audit trail.">
          <div className="p-5">
            <ActionForm action={logQuote} hidden={{ id }} submit="Log quote" variant="secondary">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Supplier" htmlFor="supplier_id">
                  <select id="supplier_id" name="supplier_id" className="input">
                    {invites.filter((i) => i.status !== "declined" && !responses.some((r) => r.supplier_id === i.supplier_id && r.status !== "draft")).map((i) => <option key={i.supplier_id} value={i.supplier_id}>{i.supplier_name}</option>)}
                  </select>
                </Field>
                <Field label="Lead time (days)" htmlFor="lead_time_days"><input id="lead_time_days" name="lead_time_days" inputMode="numeric" className="input" /></Field>
                <Field label="Notes" htmlFor="qnotes"><input id="qnotes" name="notes" className="input" /></Field>
                {lines.flatMap((l) => l.quantity_breaks.map((q) => (
                  <Field key={`${l.id}-${q}`} label={`${specById.get(l.spec_id)?.title ?? "Line " + l.line_no} @ ${Number(q).toLocaleString("en-GB")} (unit price)`} htmlFor={`price_${l.id}_${q}`}>
                    <input id={`price_${l.id}_${q}`} name={`price_${l.id}_${q}`} inputMode="decimal" className="input" />
                  </Field>
                )))}
              </div>
            </ActionForm>
          </div>
        </Panel>
      )}

      <Panel title="History"><ActivityList events={events} people={people} /></Panel>
      <Card className="px-5 py-3 text-xs text-muted">Vendors respond in the vendor portal through sealed functions (rfq_vendor_view, rfq_submit_quote, rfq_decline): they only ever see their own invitation and quote, never other suppliers or internal notes.</Card>
    </>
  );
}
