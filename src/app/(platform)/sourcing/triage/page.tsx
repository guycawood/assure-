import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSpecs, rows } from "@/lib/sourcing-data";
import { money, ROUTES, type Spec } from "@/lib/sourcing";
import { ButtonLink, Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { RoutePill, Td, Th } from "@/components/sourcing/bits";
import { estimateFromTriage, runTriage } from "../actions";

export const metadata: Metadata = { title: "Triage basket" };

export default async function TriagePage() {
  await requireInternal();
  const supabase = await createClient();
  const [specs, estLines, settings] = await Promise.all([
    getSpecs(supabase),
    rows<{ spec_id: string; estimate_id: string }>(supabase, "estimate_lines", { limit: 10000 }),
    rows<{ triage_tolerance_percent: number; push_confidence_threshold: number; instant_price_limit: number }>(supabase, "sourcing_settings"),
  ]);
  const onEstimate = new Set(estLines.map((l) => l.spec_id));
  const live = specs.filter((s) => !s.is_draft);
  const untriaged = live.filter((s) => !s.route);
  const ready = live.filter((s) => (s.route === "adopt" || s.route === "adapt" || (s.route === "push" && s.push_status === "accepted")) && !onEstimate.has(s.id));
  const waitingPush = live.filter((s) => s.route === "push" && s.push_status === "pending");
  const createLines = live.filter((s) => s.route === "create");
  const byJob = groupBy(ready, (s) => s.job_id);
  const cfg = settings[0];

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing+", href: "/sourcing" }, { label: "Triage basket" }]} title="Triage basket"
        sub="Every spec line is routed before supplier selection: Adopt and Adapt are priced from rate cards, Push asks the supplier to confirm our price, Create goes to RFQ+." />

      <div className="grid gap-3 md:grid-cols-4">
        {ROUTES.map((r) => (
          <Card key={r.value} className="px-4 py-3">
            <div className="flex items-center justify-between"><RoutePill route={r.value} /><span className="font-display text-xl font-bold tabular-nums">{live.filter((s) => s.route === r.value).length}</span></div>
            <p className="mt-1 text-xs text-muted">{r.description}</p>
          </Card>
        ))}
      </div>
      {cfg && (
        <p className="text-xs text-muted">Rules v1: tolerance band ±{Number(cfg.triage_tolerance_percent)}% on size; Push needs {Math.round(Number(cfg.push_confidence_threshold) * 100)}% confidence and an eligible rate-card supplier; anything over {money(cfg.instant_price_limit)} goes to RFQ. Change these in <Link className="underline" href="/sourcing/admin">Sourcing+ settings</Link>.</p>
      )}

      <Panel title="Waiting for triage" sub={`${untriaged.length} line(s)`}>
        {untriaged.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Every finished spec has a route.</p> : (
          <SpecTable specs={untriaged} action={(s) => <ActionForm action={runTriage} hidden={{ id: s.id }} submit="Run triage" variant="secondary" inline />} />
        )}
      </Panel>

      <Panel title="Ready for an estimate" sub="Priced at triage. One estimate is drafted per supplier.">
        {ready.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing waiting.</p> : (
          <div className="divide-y divide-line">
            {[...byJob.entries()].map(([jobId, list]) => (
              <div key={jobId}>
                <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2/60 px-5 py-2 text-sm">
                  <Link className="font-semibold hover:underline" href={`/sourcing/jobs/${jobId}`}>{list[0].job_number} · {list[0].job_title}</Link>
                  <ActionForm action={estimateFromTriage} hidden={{ job_id: jobId }} submit="Draft estimate" inline />
                </div>
                <SpecTable specs={list} />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Pushed prices waiting for the supplier" sub="The supplier accepts or declines in the vendor portal by the respond-by date. A decline sends the line to Create.">
        {waitingPush.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No pushed prices are waiting.</p> : <SpecTable specs={waitingPush} />}
      </Panel>

      <Panel title="Routed to RFQ (Create)" actions={<ButtonLink href="/rfq/new">New RFQ in RFQ+</ButtonLink>}>
        {createLines.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No Create lines.</p> : <SpecTable specs={createLines} action={(s) => <ButtonLink href={`/rfq/new?job=${s.job_id}`}>RFQ</ButtonLink>} />}
      </Panel>
    </>
  );
}

function SpecTable({ specs, action }: { specs: Spec[]; action?: (s: Spec) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><Th>Spec</Th><Th>Job</Th><Th>Quantity</Th><Th>Route</Th><Th>Why</Th><Th>Price</Th><Th>Supplier</Th>{action && <Th />}</tr></thead>
        <tbody>
          {specs.map((s) => (
            <tr key={s.id}>
              <Td><Link className="font-semibold hover:underline" href={`/sourcing/specs/${s.id}`}>{s.title}</Link></Td>
              <Td><Link className="hover:underline" href={`/sourcing/jobs/${s.job_id}`}>{s.job_number}</Link><div className="text-xs text-muted">{s.client_name} · {s.market}</div></Td>
              <Td className="tabular-nums">{s.total_quantity.toLocaleString("en-GB")}</Td>
              <Td><RoutePill route={s.route} confidence={s.confidence} />{s.triage_source === "override" && <Pill>Override</Pill>}</Td>
              <Td className="max-w-md text-xs text-muted">{s.triage_reason ?? "—"}</Td>
              <Td className="tabular-nums">{s.route && s.route !== "create" ? money(s.triage_unit_price, "EUR", 2) : "—"}</Td>
              <Td>{s.triage_supplier_name ?? "—"}</Td>
              {action && <Td className="text-right">{action(s)}</Td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function groupBy<T>(list: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}
