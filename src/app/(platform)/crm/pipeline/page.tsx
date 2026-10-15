import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getInteractions, getLibrary, getOpportunities } from "@/lib/crm-data";
import { OPEN_STAGES, STAGE, STAGES, money, moneyByCurrency, type OpportunityRow } from "@/lib/crm";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Facts, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { ApprovalRequests } from "@/components/approvals/requests";
import { ClientLink, Disclosure, Input, Select, StagePill, TextArea, clientOptions } from "@/components/crm/bits";
import { createOpportunity, moveOpportunity, opportunityToCampaign, updateOpportunity } from "../actions";

export const metadata: Metadata = { title: "Pipeline · CRM" };

export default async function CrmPipeline({ searchParams }: { searchParams: Promise<{ opp?: string; closed?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [opps, clients, lostReasons] = await Promise.all([getOpportunities(supabase), getClients(supabase), getLibrary(supabase, "crm_lost_reasons")]);
  const showClosed = sp.closed === "1";
  const columns = showClosed ? STAGES : OPEN_STAGES;
  const sel = opps.find((o) => o.id === sp.opp) ?? null;
  const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));

  return (
    <>
      <PageHead title="Pipeline" sub="Opportunities from lead to won or lost. Weighted value uses each stage's probability (Watchtower library). A won opportunity can become a campaign in Briefing+."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Pipeline" }]}>
        <Link href={showClosed ? "/crm/pipeline" : "/crm/pipeline?closed=1"} className="text-sm font-semibold text-accent underline">{showClosed ? "Hide won and lost" : "Show won and lost"}</Link>
      </PageHead>

      <p className="text-sm text-muted">Open: {open.length} · {moneyByCurrency(open.map((o) => ({ value: o.value, currency: o.currency })))} · weighted {moneyByCurrency(open.map((o) => ({ value: o.weighted_value, currency: o.currency })))}</p>

      {sel && <Selected o={sel} lostReasons={lostReasons.map((l) => ({ value: l.id, label: l.name }))} meId={me.id} />}

      <div className={clsx("grid gap-3", showClosed ? "lg:grid-cols-3 2xl:grid-cols-6" : "lg:grid-cols-2 2xl:grid-cols-4")}>
        {columns.map((s) => {
          const rows = opps.filter((o) => o.stage === s);
          return (
            <Card key={s} className="min-w-0">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="font-display text-sm font-bold">{STAGE[s].label} <span className="text-muted">({rows.length})</span></span>
                <span className="text-xs text-muted">{moneyByCurrency(rows.map((o) => ({ value: o.value, currency: o.currency })))}</span>
              </div>
              <ul className="space-y-2 p-2">
                {rows.length === 0 && <li className="px-2 py-3 text-xs text-muted">Nothing here.</li>}
                {rows.map((o) => (
                  <li key={o.id}>
                    <Link href={`/crm/pipeline?opp=${o.id}${showClosed ? "&closed=1" : ""}`}
                      className={clsx("block rounded-lg border px-3 py-2 text-sm hover:border-accent/50", o.id === sel?.id ? "border-accent bg-accent-soft" : "border-line")}>
                      <span className="block font-semibold">{o.title}</span>
                      <span className="block text-xs text-muted">{o.client_name}{o.market ? ` · ${o.market}` : ""}</span>
                      <span className="mt-1 flex items-center justify-between text-xs"><span className="tabular-nums">{money(o.value, o.currency)} · {o.probability}%</span>
                        {o.win_pending ? <Pill tone="warn">Win to confirm</Pill> : <span className="text-muted">{fmtDate(o.expected_close)}</span>}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      <Disclosure summary="Add an opportunity">
        <ActionForm action={createOpportunity} submit="Add opportunity" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select name="client_id" label="Client" options={clientOptions(clients.filter((c) => c.active))} empty="Choose…" required />
          <Input name="title" label="Title" required />
          <Select name="stage" label="Stage" options={OPEN_STAGES.map((s) => ({ value: s, label: STAGE[s].label }))} value="lead" />
          <Input name="value" label="Value" type="number" step="100" required />
          <Input name="currency" label="Currency" placeholder="Client default" />
          <Input name="expected_close" label="Expected close" type="date" />
          <TextArea name="description" label="Description" className="sm:col-span-2 lg:col-span-3" />
        </ActionForm>
        <p className="mt-2 text-xs text-muted">Pick the market account from the client&apos;s page if the opportunity is for one market.</p>
      </Disclosure>
    </>
  );
}

async function Selected({ o, lostReasons, meId }: { o: OpportunityRow; lostReasons: { value: string; label: string }[]; meId: string }) {
  const supabase = await createClient();
  const activity = await getInteractions(supabase, { opportunity_id: o.id }, 10);
  const isOpen = OPEN_STAGES.includes(o.stage);
  return (
    <>
      <ApprovalRequests entityIds={o.id} types={["CRM_OPP_WON"]} meId={meId} title="Win waiting for confirmation" />
      <Panel title={o.title} sub={`${o.opp_code} · owner ${o.owner_name ?? "not set"}`} actions={<><StagePill stage={o.stage} /><Link href="/crm/pipeline" className="text-xs text-muted underline">Close</Link></>}>
        <Facts items={[
          ["Client", <ClientLink key="c" id={o.client_id} name={o.client_name} />], ["Market", o.market_name ?? "All markets"],
          ["Value", money(o.value, o.currency)], ["Probability", `${o.probability}% · weighted ${money(o.weighted_value, o.currency)}`],
          ["Expected close", fmtDate(o.expected_close)], ["Description", o.description ?? "—"],
          ...(o.stage === "lost" ? [["Lost because", `${o.lost_reason_name ?? "—"}${o.lost_note ? `: ${o.lost_note}` : ""}`] as [string, string]] : []),
          ...(o.stage === "won" ? [["Won", fmtDate(o.won_at)] as [string, string], ["Campaign", o.campaign_id ? `${o.campaign_code} · ${o.campaign_name}` : "Not created yet"] as [string, string]] : []),
        ]} />
        <div className="grid gap-4 border-t border-line px-5 py-4 lg:grid-cols-2">
          {isOpen && !o.win_pending && (
            <>
              <div className="space-y-3">
                <p className="eyebrow">Move</p>
                <ActionForm action={moveOpportunity} hidden={{ id: o.id }} submit="Move" inline>
                  <select name="stage" className="input w-44" aria-label="New stage" defaultValue="">
                    <option value="" disabled>Choose a stage</option>
                    {OPEN_STAGES.filter((s) => s !== o.stage).map((s) => <option key={s} value={s}>{STAGE[s].label}</option>)}
                  </select>
                </ActionForm>
                <ActionForm action={moveOpportunity} hidden={{ id: o.id, stage: "won" }} submit="Mark won" inline>
                  <input name="note" className="input w-64" placeholder="Note (optional)" aria-label="Win note" />
                </ActionForm>
                <ActionForm action={moveOpportunity} hidden={{ id: o.id, stage: "lost" }} submit="Mark lost" variant="danger" inline>
                  <select name="lost_reason_id" className="input w-44" aria-label="Lost reason" defaultValue="" required>
                    <option value="" disabled>Why it was lost</option>
                    {lostReasons.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                  <input name="note" className="input w-56" placeholder="Detail (optional)" aria-label="Lost note" />
                </ActionForm>
              </div>
              <div>
                <p className="eyebrow mb-2">Edit</p>
                <ActionForm action={updateOpportunity} hidden={{ id: o.id }} submit="Save" className="grid gap-2 sm:grid-cols-2">
                  <Input name="title" label="Title" value={o.title} required className="sm:col-span-2" />
                  <Input name="value" label="Value" type="number" step="100" value={o.value} required />
                  <Input name="currency" label="Currency" value={o.currency} />
                  <Input name="probability" label="Probability %" type="number" value={o.probability} />
                  <Input name="expected_close" label="Expected close" type="date" value={o.expected_close} />
                  <TextArea name="description" label="Description" value={o.description} rows={2} className="sm:col-span-2" />
                </ActionForm>
              </div>
            </>
          )}
          {o.stage === "won" && !o.campaign_id && (
            <ActionForm action={opportunityToCampaign} hidden={{ id: o.id }} submit="Create campaign in Briefing+" inline>
              <input name="name" className="input w-72" defaultValue={o.title} aria-label="Campaign name" />
            </ActionForm>
          )}
          {o.stage === "won" && o.campaign_id && <p className="text-sm">Campaign <Link className="font-semibold text-accent underline" href="/briefing">{o.campaign_code}</Link> is in Briefing+.</p>}
        </div>
        {activity.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">{activity.map((i) => (
            <li key={i.id} className="px-5 py-2 text-sm"><span className="text-xs text-muted">{fmtDateTime(i.occurred_at)} · {i.type_name}</span> {i.subject}</li>))}</ul>
        )}
      </Panel>
    </>
  );
}
