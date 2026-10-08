import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getAllGates, getGateDefs, getInternalPeople, getSuppliers, getTickets } from "@/lib/data";
import { CLIENTS, effectiveGateState, formatEur, personName, REGIONS, type SupplierGate } from "@/lib/srt";
import { ButtonLink, Card, Empty, GateLegend, GateStrip, PageHead, Pill, RagDot, TierPill } from "@/components/ui";

export const metadata: Metadata = { title: "Gate register" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [suppliers, gates, defs, tickets, people] = await Promise.all([
    getSuppliers(supabase), getAllGates(supabase), getGateDefs(supabase), getTickets(supabase), getInternalPeople(supabase),
  ]);
  const pMap = byId(people);
  const gatesBy = new Map<string, SupplierGate[]>();
  for (const g of gates) gatesBy.set(g.supplier_id, [...(gatesBy.get(g.supplier_id) ?? []), g]);
  const openBy = new Map<string, number>();
  for (const t of tickets) if (t.status !== "resolved" && t.supplier_id) openBy.set(t.supplier_id, (openBy.get(t.supplier_id) ?? 0) + 1);

  const q = (sp.q ?? "").trim().toLowerCase();
  let rows = suppliers;
  if (sp.rag) rows = rows.filter((s) => s.rag === sp.rag);
  if (sp.tier) rows = rows.filter((s) => String(s.priority_tier) === sp.tier);
  if (sp.client) rows = rows.filter((s) => s.client === sp.client);
  if (sp.region) rows = rows.filter((s) => s.region === sp.region);
  if (sp.route) rows = rows.filter((s) => s.onboarding_route === sp.route);
  if (sp.blocked === "1") rows = rows.filter((s) => s.purchasing_blocked);
  if (sp.gate)
    rows = rows.filter((s) => {
      const g = gatesBy.get(s.id)?.find((x) => x.gate_key === sp.gate);
      return !g || !["verified", "not_required"].includes(effectiveGateState(g));
    });
  if (q) rows = rows.filter((s) => [s.name, s.supplier_code, s.market, s.category].join(" ").toLowerCase().includes(q));
  rows = [...rows].sort((a, b) => (a.priority_tier ?? 9) - (b.priority_tier ?? 9) || Number(b.ytd_spend) - Number(a.ytd_spend) || a.name.localeCompare(b.name));
  const gateFilter = defs.find((d) => d.key === sp.gate);

  return (
    <>
      <PageHead title="Gate register" sub="Every supplier's status at each onboarding gate, sorted by priority tier and spend.">
        <ButtonLink href="/assure/suppliers/new" variant="primary">Add supplier</ButtonLink>
      </PageHead>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, ID or market" className="input w-56" aria-label="Search suppliers" />
        <select name="rag" defaultValue={sp.rag ?? ""} className="input w-auto" aria-label="RAG">
          <option value="">All RAG</option><option value="red">Red</option><option value="amber">Amber</option><option value="green">Green</option>
        </select>
        <select name="tier" defaultValue={sp.tier ?? ""} className="input w-auto" aria-label="Tier">
          <option value="">All tiers</option>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}
        </select>
        <select name="client" defaultValue={sp.client ?? ""} className="input w-auto" aria-label="Client">
          <option value="">All clients</option>{CLIENTS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select name="region" defaultValue={sp.region ?? ""} className="input w-auto" aria-label="Region">
          <option value="">All regions</option>{REGIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select name="route" defaultValue={sp.route ?? ""} className="input w-auto" aria-label="Route">
          <option value="">Any route</option><option value="fast_track">Fast-track</option><option value="standard">Standard</option>
        </select>
        <select name="gate" defaultValue={sp.gate ?? ""} className="input w-auto" aria-label="Open gate">
          <option value="">Any gate</option>{defs.map((d) => <option key={d.key} value={d.key}>Open: {d.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="blocked" value="1" defaultChecked={sp.blocked === "1"} /> Blocked only</label>
        <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted">Apply</button>
        {Object.values(sp).some(Boolean) && <Link href="/assure/srt/register" className="text-sm font-semibold text-accent underline">Clear</Link>}
      </form>
      <GateLegend />

      <Card className="min-w-0">
        {suppliers.length === 0 ? (
          <Empty title="No suppliers yet"><p>Add suppliers to start tracking their onboarding gates.</p></Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>{["", "Supplier", "Client", "Market", "Route", "YTD spend", "Gates", "Open gaps", "Tier", "Tickets", "SRT owner"].map((h) => <th key={h} className="th">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const open = defs.length - s.gates_clear;
                  return (
                    <tr key={s.id} className="hover:bg-surface-2">
                      <td className="td"><RagDot rag={s.rag} /></td>
                      <td className="td min-w-[200px]">
                        <Link href={`/assure/suppliers/${s.id}`} className="font-semibold hover:underline">{s.name}</Link>
                        <div className="text-xs text-muted">{[s.supplier_code, s.category, s.active ? null : "Inactive"].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="td">{s.client ?? "—"}</td>
                      <td className="td">{[s.market, s.region].filter(Boolean).join(", ") || "—"}</td>
                      <td className="td">{s.onboarding_route === "fast_track" ? <Pill tone="warn">Fast-track</Pill> : <Pill>Standard</Pill>}</td>
                      <td className="td whitespace-nowrap font-mono text-xs tabular-nums">{formatEur(Number(s.ytd_spend))}</td>
                      <td className="td"><GateStrip defs={defs} gates={gatesBy.get(s.id) ?? []} /><div className="font-mono text-xs text-muted">{s.gates_clear}/{defs.length}</div></td>
                      <td className="td">
                        {open ? <Pill tone={s.critical_open ? "bad" : "warn"}>{open}{s.critical_open ? ` · ${s.critical_open} critical` : ""}</Pill> : <Pill tone="ok">None</Pill>}
                        {s.purchasing_blocked && <div className="mt-1 text-xs font-semibold text-bad">Purchasing blocked</div>}
                      </td>
                      <td className="td"><TierPill tier={s.priority_tier} /></td>
                      <td className="td font-mono text-xs">{openBy.get(s.id) ?? ""}</td>
                      <td className="td whitespace-nowrap">{s.srt_owner ? personName(pMap.get(s.srt_owner)) : <span className="text-muted">Unassigned</span>}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={11} className="td text-muted">No suppliers match these filters{gateFilter ? ` (open: ${gateFilter.label})` : ""}.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">{rows.length} of {suppliers.length} suppliers</p>
    </>
  );
}
