import Link from "next/link";
import { clsx } from "clsx";
import { Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { fmtDateTime } from "@/components/sourcing/bits";
import { EVENT_LABEL, MATCH_STATUS, money, pct, type FinanceEvent, type MatchDetails, type MatchStatus } from "@/lib/finance-logic";

/** Horizontal bars in plain HTML/CSS. Each row may carry a second (lighter) value drawn underneath, e.g. invoiced vs PO. */
export function Bars({ rows, currency, primaryLabel, secondaryLabel }: {
  rows: { key: string; label: React.ReactNode; value: number; secondary?: number; flag?: boolean; hint?: React.ReactNode }[];
  currency?: string; primaryLabel: string; secondaryLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.secondary ?? 0)));
  if (rows.length === 0) return <p className="px-5 py-4 text-sm text-muted">Nothing to show yet.</p>;
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><i className="block h-2.5 w-4 rounded-sm bg-accent" />{primaryLabel}</span>
        {secondaryLabel && <span className="inline-flex items-center gap-1.5"><i className="block h-2.5 w-4 rounded-sm bg-accent/30" />{secondaryLabel}</span>}
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(7rem,12rem)_1fr] items-center gap-3 text-sm">
          <div className="min-w-0 truncate font-semibold" title={typeof r.label === "string" ? r.label : undefined}>{r.label}</div>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <div className="h-3 rounded-sm bg-accent" style={{ width: `${Math.max(0.5, (100 * r.value) / max)}%` }} aria-hidden />
              <span className="whitespace-nowrap text-xs tabular-nums">{money(r.value, currency)}</span>
              {r.flag && <Pill tone="bad">Over PO</Pill>}
            </div>
            {r.secondary != null && (
              <div className="flex items-center gap-2">
                <div className={clsx("h-2 rounded-sm", r.flag ? "bg-bad/50" : "bg-accent/30")} style={{ width: `${Math.max(0.5, (100 * r.secondary) / max)}%` }} aria-hidden />
                <span className="whitespace-nowrap text-xs tabular-nums text-muted">{money(r.secondary, currency)}</span>
              </div>
            )}
            {r.hint && <div className="text-xs text-muted">{r.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Check({ ok, title, children }: { ok: boolean | undefined; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-5 py-3.5">
      <MSymbol name={ok ? "check_circle" : "error"} className={ok ? "text-ok" : "text-warn"} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 text-sm text-muted">{children}</div>
      </div>
    </div>
  );
}

/** The three-way match result with evidence links to Order Management+, Logistics+ and Execution+. */
export function MatchPanel({ status, details, poId, poNumber, jobId }: { status: MatchStatus; details: MatchDetails; poId: string; poNumber: string; jobId: string }) {
  if (status === "not_run" || !details.amount) {
    return <p className="px-5 py-4 text-sm text-muted">The match hasn&apos;t been run yet. Run it to compare the invoice with the PO and the delivery and install records.</p>;
  }
  const a = details.amount;
  const d = details.deliveries;
  const dep = details.deployments;
  return (
    <div className="divide-y divide-line">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
        <Pill tone={MATCH_STATUS[status].tone}>{MATCH_STATUS[status].label}</Pill>
        <span className="text-muted">Checked {fmtDateTime(details.checked_at)}</span>
      </div>
      <Check ok={a.ok} title="1. Invoice vs purchase order">
        <p>
          Invoiced on <Link className="font-semibold text-accent hover:underline" href={`/orders/purchase-orders/${poId}`}>{poNumber}</Link>: {money(a.invoiced_total, a.currency)} against a PO value of {money(a.po_value, a.currency)}
          {Number(a.other_invoiced) > 0 && <> (this invoice {money(a.invoice_net, a.currency)} plus {money(a.other_invoiced, a.currency)} on earlier invoices)</>}.
        </p>
        <p>
          Difference {money(a.variance, a.currency)} ({pct(a.variance_percent, 2)}); tolerance {pct(a.tolerance_percent, 1)} over the PO value. <span className="text-xs">{a.tolerance_basis}</span>
        </p>
        {Number(a.remaining_to_invoice) > 0 && <p>{money(a.remaining_to_invoice, a.currency)} of the PO is still to be invoiced.</p>}
      </Check>
      <Check ok={d?.ok} title="2. Delivered, with proof of delivery verified (Logistics+)">
        {!d || d.count === 0 ? <p>No deliveries are recorded against this PO.</p> : (
          <>
            <p>{d.delivered} of {d.count} deliveries delivered; {d.pods_unverified} POD(s) not verified.</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {d.items.map((x) => (
                <li key={x.id}>
                  <Link className="font-semibold text-accent hover:underline" href={`/logistics/deliveries/${x.id}`}>{x.delivery_number}</Link>{" "}
                  <span className="text-xs">{x.status.replace(/_/g, " ")} · POD {x.pods_verified}/{x.pods_total}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Check>
      <Check ok={dep?.ok} title="3. Installed and audited (Execution+)">
        {!dep || !dep.applies ? <p>No installs on this PO, so this check doesn&apos;t apply.</p> : (
          <>
            <p>{dep.done} of {dep.count} installs are installed (audit not failed) or audited and passed.</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {dep.items.map((x) => (
                <li key={x.id}>
                  <Link className="font-semibold text-accent hover:underline" href={`/execution/deployments/${x.id}`}>{x.deployment_code}</Link>{" "}
                  <span className="text-xs">{x.stage} · audit {x.audit_status.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1"><Link className="text-accent hover:underline" href={`/execution/jobs/${jobId}`}>Job close check in Execution+</Link></p>
          </>
        )}
      </Check>
      {details.missing && details.missing.length > 0 && (
        <div className="px-5 py-3 text-sm"><span className="font-semibold">Still missing:</span> {details.missing.join("; ")}</div>
      )}
    </div>
  );
}

export function FinanceActivity({ events }: { events: FinanceEvent[] }) {
  if (events.length === 0) return <p className="px-5 py-4 text-sm text-muted">Nothing recorded yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
          <span className="w-40 shrink-0 text-xs text-muted">{fmtDateTime(e.at)}</span>
          <span className="font-semibold">{EVENT_LABEL[e.event] ?? e.event.replace(/_/g, " ")}</span>
          {e.to_status && e.from_status !== e.to_status && <span className="text-xs text-muted">{e.from_status ? `${e.from_status} → ` : ""}{e.to_status}</span>}
          <span className="min-w-0 flex-1 truncate text-xs text-muted">{describe(e.detail)}</span>
          <span className="text-xs text-muted">{e.actor_name ?? (e.actor ? "Someone" : "Supplier / system")}</span>
        </li>
      ))}
    </ol>
  );
}

function describe(d: Record<string, unknown>) {
  return Object.entries(d ?? {})
    .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(" · ");
}

/** Pill-style filter links (state in the URL). */
export function FilterLinks({ base, param, current, options }: { base: string; param: string; current: string; options: { key: string; label: string; count?: number }[] }) {
  return (
    <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter">
      {options.map((o) => (
        <Link key={o.key} href={`${base}?${param}=${o.key}`}
          className={clsx("rounded-full border px-3 py-1 font-semibold", current === o.key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg")}>
          {o.label}{o.count != null ? ` (${o.count})` : ""}
        </Link>
      ))}
    </nav>
  );
}
