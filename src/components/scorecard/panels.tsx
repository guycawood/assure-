import Link from "next/link";
import { clsx } from "clsx";
import { Card, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import {
  PERSPECTIVES, STATUS, TARGET_SOURCE, fmtEur, fmtKpi, routeColor, vsTarget,
  type Callout, type CountryRow, type Kpi, type KpiDefinition, type Perspective, type ScorecardReport,
} from "@/lib/scorecard-reporting";

const PERSPECTIVE_TONE: Record<Perspective, string> = {
  plan: "bg-[#4896F7]/15", design: "bg-[#8E6CCB]/15", buy: "bg-[#010062]/10", manage: "bg-[#E07B39]/15",
};

export function StatusPill({ kpi }: { kpi: Pick<Kpi, "status"> }) {
  const s = STATUS[kpi.status] ?? STATUS.no_data;
  return <Pill tone={s.tone}>{kpi.status === "on_target" ? <MSymbol name="arrow_upward" size={13} /> : kpi.status === "off_target" ? <MSymbol name="arrow_downward" size={13} /> : null}{s.label}</Pill>;
}

/** Spend and savings, and spend by AAC route. */
export function Totals({ report }: { report: ScorecardReport }) {
  const t = report.totals;
  const routes = t.by_route.filter((r) => r.route !== "unrouted" || r.spend_eur > 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-display text-lg font-bold">Total spend {fmtEur(t.spend_eur)} <span className="text-sm font-normal text-muted">· {t.lines} order lines</span></p>
        <p className="font-display text-lg font-bold">Savings {fmtEur(t.savings_eur)}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {routes.map((r) => (
          <Card key={r.route} className="px-5 py-3 text-center">
            <p className="text-sm font-bold" style={{ color: routeColor(r.route) }}>{r.label}</p>
            <p className="font-display text-xl font-bold tabular-nums">{fmtEur(r.spend_eur)}</p>
            <p className="text-xs text-muted">{r.lines} lines · saved {fmtEur(r.savings_eur)}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** One perspective: objective, target, current, status. */
export function PerspectivePanel({ perspective, kpis, href }: { perspective: Perspective; kpis: Pick<Kpi, "code" | "name" | "unit" | "current" | "target" | "status">[]; href?: string }) {
  const p = PERSPECTIVES.find((x) => x.key === perspective)!;
  return (
    <Card className="overflow-hidden">
      <div className={clsx("flex items-center justify-between gap-2 px-5 py-2.5", PERSPECTIVE_TONE[perspective])}>
        <h3 className="flex items-center gap-2 font-display text-[0.95rem] font-bold"><MSymbol name={p.icon} size={18} />{p.label}</h3>
        {href && <Link href={href} className="text-xs font-semibold text-accent hover:underline">Open</Link>}
      </div>
      <table className="w-full text-sm">
        <thead><tr><th className="th">Objective</th><th className="th text-right">Target</th><th className="th text-right">Current</th><th className="th text-right">Status</th></tr></thead>
        <tbody>
          {kpis.map((k) => (
            <tr key={k.code}>
              <td className="td">{k.name}</td>
              <td className="td text-right tabular-nums">{k.target == null ? "—" : fmtKpi(k.unit, k.target)}</td>
              <td className="td text-right font-semibold tabular-nums">{k.status === "not_measured" ? "—" : fmtKpi(k.unit, k.current)}</td>
              <td className="td text-right"><StatusPill kpi={k} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function PerspectiveGrid({ kpis, hrefFor }: { kpis: Pick<Kpi, "code" | "name" | "unit" | "current" | "target" | "status" | "perspective">[]; hrefFor?: (p: Perspective) => string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {PERSPECTIVES.map((p) => <PerspectivePanel key={p.key} perspective={p.key} kpis={kpis.filter((k) => k.perspective === p.key)} href={hrefFor?.(p.key)} />)}
    </div>
  );
}

export function Callouts({ items }: { items: Callout[] }) {
  if (!items?.length) return null;
  return (
    <Card className="px-5 py-4">
      <p className="eyebrow mb-2">What the numbers say</p>
      <ul className="space-y-1.5 text-sm">
        {items.map((c, i) => (
          <li key={i} className="flex gap-2">
            <MSymbol name={c.tone === "bad" ? "error" : c.tone === "warn" ? "warning" : "lightbulb"} size={18}
              className={clsx("shrink-0", c.tone === "bad" ? "text-bad" : c.tone === "warn" ? "text-warn" : "text-info")} />
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** KPI headline: current against target, with the definition. */
export function KpiHeadline({ kpi }: { kpi: Kpi }) {
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-2 px-5 py-4">
      <div>
        <p className="eyebrow">Current</p>
        <p className={clsx("font-display text-[1.75rem] font-bold leading-none tabular-nums", kpi.status === "on_target" && "text-ok", kpi.status === "off_target" && "text-bad")}>
          {kpi.status === "not_measured" ? "—" : fmtKpi(kpi.unit, kpi.current)}
        </p>
      </div>
      <div>
        <p className="eyebrow">Target</p>
        <p className="font-display text-[1.75rem] font-bold leading-none tabular-nums">{kpi.target == null ? "—" : fmtKpi(kpi.unit, kpi.target)}</p>
        {kpi.target_source && <p className="text-xs text-muted">{TARGET_SOURCE[kpi.target_source]} · {kpi.direction === "lower" ? "lower is better" : "higher is better"}</p>}
      </div>
      <div className="pt-1"><StatusPill kpi={kpi} /></div>
      <div className="min-w-[16rem] flex-1 text-sm">
        <p>{kpi.definition}</p>
        <p className="text-xs text-muted">{[kpi.formula && `Formula: ${kpi.formula}`, kpi.measurement, kpi.source && `Source: ${kpi.source}`, kpi.n != null && `Based on ${fmtCount(kpi)}`].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );
}
function fmtCount(k: Kpi) {
  if (k.n == null) return "";
  return k.unit === "percent" && k.n > 10000 ? `${fmtEur(k.n)} of spend` : `${Math.round(k.n)} ${k.code === "MARKET_TEMPERATURE_PCT" ? "survey responses" : k.code === "URGENT_PCT" ? "jobs" : "order lines"}`;
}

/** Strategic KPIs by country, with the definitions underneath. */
export function CountryTable({ rows, definitions }: { rows: CountryRow[]; definitions?: KpiDefinition[] }) {
  const cell = (v: number | null, t: number | null) => (
    <td className={clsx("td text-right tabular-nums", vsTarget(v, t) === "bad" && "bg-bad-soft text-bad", vsTarget(v, t) === "ok" && "text-ok")}>{fmtKpi("percent", v)}</td>
  );
  const tgt = (t: number | null) => <td className="td text-right tabular-nums text-muted">{fmtKpi("percent", t)}</td>;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        {rows.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No orders in this selection.</p> : (
          <table className="w-full text-sm">
            <thead><tr>{["Country", "KPI delivery", "Savings", "Savings target", "Rate card", "Rate-card target", "OTIF", "OTIF target", "Quality", "Quality target"].map((h, i) =>
              <th key={h} className={clsx("th", i > 0 && "text-right")}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.market}>
                  <td className="td font-semibold">{r.name}<span className="block text-xs font-normal text-muted">{r.lines} lines</span></td>
                  <td className={clsx("td text-right font-semibold tabular-nums", r.kpi_delivery != null && (r.kpi_delivery >= 75 ? "bg-ok-soft text-ok" : r.kpi_delivery < 50 ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"))}>{fmtKpi("percent", r.kpi_delivery)}</td>
                  {cell(r.savings, r.savings_target)}{tgt(r.savings_target)}
                  {cell(r.rate_card, r.rate_card_target)}{tgt(r.rate_card_target)}
                  {cell(r.otif, r.otif_target)}{tgt(r.otif_target)}
                  {cell(r.quality, r.quality_target)}{tgt(r.quality_target)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {definitions && definitions.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead><tr><th className="th">KPI</th><th className="th">Definition</th><th className="th">How it is measured</th><th className="th text-right">Standard target</th></tr></thead>
            <tbody>
              <tr><td className="td font-semibold">KPI delivery</td><td className="td">Share of the four strategic KPIs below that are on target in the country.</td><td className="td text-muted">Only KPIs with data and a target count.</td><td className="td text-right">—</td></tr>
              {definitions.map((d) => (
                <tr key={d.code} className="align-top">
                  <td className="td font-semibold">{d.name}</td><td className="td">{d.definition}</td>
                  <td className="td text-muted">{[d.formula, d.measurement].filter(Boolean).join(". ")}</td>
                  <td className="td text-right tabular-nums">{fmtKpi("percent", d.default_target)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function NotMeasured({ kpi }: { kpi: Kpi }) {
  return (
    <Panel title={kpi.name} sub="Not yet measured">
      <p className="px-5 py-4 text-sm text-muted">{kpi.measurement ?? "There is no data source for this KPI yet."} It is shown so the scorecard stays complete; no figure is estimated.</p>
    </Panel>
  );
}
