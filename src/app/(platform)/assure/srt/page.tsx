import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { daysLabel, TAXONOMY, type Dashboard, type Taxonomy } from "@/lib/onboarding";
import { ButtonLink, Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/assure/action-form";
import { closeReviewTask } from "@/app/(platform)/assure/onboarding-actions";
import { RunCadenceButton } from "./run-cadence";

export const metadata: Metadata = { title: "Onboarding control" };

const ORDER: Taxonomy[] = ["submitted", "in_review", "exception", "approved", "declined", "on_hold"];

// The onboarding control dashboard: one tracker over the nine-stage standard (pipeline, gate ageing, missing evidence,
// documented gaps, fast-track remediation, certificate expiry, inactive and duplicate flags, segregation exceptions).
export default async function OnboardingControl({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("srm_onboarding_dashboard", {
    p_region: sp.region || null, p_market: sp.market || null, p_client: sp.client || null, p_category: sp.category || null,
  });
  const d = data as Dashboard | null;
  if (error || !d) {
    return (
      <>
        <PageHead title="Onboarding control" />
        <Card><Empty title="The onboarding dashboard could not load">{error?.message}</Empty></Card>
      </>
    );
  }
  const pmax = Math.max(1, ...d.pipeline.map((p) => p.count));
  const emax = Math.max(1, ...d.missing_evidence.map((m) => m.count));
  const sel = (name: string, label: string, options: string[]) => (
    <label className="text-xs font-semibold text-muted">
      {label}
      <select name={name} defaultValue={sp[name] ?? ""} className="input mt-0.5 py-1">
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <PageHead title="Onboarding control" sub="Every supplier against the nine-stage onboarding standard: where it is, who owns the next step, what evidence is missing and which exceptions need closing.">
        <ButtonLink href="/assure/srt/requests">Onboarding requests</ButtonLink>
        <ButtonLink href="/assure/srt/register">Gate register</ButtonLink>
        <ButtonLink href="/assure/srt/requests/new" variant="primary">New onboarding request</ButtonLink>
      </PageHead>

      <form className="flex flex-wrap items-end gap-3" method="get">
        {sel("region", "Region", d.filters.regions)}
        {sel("market", "Market", d.filters.markets)}
        {sel("client", "Client", d.filters.clients)}
        {sel("category", "Category", d.filters.categories)}
        <button className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold">Filter</button>
        {(sp.region || sp.market || sp.client || sp.category) && <Link href="/assure/srt" className="text-sm text-accent underline">Clear</Link>}
      </form>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-7">
        {ORDER.map((k) => (
          <Card key={k} className="px-4 py-3">
            <p className="eyebrow">{TAXONOMY[k].label}</p>
            <p className="font-display text-[1.8rem] font-bold leading-tight tabular-nums">{d.totals[k]}</p>
            <p className="text-xs text-muted">{k === "submitted" ? "Requests waiting for triage" : k === "declined" ? "Requests declined or duplicates" : k === "approved" ? "Released for use" : k === "exception" ? "Fast-track, restricted scope" : k === "in_review" ? "In the nine stages" : "Suspended or paused"}</p>
          </Card>
        ))}
        <Card className="px-4 py-3">
          <p className="eyebrow">Purchasing blocked</p>
          <p className={`font-display text-[1.8rem] font-bold leading-tight tabular-nums ${d.totals.blocked ? "text-bad" : ""}`}>{d.totals.blocked}</p>
          <p className="text-xs text-muted">of {d.totals.suppliers} suppliers</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Pipeline by stage" sub={`Suppliers in onboarding, by the stage they are in. Escalation after ${d.escalation_days} days in a stage.`}>
          <div className="space-y-1.5 p-4">
            {d.pipeline.map((p) => (
              <div key={p.stage_no} className="grid grid-cols-[minmax(0,190px)_1fr_40px_110px] items-center gap-2.5 text-sm">
                <span className="truncate"><b className="font-mono text-xs text-muted">{p.stage_no}</b> {p.label} <span className="text-xs text-muted">· {p.owner}</span></span>
                <span className="h-4 overflow-hidden rounded-sm bg-surface-2"><span className="block h-full bg-accent" style={{ width: `${(p.count / pmax) * 100}%` }} /></span>
                <span className="text-right font-mono tabular-nums">{p.count}</span>
                <span className="text-right text-xs text-muted">{p.count ? `avg ${daysLabel(p.avg_days)}` : ""}{p.over ? <b className="ml-1 text-bad">{p.over} late</b> : null}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Bottlenecks by owner" sub="Who holds the next step, and how long it has waited.">
          {d.by_owner.length === 0 ? <p className="p-4 text-sm text-muted">Nothing in onboarding.</p> : (
            <table className="w-full text-sm">
              <thead><tr>{["Owner", "Suppliers", "Average wait", "Over escalation"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{d.by_owner.map((o) => (
                <tr key={o.owner}><td className="td">{o.owner}</td><td className="td font-mono">{o.count}</td><td className="td">{daysLabel(o.avg_days)}</td>
                  <td className="td">{o.over ? <Pill tone="bad">{o.over}</Pill> : <Pill tone="ok">0</Pill>}</td></tr>
              ))}</tbody>
            </table>
          )}
          {d.stuck.length > 0 && (
            <div className="border-t border-line p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Longest waiting</p>
              <ul className="space-y-1 text-sm">{d.stuck.slice(0, 6).map((x) => (
                <li key={x.supplier_id}><Link href={`/assure/suppliers/${x.supplier_id}?tab=record`} className="font-semibold hover:underline">{x.name}</Link>
                  <span className="text-muted"> · stage {x.stage_no} {x.stage} · {daysLabel(x.days)} · {x.owner}</span></li>
              ))}</ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Fast-track remediation overdue" sub="Closure gate: any overdue item blocks further orders until it is closed.">
          {d.remediation_overdue.length === 0 ? <p className="p-4 text-sm text-muted">Nothing overdue. {d.remediation_open} remediation item(s) open.</p> : (
            <table className="w-full text-sm">
              <thead><tr>{["Supplier", "Item", "Owner", "Overdue"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{d.remediation_overdue.map((r) => (
                <tr key={r.id}><td className="td"><Link href={`/assure/suppliers/${r.supplier_id}?tab=record`} className="font-semibold hover:underline">{r.name}</Link></td>
                  <td className="td">{r.item}</td><td className="td">{r.owner_type === "vendor" ? "Vendor" : r.owner ?? "—"}</td>
                  <td className="td"><Pill tone="bad">{daysLabel(r.days_overdue)}</Pill></td></tr>
              ))}</tbody>
            </table>
          )}
          {d.fast_tracks.length > 0 && (
            <div className="border-t border-line p-4 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Open exceptions</p>
              <ul className="space-y-1">{d.fast_tracks.map((f) => (
                <li key={f.id}><Link href={`/assure/suppliers/${f.supplier_id}?tab=record`} className="font-semibold hover:underline">{f.name}</Link>
                  <span className="text-muted"> · {f.status === "requested" ? `waiting for ${[!f.director && "Procurement Director", !f.finance && "Local Finance"].filter(Boolean).join(" and ")}` : `closes by ${formatDate(f.close_by)}`}
                    {f.value_cap ? ` · cap ${f.value_cap.toLocaleString("en-GB")} ${f.currency}` : ""}{f.jobs ? ` · ${f.jobs} job(s)` : ""}</span></li>
              ))}</ul>
            </div>
          )}
        </Panel>
        <Panel title="Documented gaps" sub="Due-diligence evidence accepted later: reason, owner and due date, approved by a second person.">
          {d.gaps.length === 0 ? <p className="p-4 text-sm text-muted">No open documented gaps.</p> : (
            <table className="w-full text-sm">
              <thead><tr>{["Supplier", "Evidence", "Owner", "Due", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{d.gaps.map((g) => (
                <tr key={g.id}><td className="td"><Link href={`/assure/suppliers/${g.supplier_id}?tab=record`} className="font-semibold hover:underline">{g.name}</Link></td>
                  <td className="td">{g.gate}</td><td className="td">{g.owner ?? "—"}</td>
                  <td className="td">{formatDate(g.due_date)}{g.days_left < 0 ? <div className="text-xs text-bad">Past due</div> : g.days_left <= 7 ? <div className="text-xs text-warn">{daysLabel(g.days_left)} left</div> : null}</td>
                  <td className="td">{g.status === "proposed" ? <Pill tone="warn">Waiting for approval</Pill> : <Pill tone="ok">Approved</Pill>}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Missing evidence" sub="Open evidence across suppliers in onboarding.">
          <div className="space-y-1 p-4">
            {d.missing_evidence.length === 0 ? <p className="text-sm text-muted">Nothing missing.</p> : d.missing_evidence.slice(0, 14).map((m) => (
              <Link key={m.gate_key} href={`/assure/srt/register?gate=${m.gate_key}`} className="grid grid-cols-[minmax(0,1fr)_90px_28px] items-center gap-2 py-0.5 text-sm hover:underline">
                <span className="truncate">{m.label} <span className="text-xs text-muted">· stage {m.stage_no}</span></span>
                <span className="h-2.5 overflow-hidden rounded-sm bg-surface-2"><span className="block h-full bg-bad/80" style={{ width: `${(m.count / emax) * 100}%` }} /></span>
                <span className="text-right font-mono tabular-nums">{m.count}</span>
              </Link>
            ))}
          </div>
        </Panel>
        <Panel title="Certificates expiring" sub="Within 60 days, or already expired.">
          <div className="p-4 text-sm">
            {d.cert_expiry.length === 0 ? <p className="text-muted">None in the next 60 days.</p> : (
              <ul className="space-y-1">{d.cert_expiry.slice(0, 12).map((c, i) => (
                <li key={i}><Link href={`/assure/suppliers/${c.supplier_id}?tab=record`} className="font-semibold hover:underline">{c.name}</Link>
                  <span className="text-muted"> · {c.gate} · </span>{c.days_left < 0 ? <b className="text-bad">expired {formatDate(c.expiry_date)}</b> : <span>{formatDate(c.expiry_date)} ({daysLabel(c.days_left)})</span>}</li>
              ))}</ul>
            )}
          </div>
        </Panel>
        <Panel title="Flags" sub="Inactive or duplicate suppliers, and segregation exceptions (should be zero).">
          <div className="space-y-3 p-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Segregation exceptions</p>
              {d.segregation.length === 0 ? <p><Pill tone="ok">0</Pill> <span className="text-muted">Nobody requested, approved and released the same supplier.</span></p> : (
                <ul>{d.segregation.map((x, i) => <li key={i} className="text-bad">{x.ref}: {x.detail}</li>)}</ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Possible duplicates ({d.duplicates.length})</p>
              <ul>{d.duplicates.slice(0, 6).map((x, i) => (
                <li key={i}><Link href={`/assure/suppliers/${x.a_id}`} className="hover:underline">{x.a}</Link> and <Link href={`/assure/suppliers/${x.b_id}`} className="hover:underline">{x.b}</Link> <span className="text-muted">· {x.reason}</span></li>
              ))}</ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Inactive ({d.inactive.length})</p>
              <ul>{d.inactive.slice(0, 6).map((x) => (
                <li key={x.supplier_id}><Link href={`/assure/suppliers/${x.supplier_id}`} className="hover:underline">{x.name}</Link> <span className="text-muted">· {x.reason}</span></li>
              ))}</ul>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Onboarding requests" sub="Recent requests and those waiting for Procurement triage." actions={<Link href="/assure/srt/requests" className="text-sm font-semibold text-accent underline">All requests</Link>}>
          {d.cases.length === 0 ? <p className="p-4 text-sm text-muted">No requests yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr>{["Request", "Supplier", "Client · market", "Status", "Requested"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{d.cases.slice(0, 10).map((c) => (
                <tr key={c.id}>
                  <td className="td"><Link href={`/assure/srt/requests/${c.id}`} className="font-mono text-xs font-semibold text-accent underline">#{c.case_no}</Link>{c.kind === "revalidation" && <div className="text-xs text-muted">Revalidation</div>}</td>
                  <td className="td font-semibold">{c.name}{c.matches > 0 && <div className="text-xs font-normal text-warn">{c.matches} possible duplicate(s)</div>}</td>
                  <td className="td">{[c.client, c.market].filter(Boolean).join(" · ")}{c.urgency === "urgent" && <div><Pill tone="warn">Urgent</Pill></div>}</td>
                  <td className="td"><Pill tone={TAXONOMY[c.taxonomy].tone}>{TAXONOMY[c.taxonomy].label}</Pill></td>
                  <td className="td text-xs text-muted">{formatDate(c.requested_at)}<div>{c.requested_by}</div></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
        <Panel title="Review cadence" sub="Weekly open cases and exceptions, monthly overdue evidence and expiring controls, quarterly sample audit and access review, revalidation by risk." actions={<RunCadenceButton />}>
          {d.review_tasks.length === 0 ? <p className="p-4 text-sm text-muted">No open reviews.</p> : (
            <ul className="divide-y divide-line text-sm">
              {d.review_tasks.slice(0, 10).map((t) => (
                <li key={t.id} className="space-y-1 px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{t.supplier_id ? <Link href={`/assure/suppliers/${t.supplier_id}?tab=record`} className="hover:underline">{t.title}</Link> : t.title}</span>
                    <span className="text-xs text-muted">{t.cadence} · due {formatDate(t.due_date)}</span>
                  </div>
                  {t.detail && <p className="text-xs text-muted">{t.detail}</p>}
                  <details>
                    <summary className="cursor-pointer text-xs text-accent">Record the outcome</summary>
                    <ActionForm action={closeReviewTask.bind(null, t.id)} submit="Close review" inline className="mt-1">
                      <input name="outcome" required placeholder="What was checked and found" className="input min-w-[260px] py-1" />
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
