import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getAccounts, getClient, getClientLinks, getContacts, getContracts, getEvents, getFeedback, getHealth, getInteractions, getLibrary, getMarkets,
  getOpportunities, getPeople, getPlans,
} from "@/lib/crm-data";
import {
  ACCOUNT_STATUS, CONTRACT_STATUS, CONTRACT_TYPE, DECISION_ROLES, OPEN_STAGES, PLAN_STATUS, SETUP_STATUS, ago, decisionRole, money, moneyByCurrency,
} from "@/lib/crm";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { Facts, StatusPill, Tabs, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { ApprovalRequests } from "@/components/approvals/requests";
import { Disclosure, Input, RagPill, ScorePill, Select, StagePill, TextArea, libOptions, marketOptions, peopleOptions } from "@/components/crm/bits";
import {
  captureFeedback, createOpportunity, followUpFeedback, logInteraction, requestTermsChange, resubmitSetup, saveAccount, saveContact, saveContract,
} from "../../actions";

export const metadata: Metadata = { title: "Client · CRM" };

const TABS = [
  { key: "accounts", label: "Accounts", icon: "public" },
  { key: "contacts", label: "Contacts", icon: "contacts" },
  { key: "activity", label: "Activity", icon: "forum" },
  { key: "opportunities", label: "Opportunities", icon: "filter_alt" },
  { key: "contract", label: "Contract & terms", icon: "contract" },
  { key: "health", label: "Health", icon: "monitor_heart" },
  { key: "feedback", label: "Feedback", icon: "reviews" },
  { key: "work", label: "Campaigns, jobs & bills", icon: "work" },
];

export default async function CrmClient({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const wanted = (await searchParams).tab;
  const tab = wanted && TABS.some((t) => t.key === wanted) ? wanted : "accounts";
  const supabase = await createClient();
  const client = await getClient(supabase, id);
  if (!client) notFound();
  const f = { client_id: id };
  const [accounts, contacts, interactions, opps, contracts, feedback, healthRows, plans, people, markets, tiers, types] = await Promise.all([
    getAccounts(supabase, f), getContacts(supabase, f), getInteractions(supabase, f, 100), getOpportunities(supabase, f), getContracts(supabase, f),
    getFeedback(supabase, f), getHealth(supabase, f), getPlans(supabase, f), getPeople(supabase), getMarkets(supabase),
    getLibrary(supabase, "crm_account_tiers"), getLibrary(supabase, "crm_interaction_types"),
  ]);
  const health = healthRows[0];
  const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));
  const accountOpts = accounts.map((a) => ({ value: a.id, label: `${a.market_name ?? a.market}` }));
  const contactOpts = contacts.map((c) => ({ value: c.id, label: c.full_name }));
  const hq = markets.find((m) => m.code === client.hq_market);

  return (
    <>
      <PageHead title={client.name} sub={`${client.code}${client.sector ? ` · ${client.sector}` : ""}${hq ? ` · head office ${hq.name}` : ""} · ${client.default_currency}`}
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Clients", href: "/crm/clients" }, { label: client.name }]}>
        <StatusPill meta={SETUP_STATUS} value={client.crm_setup_status} />
        {health && <RagPill rag={health.rag} title={health.reasons.join(" · ")} />}
      </PageHead>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Spend this year" value={health ? money(health.spend_ytd, health.currency) : "—"} hint={health ? `Billed ${money(health.billed_ytd, health.currency)}` : undefined} icon={<MSymbol name="savings" />} />
        <Stat label="Open pipeline (weighted)" value={moneyByCurrency(open.map((o) => ({ value: o.weighted_value, currency: o.currency })))} hint={`${open.length} open`} icon={<MSymbol name="filter_alt" />} />
        <Stat label="Satisfaction" value={health?.satisfaction != null ? `${health.satisfaction}/10` : "—"} hint={health?.nps != null ? `NPS ${health.nps} · ${health.feedback_count} scores` : "No scores yet"} icon={<MSymbol name="reviews" />} />
        <Stat label="Last activity" value={ago(health?.last_activity_at)} tone={health && (health.days_since_activity == null || health.days_since_activity > 60) ? "bad" : undefined} icon={<MSymbol name="forum" />} />
      </div>

      {client.crm_setup_status !== "approved" && (
        <Card className="border-warn/50 px-5 py-4 text-sm">
          <p className="font-semibold">This client can&apos;t be used on jobs yet.</p>
          <p className="text-muted">Finance checks credit and KYC first. {client.crm_setup_note && <>Notes: {client.crm_setup_note}</>}</p>
          <ActionForm action={resubmitSetup} hidden={{ id }} submit="Ask Finance again" variant="secondary" inline className="mt-2">
            <input name="note" className="input w-80" placeholder="What changed since the last check" aria-label="Note for Finance" />
          </ActionForm>
        </Card>
      )}

      <ApprovalRequests entityIds={id} types={["CRM_TERMS", "CRM_CLIENT_SETUP"]} meId={me.id} title="Waiting for approval" />

      <Tabs base={`/crm/clients/${id}`} current={tab} tabs={TABS.map((t) => ({
        ...t, count: t.key === "accounts" ? accounts.length : t.key === "contacts" ? contacts.length : t.key === "opportunities" ? open.length : t.key === "feedback" ? feedback.length : undefined,
      }))} />

      {tab === "accounts" && (
        <>
          <Card className="overflow-x-auto">
            {accounts.length === 0 ? <Empty title="No accounts yet">Add the markets this client buys in.</Empty> : (
              <table className="w-full text-sm">
                <thead><tr><Th>Market</Th><Th>Account lead</Th><Th>Tier</Th><Th>Status</Th><Th>Last activity</Th><Th>Change</Th></tr></thead>
                <tbody>{accounts.map((a) => (
                  <tr key={a.id} className="align-top">
                    <Td className="font-semibold">{a.market_name ?? a.market}<div className="text-xs font-normal text-muted">{a.region} · {a.open_opportunities} open opportunities</div></Td>
                    <Td>{a.account_lead_name ?? <span className="text-muted">Not set</span>}{a.account_lead_email && <div className="text-xs text-muted">{a.account_lead_email}</div>}</Td>
                    <Td>{a.tier_name ? <Pill tone="accent">{a.tier_name}</Pill> : "—"}</Td>
                    <Td><StatusPill meta={ACCOUNT_STATUS} value={a.status} />{a.notes && <div className="mt-1 text-xs text-muted">{a.notes}</div>}</Td>
                    <Td>{ago(a.last_activity_at)}</Td>
                    <Td>
                      <details><summary className="cursor-pointer text-xs font-semibold text-accent">Edit</summary>
                        <ActionForm action={saveAccount} hidden={{ id: a.id, client_id: id, market: a.market }} submit="Save" className="mt-2 w-64">
                          <Select name="account_lead" label="Account lead" options={peopleOptions(people)} value={a.account_lead} empty="Not set" />
                          <Select name="tier_id" label="Tier" options={libOptions(tiers)} value={a.tier_id} empty="Not set" />
                          <Select name="status" label="Status" options={Object.entries(ACCOUNT_STATUS).map(([v, s]) => ({ value: v, label: s.label }))} value={a.status} />
                          <Input name="notes" label="Notes" value={a.notes} />
                        </ActionForm>
                      </details>
                    </Td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
          <Disclosure summary="Add an account (market)">
            <ActionForm action={saveAccount} hidden={{ client_id: id }} submit="Add account" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select name="market" label="Market" options={marketOptions(markets)} empty="Choose…" required />
              <Select name="account_lead" label="Account lead" options={peopleOptions(people)} empty="Not set" />
              <Select name="tier_id" label="Tier" options={libOptions(tiers)} empty="Not set" />
              <Select name="status" label="Status" options={Object.entries(ACCOUNT_STATUS).map(([v, s]) => ({ value: v, label: s.label }))} value="active" />
            </ActionForm>
          </Disclosure>
          {plans.length > 0 && (
            <Panel title="Account plans" actions={<Link href="/crm/plans" className="text-xs font-semibold text-accent hover:underline">All plans</Link>}>
              <ul className="divide-y divide-line">{plans.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 font-semibold">{p.title}<span className="block text-xs font-normal text-muted">{fmtDate(p.period_start)} to {fmtDate(p.period_end)} · {p.actions_done}/{p.actions_total} actions done</span></span>
                  <span className="tabular-nums">{money(p.growth_target, p.currency)}</span>
                  <StatusPill meta={PLAN_STATUS} value={p.status} />
                </li>))}</ul>
            </Panel>
          )}
        </>
      )}

      {tab === "contacts" && (
        <>
          <Card className="overflow-x-auto">
            {contacts.length === 0 ? <Empty title="No contacts yet" /> : (
              <table className="w-full text-sm">
                <thead><tr><Th>Name</Th><Th>Role</Th><Th>Contact</Th><Th>Market</Th><Th>Decision role</Th><Th>Consent</Th></tr></thead>
                <tbody>{contacts.map((c) => (
                  <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                    <Td className="font-semibold">{c.full_name}{!c.active && <div className="text-xs font-normal text-muted">No longer active</div>}</Td>
                    <Td>{c.job_title ?? "—"}</Td>
                    <Td>{c.email ? <a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"}<div className="text-xs text-muted">{c.phone}</div></Td>
                    <Td>{c.market_name ?? "—"}</Td>
                    <Td><Pill tone={c.decision_role === "sponsor" ? "accent" : c.decision_role === "approver" ? "info" : "neutral"}>{decisionRole(c.decision_role)}</Pill></Td>
                    <Td>{c.consent ? <Pill tone="ok">Yes</Pill> : <Pill tone="warn">No</Pill>}</Td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
          <Disclosure summary="Add a contact">
            <ActionForm action={saveContact} hidden={{ client_id: id }} submit="Add contact" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input name="full_name" label="Name" required />
              <Input name="job_title" label="Job title" />
              <Input name="email" label="Email" type="email" />
              <Input name="phone" label="Phone" />
              <Select name="account_id" label="Account" options={accountOpts} empty="Whole client" />
              <Select name="market" label="Market" options={marketOptions(markets)} empty="—" />
              <Select name="decision_role" label="Decision role" options={DECISION_ROLES.map((d) => ({ value: d.value, label: d.label }))} value="user" />
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="consent" /> Agreed to be contacted (consent)</label>
            </ActionForm>
          </Disclosure>
        </>
      )}

      {tab === "activity" && (
        <>
          <Disclosure summary="Log an interaction" open={interactions.length === 0}>
            <ActionForm action={logInteraction} hidden={{ client_id: id }} submit="Log it" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Select name="type_id" label="Type" options={libOptions(types)} required empty="Choose…" />
              <Input name="subject" label="Subject" required />
              <Input name="occurred_at" label="When" type="datetime-local" />
              <Select name="account_id" label="Account" options={accountOpts} empty="Whole client" />
              <Select name="contact_id" label="With" options={contactOpts} empty="—" />
              <Select name="opportunity_id" label="Opportunity" options={opps.map((o) => ({ value: o.id, label: o.title }))} empty="—" />
              <TextArea name="summary" label="What happened" className="sm:col-span-2 lg:col-span-3" />
            </ActionForm>
          </Disclosure>
          <Panel title="Activity" sub="Meetings, calls, emails, QBRs and notes">
            {interactions.length === 0 ? <Empty title="Nothing logged yet" /> : (
              <ol className="divide-y divide-line">{interactions.map((i) => (
                <li key={i.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <span className="text-xs text-muted">{fmtDateTime(i.occurred_at)}<br />{i.owner_name}</span>
                  <span><Pill>{i.type_name}</Pill> <span className="font-semibold">{i.subject}</span>
                    {i.summary && <span className="block text-muted">{i.summary}</span>}
                    <span className="block text-xs text-muted">{[i.contact_name && `with ${i.contact_name}`, i.market, i.opportunity_title && `re ${i.opportunity_title}`].filter(Boolean).join(" · ")}</span></span>
                </li>))}</ol>
            )}
          </Panel>
        </>
      )}

      {tab === "opportunities" && (
        <>
          <Card className="overflow-x-auto">
            {opps.length === 0 ? <Empty title="No opportunities yet" /> : (
              <table className="w-full text-sm">
                <thead><tr><Th>Opportunity</Th><Th>Stage</Th><Th className="text-right">Value</Th><Th className="text-right">Weighted</Th><Th>Expected close</Th><Th>Campaign</Th></tr></thead>
                <tbody>{opps.map((o) => (
                  <tr key={o.id}>
                    <Td><Link className="font-semibold hover:underline" href={`/crm/pipeline?opp=${o.id}`}>{o.title}</Link><div className="text-xs text-muted">{o.opp_code} · {o.market_name ?? "All markets"} · {o.owner_name}</div></Td>
                    <Td><StagePill stage={o.stage} />{o.win_pending && <div className="mt-1"><Pill tone="warn">Win to confirm</Pill></div>}{o.lost_reason_name && <div className="text-xs text-muted">{o.lost_reason_name}</div>}</Td>
                    <Td className="text-right tabular-nums">{money(o.value, o.currency)}</Td>
                    <Td className="text-right tabular-nums">{money(o.weighted_value, o.currency)}<div className="text-xs text-muted">{o.probability}%</div></Td>
                    <Td>{fmtDate(o.expected_close)}</Td>
                    <Td>{o.campaign_id ? <Link className="hover:underline" href="/briefing">{o.campaign_code}</Link> : "—"}</Td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
          <Disclosure summary="Add an opportunity">
            <ActionForm action={createOpportunity} hidden={{ client_id: id }} submit="Add opportunity" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input name="title" label="Title" required />
              <Select name="account_id" label="Account" options={accountOpts} empty="Whole client" />
              <Select name="stage" label="Stage" options={OPEN_STAGES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} value="lead" />
              <Input name="value" label="Value" type="number" step="100" required />
              <Input name="currency" label="Currency" value={client.default_currency} />
              <Input name="expected_close" label="Expected close" type="date" />
              <TextArea name="description" label="Description" className="sm:col-span-2 lg:col-span-3" />
            </ActionForm>
          </Disclosure>
        </>
      )}

      {tab === "contract" && (
        <>
          <Panel title="Commercial terms in force" sub="Sourcing, Order Management and Finance+ use these. A change is requested here and applied when a second person approves it.">
            <Facts items={[
              ["Markup", `${client.default_markup_percent}%`], ["GSC commission", `${client.gsc_commission_percent}%`], ["Year-end rebate", `${client.year_end_rebate_percent}%`],
              ["Payment terms", client.payment_terms_days != null ? `${client.payment_terms_days} days` : "Finance default"],
              ["Credit limit", client.credit_limit != null ? money(client.credit_limit, client.default_currency) : "—"],
              ["Savings target / min quotes", `${client.savings_target_percent}% · ${client.min_quotes_required} quotes (set in Sourcing)`],
            ]} />
            <div className="border-t border-line px-5 py-4">
              <details><summary className="cursor-pointer text-sm font-semibold text-accent">Request change</summary>
                <ActionForm action={requestTermsChange} hidden={{ id }} submit="Request change" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Input name="markup" label="Markup %" type="number" step="0.1" value={client.default_markup_percent} required />
                  <Input name="commission" label="GSC commission %" type="number" step="0.1" value={client.gsc_commission_percent} required />
                  <Input name="rebate" label="Year-end rebate %" type="number" step="0.1" value={client.year_end_rebate_percent} required />
                  <Input name="payment_terms_days" label="Payment terms (days)" type="number" value={client.payment_terms_days} placeholder="Finance default" />
                  <Select name="contract_id" label="Also update contract" options={contracts.filter((k) => k.status !== "ended").map((k) => ({ value: k.id, label: `${k.contract_code} · ${k.title}` }))} empty="No contract" className="sm:col-span-2" />
                  <Input name="reason" label="Why" required className="sm:col-span-2" />
                </ActionForm>
              </details>
            </div>
          </Panel>
          <Card className="overflow-x-auto">
            {contracts.length === 0 ? <Empty title="No contracts yet" /> : (
              <table className="w-full text-sm">
                <thead><tr><Th>Contract</Th><Th>Type</Th><Th>Term</Th><Th>Renews</Th><Th className="text-right">Value</Th><Th>Terms</Th><Th>Status</Th></tr></thead>
                <tbody>{contracts.map((k) => (
                  <tr key={k.id} className="align-top">
                    <Td><Link className="font-semibold hover:underline" href={`/crm/contracts?contract=${k.id}`}>{k.title}</Link><div className="text-xs text-muted">{k.contract_code}{k.parent_code ? ` · under ${k.parent_code}` : ""}</div></Td>
                    <Td>{CONTRACT_TYPE[k.contract_type]}</Td>
                    <Td>{fmtDate(k.start_date)} to {fmtDate(k.end_date)}</Td>
                    <Td className={k.days_to_renewal != null && k.days_to_renewal <= 90 ? "text-warn" : ""}>{fmtDate(k.next_renewal)}</Td>
                    <Td className="text-right tabular-nums">{money(k.value, k.currency)}</Td>
                    <Td className="text-xs">{[k.markup_percent != null && `markup ${k.markup_percent}%`, k.min_margin_percent != null && `margin ≥ ${k.min_margin_percent}%`, k.gsc_commission_percent != null && `GSC ${k.gsc_commission_percent}%`, k.rebate_percent != null && `rebate ${k.rebate_percent}%`, k.payment_terms_days != null && `${k.payment_terms_days} days`].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td><StatusPill meta={CONTRACT_STATUS} value={k.status} />{k.approval_pending && <div className="mt-1"><Pill tone="warn">Approval pending</Pill></div>}</Td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
          <Disclosure summary="Add a contract (draft)">
            <ContractForm clientId={id} currency={client.default_currency} msas={contracts.filter((k) => k.contract_type === "msa").map((k) => ({ value: k.id, label: `${k.contract_code} · ${k.title}` }))} />
          </Disclosure>
        </>
      )}

      {tab === "health" && health && (
        <Panel title="How the health score is worked out" sub="Red flags count 2, amber flags 1. Four or more points is red, two or three amber.">
          <Facts items={[
            ["Health", <RagPill key="r" rag={health.rag} />], ["Points", String(health.points)],
            ["Why", health.reasons.join(" · ") || "Nothing to flag"],
            ["Spend this year", money(health.spend_ytd, health.currency)], ["Billed this year", money(health.billed_ytd, health.currency)],
            ["Overdue bills", String(health.overdue_bills)], ["Open detractor comments", String(health.open_issues)],
            ["Satisfaction (12 months)", health.satisfaction != null ? `${health.satisfaction}/10 from ${health.feedback_count}` : "No scores"],
            ["NPS", health.nps != null ? String(health.nps) : "—"], ["Next renewal", health.next_renewal ? `${fmtDate(health.next_renewal)} (${health.days_to_renewal} days)` : "—"],
            ["Last activity", ago(health.last_activity_at)],
          ]} />
        </Panel>
      )}

      {tab === "feedback" && (
        <>
          <Panel title="Feedback" sub="Scores from 0 to 10, captured by the team or given by the client in the Client Portal">
            {feedback.length === 0 ? <Empty title="No feedback yet" /> : (
              <ul className="divide-y divide-line">{feedback.map((fb) => (
                <li key={fb.id} className="space-y-1 px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><ScorePill score={fb.score} /><Pill>{fb.source === "client_portal" ? "Client Portal" : "Captured by the team"}</Pill>
                    <span className="text-xs text-muted">{fmtDate(fb.created_at)} · {fb.contact_name ?? fb.submitted_by_name}{fb.market ? ` · ${fb.market}` : ""}</span></div>
                  {fb.comment && <p>{fb.comment}</p>}
                  {fb.followed_up_at ? <p className="text-xs text-ok">Followed up {fmtDate(fb.followed_up_at)}: {fb.follow_up_note}</p> : fb.score <= 6 && (
                    <ActionForm action={followUpFeedback} hidden={{ id: fb.id }} submit="Record follow-up" variant="secondary" inline>
                      <input name="note" className="input w-80" placeholder="What was done about it" aria-label="Follow-up note" />
                    </ActionForm>
                  )}
                </li>))}</ul>
            )}
          </Panel>
          <Disclosure summary="Capture feedback from the client">
            <ActionForm action={captureFeedback} hidden={{ client_id: id }} submit="Record" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input name="score" label="Score (0-10)" type="number" required />
              <Select name="account_id" label="Account" options={accountOpts} empty="Whole client" />
              <Select name="contact_id" label="From" options={contactOpts} empty="—" />
              <TextArea name="comment" label="Comment" className="sm:col-span-2 lg:col-span-4" />
            </ActionForm>
          </Disclosure>
        </>
      )}

      {tab === "work" && <LinkedWork clientId={id} />}

      <RecentChanges clientId={id} />
    </>
  );
}

function ContractForm({ clientId, currency, msas }: { clientId: string; currency: string; msas: { value: string; label: string }[] }) {
  return (
    <ActionForm action={saveContract} hidden={{ client_id: clientId }} submit="Save draft" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Input name="title" label="Title" required className="sm:col-span-2" />
      <Select name="contract_type" label="Type" options={[{ value: "msa", label: "MSA" }, { value: "sow", label: "SOW" }, { value: "other", label: "Other" }]} value="msa" />
      <Select name="parent_id" label="Under MSA (for a SOW)" options={msas} empty="—" />
      <Input name="start_date" label="Start" type="date" />
      <Input name="end_date" label="End" type="date" />
      <Input name="renewal_date" label="Renewal date" type="date" />
      <Input name="notice_days" label="Notice (days)" type="number" />
      <Input name="value" label="Value" type="number" step="1000" />
      <Input name="currency" label="Currency" value={currency} />
      <Input name="payment_terms_days" label="Payment terms (days)" type="number" />
      <Input name="markup" label="Markup %" type="number" step="0.1" />
      <Input name="min_margin" label="Minimum margin %" type="number" step="0.1" />
      <Input name="commission" label="GSC commission %" type="number" step="0.1" />
      <Input name="rebate" label="Rebate %" type="number" step="0.1" />
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="auto_renew" /> Renews automatically</label>
      <TextArea name="sustainability" label="Sustainability commitments" className="sm:col-span-2" />
      <TextArea name="notes" label="Notes" className="sm:col-span-2" />
    </ActionForm>
  );
}

async function LinkedWork({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const { campaigns, jobs, estimates, bills } = await getClientLinks(supabase, clientId);
  const jobNo = new Map(jobs.map((j) => [j.id, j.job_number]));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Campaigns (Briefing+)">
        {campaigns.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None.</p> : (
          <ul className="divide-y divide-line">{campaigns.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-2 text-sm"><span className="min-w-0 flex-1"><Link className="font-semibold hover:underline" href="/briefing">{c.name}</Link>
              <span className="block text-xs text-muted">{c.campaign_code} · {fmtDate(c.start_date)}{c.crm_opportunity_id ? " · from a CRM opportunity" : ""}</span></span><Pill>{c.status}</Pill></li>))}</ul>
        )}
      </Panel>
      <Panel title="Jobs (Sourcing)">
        {jobs.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None.</p> : (
          <ul className="divide-y divide-line">{jobs.slice(0, 12).map((j) => (
            <li key={j.id} className="flex items-center gap-3 px-5 py-2 text-sm"><span className="min-w-0 flex-1"><Link className="font-semibold hover:underline" href={`/sourcing/jobs/${j.id}`}>{j.title}</Link>
              <span className="block text-xs text-muted">{j.job_number} · {j.market}</span></span><Pill>{j.status.replace(/_/g, " ")}</Pill></li>))}</ul>
        )}
      </Panel>
      <Panel title="Estimates (Order Management)">
        {estimates.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><Th>Estimate</Th><Th>Job</Th><Th className="text-right">Sell price</Th><Th>Status</Th></tr></thead>
            <tbody>{estimates.slice(0, 12).map((e) => (
              <tr key={e.id}><Td><Link className="hover:underline" href={`/orders/estimates/${e.id}`}>{e.estimate_number}</Link></Td><Td>{jobNo.get(e.job_id)}</Td>
                <Td className="text-right tabular-nums">{money(e.sell_price, e.currency, 2)}</Td><Td><Pill>{e.status}</Pill></Td></tr>))}</tbody></table></div>
        )}
      </Panel>
      <Panel title="Client bills (Finance+)">
        {bills.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><Th>Bill</Th><Th className="text-right">Total</Th><Th>Due</Th><Th>Status</Th></tr></thead>
            <tbody>{bills.map((b) => {
              const overdue = b.status === "sent" && b.due_date && b.due_date < new Date().toISOString().slice(0, 10);
              return (
                <tr key={b.id}><Td><Link className="hover:underline" href={`/finance/billing/${b.id}`}>{b.bill_number}</Link></Td>
                  <Td className="text-right tabular-nums">{money(b.gross_amount, b.currency, 2)}</Td><Td className={overdue ? "text-bad" : ""}>{fmtDate(b.due_date)}</Td>
                  <Td><Pill tone={overdue ? "bad" : b.status === "paid" ? "ok" : "neutral"}>{overdue ? "overdue" : b.status}</Pill></Td></tr>
              );
            })}</tbody></table></div>
        )}
      </Panel>
    </div>
  );
}

async function RecentChanges({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const events = await getEvents(supabase, clientId);
  if (events.length === 0) return null;
  return (
    <details className="rounded-xl border border-line bg-surface shadow-card">
      <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold">Audit trail ({events.length})</summary>
      <ol className="divide-y divide-line border-t border-line">{events.map((e) => (
        <li key={e.id} className="flex flex-wrap gap-x-3 px-5 py-2 text-xs">
          <span className="w-36 text-muted">{fmtDateTime(e.at)}</span><span className="font-semibold capitalize">{e.entity_type}</span>
          <span>{e.action.replace(/_/g, " ")}</span><span className="text-muted">{e.actor_name ?? "System"}</span>
        </li>))}</ol>
    </details>
  );
}
