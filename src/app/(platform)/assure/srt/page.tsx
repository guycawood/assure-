import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getAllGates, getGateDefs, getInternalPeople, getSuppliers, getTickets } from "@/lib/data";
import { effectiveGateState, formatEur, TIER_LABEL } from "@/lib/srt";
import { ButtonLink, Card, Empty, PageHead, TierPill } from "@/components/ui";
import { TicketTable } from "./ticket-table";

export const metadata: Metadata = { title: "SRT dashboard" };

export default async function SrtDashboard() {
  const me = await requireInternal();
  const supabase = await createClient();
  const [suppliers, gates, defs, tickets, people] = await Promise.all([
    getSuppliers(supabase), getAllGates(supabase), getGateDefs(supabase), getTickets(supabase), getInternalPeople(supabase),
  ]);

  const active = suppliers.filter((s) => s.active);
  const compliant = suppliers.filter((s) => s.rag === "green").length;
  const pct = suppliers.length ? Math.round((compliant / suppliers.length) * 100) : 0;
  const spendGap = active.filter((s) => s.rag !== "green").reduce((a, s) => a + Number(s.ytd_spend), 0);
  const tier1 = suppliers.filter((s) => s.priority_tier === 1).length;
  const blocked = suppliers.filter((s) => s.purchasing_blocked && s.active).length;
  const open = tickets.filter((t) => t.status !== "resolved");
  const today = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((t) => t.due_date && t.due_date < today);

  const assessed = suppliers.filter((s) => s.gates_clear > 0 || s.rag !== "red").length;
  const withGaps = suppliers.filter((s) => s.rag !== "green").length;
  const inRemediation = new Set(open.filter((t) => t.supplier_id).map((t) => t.supplier_id)).size;
  const funnel: [string, number][] = [
    ["Suppliers tracked", suppliers.length],
    ["Assessed", assessed],
    ["With gaps", withGaps],
    ["In remediation", inRemediation],
    ["Compliant", compliant],
  ];
  const fmax = Math.max(1, suppliers.length);

  const activeIds = new Set(active.map((s) => s.id));
  const gapCounts = defs
    .map((d) => ({
      d,
      n: gates.filter((g) => g.gate_key === d.key && activeIds.has(g.supplier_id) && !["verified", "not_required"].includes(effectiveGateState(g))).length,
    }))
    .sort((a, b) => b.n - a.n);
  const gmax = Math.max(1, ...gapCounts.map((g) => g.n));

  const mine = open.filter((t) => t.assignee === me.id);
  const queue = (mine.length ? mine : open).slice(0, 8);

  const stat = (label: string, value: string | number, sub: string, bad = false) => (
    <Card className="px-4 py-3">
      <p className="eyebrow">{label}</p>
      <p className={`font-display text-[1.8rem] font-bold leading-tight tabular-nums ${bad ? "text-bad" : ""}`}>{value}</p>
      <p className="text-xs text-muted">{sub}</p>
    </Card>
  );

  if (!suppliers.length && !tickets.length) {
    return (
      <>
        <PageHead title="Onboarding compliance" sub="Where every supplier stands against the onboarding gates, and what the SRT queue is working on." />
        <Card>
          <Empty title="No suppliers yet">
            <p>Add the first supplier, or raise a ticket for a new onboarding request. Every new supplier starts with all 14 gates missing and purchasing blocked until the critical gates are verified.</p>
            <div className="flex gap-2">
              <ButtonLink href="/assure/suppliers/new" variant="primary">Add supplier</ButtonLink>
              <ButtonLink href="/assure/srt/tickets/new">Raise ticket</ButtonLink>
            </div>
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead title="Onboarding compliance" sub="Where every supplier stands against the onboarding gates, and what the SRT queue is working on.">
        <ButtonLink href="/assure/suppliers/new">Add supplier</ButtonLink>
        <ButtonLink href="/assure/srt/tickets/new" variant="primary">Raise ticket</ButtonLink>
      </PageHead>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        {stat("Fully compliant", `${pct}%`, `${compliant} of ${suppliers.length} suppliers`)}
        {stat("Spend with open gaps", formatEur(spendGap), "YTD, active suppliers", spendGap > 0)}
        {stat("Tier 1 outstanding", tier1, "Critical gap + high spend", tier1 > 0)}
        {stat("Purchasing blocked", blocked, "Active suppliers", blocked > 0)}
        {stat("Open tickets", open.length, `${open.filter((t) => t.status === "new").length} not triaged`)}
        {stat("Overdue tickets", overdue.length, "Past SLA due date", overdue.length > 0)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card className="space-y-3 p-4">
          <h2 className="font-display text-lg font-semibold">Remediation funnel</h2>
          <div className="space-y-1.5">
            {funnel.map(([l, n], i) => (
              <div key={l} className="grid grid-cols-[120px_1fr_48px] items-center gap-2.5 text-sm">
                <span>{l}</span>
                <div className="h-5 overflow-hidden rounded-sm bg-surface-2">
                  <span className={`block h-full ${i === funnel.length - 1 ? "bg-ok" : "bg-accent"}`} style={{ width: `${(n / fmax) * 100}%` }} />
                </div>
                <span className="text-right font-mono text-sm tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="font-display text-lg font-semibold">Priority tiers</h2>
          <table className="w-full text-sm">
            <tbody>
              {[1, 2, 3, 4].map((t) => {
                const list = suppliers.filter((s) => s.priority_tier === t);
                return (
                  <tr key={t}>
                    <td className="td"><Link href={`/assure/srt/register?tier=${t}`} className="inline-flex items-center gap-2 hover:underline"><TierPill tier={t} /> {TIER_LABEL[t].split(" · ")[1]}</Link></td>
                    <td className="td text-right font-mono tabular-nums">{list.length}</td>
                    <td className="td text-right font-mono tabular-nums">{formatEur(list.reduce((a, s) => a + Number(s.ytd_spend), 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-2 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold">Open gaps by gate</h2>
            <span className="text-xs text-muted">Active suppliers · <span className="font-bold text-bad">!</span> critical</span>
          </div>
          <div className="space-y-1">
            {gapCounts.map(({ d, n }) => (
              <Link key={d.key} href={`/assure/srt/register?gate=${d.key}`} className="grid grid-cols-[minmax(0,1fr)_110px_32px] items-center gap-2.5 py-0.5 text-sm hover:underline">
                <span className="truncate">{d.label}{d.critical && <b className="ml-1 text-bad">!</b>}</span>
                <span className="h-2.5 overflow-hidden rounded-sm bg-surface-2"><span className="block h-full bg-bad/80" style={{ width: `${(n / gmax) * 100}%` }} /></span>
                <span className="text-right font-mono tabular-nums">{n}</span>
              </Link>
            ))}
          </div>
        </Card>
        <Card className="min-w-0">
          <div className="flex items-baseline justify-between p-4 pb-2">
            <h2 className="font-display text-lg font-semibold">{mine.length ? "Your queue" : "Next up in the queue"}</h2>
            <Link href="/assure/srt/tickets" className="text-sm font-semibold text-accent underline underline-offset-2">All tickets</Link>
          </div>
          {queue.length ? (
            <TicketTable tickets={queue} suppliers={byId(suppliers)} people={byId(people)} compact />
          ) : (
            <p className="px-4 pb-6 text-sm text-muted">No open tickets.</p>
          )}
        </Card>
      </div>
    </>
  );
}
