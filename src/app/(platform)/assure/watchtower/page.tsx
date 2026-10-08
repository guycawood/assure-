import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople, getSuppliers, getTickets } from "@/lib/data";
import { getInputsBySupplier, getMethodology } from "@/lib/scorecard-data";
import { scoreSupplier } from "@/lib/scorecard";
import { personName, timeAgo } from "@/lib/srt";
import { btn, Card, PageHead, Pill } from "@/components/ui";
import { MethodologyView } from "./methodology-view";
import { createDraft } from "./actions";

export const metadata: Metadata = { title: "Assure+ Watchtower" };

type Audit = { id: number; methodology_id: string; action: string; detail: Record<string, unknown>; actor: string | null; at: string };

const ACTION_LABEL: Record<string, string> = {
  activated: "Activated",
  draft_created: "Draft started",
  draft_edited: "Draft edited",
  draft_discarded: "Draft discarded",
};

export default async function AssureWatchtower() {
  const me = await requireInternal();
  const supabase = await createClient();
  const [active, draft, suppliers, tickets, inputs, people, { data: versions }, { data: audit }] = await Promise.all([
    getMethodology(supabase, { status: "active" }),
    getMethodology(supabase, { status: "draft" }),
    getSuppliers(supabase),
    getTickets(supabase),
    getInputsBySupplier(supabase),
    getInternalPeople(supabase),
    supabase.from("scorecard_methodologies").select("id, version, status").order("version", { ascending: false }),
    supabase.from("scorecard_audit").select("*").order("at", { ascending: false }).limit(25),
  ]);
  const pMap = byId(people);
  const vMap = new Map(((versions ?? []) as { id: string; version: number }[]).map((v) => [v.id, v.version]));

  // Health: standard rows (metric, value, target, status), the same shape every module Watchtower exposes.
  const today = new Date().toISOString().slice(0, 10);
  const compliant = suppliers.filter((s) => s.rag === "green").length;
  const pct = suppliers.length ? Math.round((compliant / suppliers.length) * 100) : 0;
  const overdue = tickets.filter((t) => t.status !== "resolved" && t.due_date && t.due_date < today).length;
  const blocked = suppliers.filter((s) => s.active && s.purchasing_blocked).length;
  const scores = active ? suppliers.map((s) => scoreSupplier(active, inputs.get(s.id) ?? [], s.active)) : [];
  const psl = scores.filter((r) => r.preferred).length;
  const completeness = scores.length ? Math.round((scores.reduce((a, r) => a + r.completeness, 0) / scores.length) * 100) : 0;
  const health: { label: string; value: string; target: string; status: "ok" | "warn" | "bad" }[] = [
    { label: "Suppliers fully compliant", value: `${pct}%`, target: "90%", status: pct >= 90 ? "ok" : pct >= 60 ? "warn" : "bad" },
    { label: "Overdue SRT tickets", value: String(overdue), target: "0", status: overdue === 0 ? "ok" : overdue <= 3 ? "warn" : "bad" },
    { label: "Active suppliers blocked for purchasing", value: String(blocked), target: "0", status: blocked === 0 ? "ok" : "warn" },
    { label: "Preferred suppliers (PSL)", value: `${psl} of ${suppliers.length}`, target: "—", status: "ok" },
    { label: "Scorecard data completeness", value: `${completeness}%`, target: "95%", status: completeness >= 95 ? "ok" : completeness >= 75 ? "warn" : "bad" },
  ];

  return (
    <>
      <PageHead title="Assure+ Watchtower" sub="The rules Assure+ runs on, how they are applied, and how the module is doing. Rolls up into the master Watchtower." />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {health.map((h) => (
          <Card key={h.label} className="px-4 py-3">
            <p className="eyebrow">{h.label}</p>
            <p className="font-display text-[1.6rem] font-bold leading-tight tabular-nums">{h.value}</p>
            <p className="text-xs text-muted">Target {h.target} · <span className={h.status === "ok" ? "text-ok" : h.status === "warn" ? "text-warn" : "text-bad"}>{h.status === "ok" ? "on track" : h.status === "warn" ? "watch" : "action needed"}</span></p>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">Supplier scoring methodology</h2>
            {active && (
              <p className="text-sm text-muted">
                Version {active.version}, live {active.activated_at ? timeAgo(active.activated_at) : ""}. {active.notes}
              </p>
            )}
          </div>
          {me.is_admin ? (
            draft ? (
              <Link href="/assure/watchtower/methodology" className={btn.primary}>Continue draft v{draft.version}</Link>
            ) : (
              <form action={createDraft}><button className={btn.primary}>Change the methodology</button></form>
            )
          ) : (
            <p className="text-xs text-muted">Only admins can change the methodology.</p>
          )}
        </div>
        {draft && <p className="rounded border border-line bg-info-soft px-3 py-2 text-sm">Draft v{draft.version} is being prepared. It has no effect on scores until an admin activates it.</p>}
        {active ? <MethodologyView m={active} /> : <Card className="p-4">No active methodology.</Card>}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-4">
          <h2 className="mb-3 font-display text-lg font-semibold">Change log</h2>
          <ol className="space-y-3 text-sm">
            {((audit ?? []) as Audit[]).map((a) => {
              const changes = (a.detail?.changes ?? []) as { field: string; before: unknown; after: unknown }[];
              return (
                <li key={a.id}>
                  <p className="text-xs text-muted">
                    <span className="font-semibold text-fg">{a.actor ? personName(pMap.get(a.actor)) : "System"}</span> · v{vMap.get(a.methodology_id)} · {timeAgo(a.at)}
                  </p>
                  <p>
                    {ACTION_LABEL[a.action] ?? a.action}
                    {typeof a.detail?.note === "string" ? `: ${a.detail.note}` : ""}
                  </p>
                  {changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted">
                      {changes.map((c, i) => (
                        <li key={i}>{c.field.replace(/^(pillar|criterion):/, "").replace(":", " ")}: {typeof c.before === "object" ? "bands changed" : `${String(c.before)} → ${String(c.after)}`}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
        <Card className="p-4 text-sm">
          <h2 className="mb-3 font-display text-lg font-semibold">Versions</h2>
          <ul className="space-y-1.5">
            {((versions ?? []) as { id: string; version: number; status: string }[]).map((v) => (
              <li key={v.id} className="flex items-center justify-between">
                <span>Version {v.version}</span>
                <Pill tone={v.status === "active" ? "ok" : v.status === "draft" ? "info" : "neutral"}>{v.status}</Pill>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">Coming to this Watchtower: onboarding gate definitions, SLA and expiry settings, and change requests, using the same versioned pattern.</p>
        </Card>
      </section>
    </>
  );
}
