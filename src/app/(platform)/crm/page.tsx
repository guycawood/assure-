import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getContracts, getHealth, getOpportunities } from "@/lib/crm-data";
import { OPEN_STAGES, STAGE, ago, money, moneyByCurrency } from "@/lib/crm";
import { ButtonLink, Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Td, Th, fmtDate } from "@/components/sourcing/bits";
import { Bars, ClientLink, RagPill } from "@/components/crm/bits";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmDashboard() {
  const me = await requireInternal();
  const supabase = await createClient();
  const [opps, contracts, health, accounts] = await Promise.all([getOpportunities(supabase), getContracts(supabase), getHealth(supabase), getAccounts(supabase)]);

  const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));
  const weighted = moneyByCurrency(open.map((o) => ({ value: o.weighted_value, currency: o.currency })));
  const total = moneyByCurrency(open.map((o) => ({ value: o.value, currency: o.currency })));
  const renewals = contracts.filter((k) => k.status === "signed" && k.days_to_renewal != null && k.days_to_renewal <= 90).sort((a, b) => (a.days_to_renewal ?? 0) - (b.days_to_renewal ?? 0));
  const activeHealth = health.filter((h) => h.active);
  const red = activeHealth.filter((h) => h.rag === "red");
  const mine = accounts.filter((a) => a.account_lead === me.id);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const wonYtd = opps.filter((o) => o.stage === "won" && o.won_at && new Date(o.won_at).getTime() >= yearStart);

  // Pipeline by stage in the most-used currency (no FX conversion yet).
  const cur = [...open.reduce((m, o) => m.set(o.currency, (m.get(o.currency) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
  const byStage = OPEN_STAGES.map((s) => {
    const rows = open.filter((o) => o.stage === s && o.currency === cur);
    const v = rows.reduce((n, o) => n + Number(o.value), 0);
    return { label: STAGE[s].label, value: v, text: `${money(v, cur)} · ${rows.length}` };
  });

  return (
    <>
      <PageHead title="CRM" sub="Client relationships: accounts by market, contacts, activity, pipeline, contracts and client health. Commercial terms changes go through approval and feed Sourcing, Order Management and Finance+.">
        <ButtonLink href="/crm/clients">Clients</ButtonLink>
        <ButtonLink href="/crm/pipeline" variant="primary">Pipeline</ButtonLink>
      </PageHead>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Weighted pipeline" value={weighted} hint={`${open.length} open opportunities · ${total} unweighted`} icon={<MSymbol name="filter_alt" />} />
        <Stat label="Won this year" value={moneyByCurrency(wonYtd.map((o) => ({ value: o.value, currency: o.currency })))} hint={`${wonYtd.length} opportunities`} tone="ok" icon={<MSymbol name="emoji_events" />} />
        <Stat label="Renewals in 90 days" value={renewals.length} tone={renewals.length ? "warn" : "ok"} hint={<Link className="underline" href="/crm/contracts">Contracts &amp; renewals</Link>} icon={<MSymbol name="event_repeat" />} />
        <Stat label="Clients at red" value={red.length} tone={red.length ? "bad" : "ok"} hint={`${activeHealth.filter((h) => h.rag === "amber").length} at amber`} icon={<MSymbol name="monitor_heart" />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Pipeline by stage" sub={`Open opportunities in ${cur}; value and count`} actions={<ButtonLink href="/crm/pipeline">Open pipeline</ButtonLink>}>
          {open.length === 0 ? <Empty title="No open opportunities" /> : <Bars rows={byStage} />}
        </Panel>
        <Panel title="Client health" sub="Worst first. Spend, bills, feedback, renewals and activity" actions={<ButtonLink href="/crm/health">All</ButtonLink>}>
          {activeHealth.length === 0 ? <Empty title="No clients yet" /> : (
            <ul className="divide-y divide-line">
              {activeHealth.slice(0, 6).map((h) => (
                <li key={h.client_id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                  <RagPill rag={h.rag} />
                  <span className="min-w-0 flex-1"><ClientLink id={h.client_id} name={h.name} /><span className="block truncate text-xs text-muted">{h.reasons.join(" · ") || "Nothing to flag"}</span></span>
                  <span className="text-xs text-muted">{h.satisfaction != null ? `${h.satisfaction}/10` : "No score"}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Renewals due" sub="Signed contracts renewing in the next 90 days">
          {renewals.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing due in the next 90 days.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr><Th>Contract</Th><Th>Client</Th><Th>Renews</Th><Th className="text-right">Value</Th></tr></thead>
                <tbody>{renewals.map((k) => (
                  <tr key={k.id}>
                    <Td><Link className="font-semibold hover:underline" href={`/crm/contracts?contract=${k.id}`}>{k.title}</Link><div className="text-xs text-muted">{k.contract_code}</div></Td>
                    <Td><ClientLink id={k.client_id} name={k.client_name} /></Td>
                    <Td className={(k.days_to_renewal ?? 99) <= 30 ? "text-bad" : ""}>{fmtDate(k.next_renewal)}<div className="text-xs text-muted">in {k.days_to_renewal} days</div></Td>
                    <Td className="text-right tabular-nums">{money(k.value, k.currency)}</Td>
                  </tr>))}</tbody></table>
            </div>
          )}
        </Panel>
        <Panel title="My accounts" sub="Accounts where you are the account lead">
          {mine.length === 0 ? <p className="px-5 py-4 text-sm text-muted">You don&apos;t lead any accounts yet.</p> : (
            <ul className="divide-y divide-line">
              {mine.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1"><ClientLink id={a.client_id} name={a.client_name} /> <span className="text-muted">· {a.market_name ?? a.market}</span>
                    <span className="block text-xs text-muted">Last activity: {ago(a.last_activity_at)} · {a.open_opportunities} open opportunities</span></span>
                  {a.tier_name && <Pill tone="accent">{a.tier_name}</Pill>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Card className="px-5 py-4 text-sm text-muted">
        Approvals for CRM (new client set-up, commercial terms, high-value contracts and wins) arrive in <Link href="/watchtower/approvals" className="font-semibold text-accent underline">My approvals</Link>.
        Libraries (tiers, stages, lost reasons, interaction types) live in the <Link href="/crm/watchtower" className="font-semibold text-accent underline">CRM Watchtower</Link>.
      </Card>
    </>
  );
}
