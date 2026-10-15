import Link from "next/link";
import { clsx } from "clsx";
import { Card, Empty, Panel } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import {
  INFLUENCE_METRICS, PERSPECTIVES, ROUTES, VIEWS, fmtKpi, hrefWith, kpisOf, routeColor, routeLabel, viewOf,
  type Callout, type CountryRow, type Kpi, type KpiDefinition, type Options, type Perspective, type ScorecardParams, type ScorecardReport,
} from "@/lib/scorecard-reporting";
import { FilterBar } from "./filter-bar";
import { GroupedBars, HBars, LineChart, Legend, RouteMatrix, type Series } from "./charts";
import { Callouts, CountryTable, KpiHeadline, NotMeasured, PerspectiveGrid, Totals } from "./panels";

type Props = {
  report: ScorecardReport | null;
  params: ScorecardParams;
  /** Page path the links and the filter form point at. */
  base: string;
  /** Fixed params to keep on every link (e.g. tab=scorecard, preview=<client>). */
  keep?: Record<string, string | null | undefined>;
  options: Options | null;
  /** Internal all-clients view: offer a client filter. */
  clients?: { id: string; name: string }[];
  /** Shown under the filters (who the numbers cover). */
  scopeNote?: string;
};

/** The balanced scorecard: one component set used in the Watchtower, CRM and the Client Portal. */
export function ScorecardView({ report, params, base, keep = {}, options, clients, scopeNote }: Props) {
  const view = viewOf(params);
  const link = (patch: Partial<Record<keyof ScorecardParams, string | null>>) => hrefWith(base, params, patch, keep);
  return (
    <div className="space-y-4">
      <nav aria-label="Scorecard views" className="flex flex-wrap gap-1 border-b border-line">
        {VIEWS.map((v) => (
          <Link key={v.key} href={link({ view: v.key === "summary" ? null : v.key, kpi: null, metric: null })} aria-current={view === v.key ? "page" : undefined}
            className={clsx("-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold",
              view === v.key ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            <MSymbol name={v.icon} size={18} />{v.label}
          </Link>
        ))}
      </nav>
      <FilterBar base={base} params={params} options={options} keep={keep} clients={clients} />
      {scopeNote && <p className="text-xs text-muted">{scopeNote} Money is shown in EUR at the Watchtower reporting rates.</p>}
      {!report ? <Card><Empty title="The scorecard could not be loaded">Try again, or clear the filters.</Empty></Card> : (
        <>
          {view === "summary" && (
            <>
              <Totals report={report} />
              <Callouts items={report.callouts} />
              <PerspectiveGrid kpis={report.kpis} hrefFor={(p) => link({ view: p, kpi: null })} />
            </>
          )}
          {PERSPECTIVES.some((p) => p.key === view) && <PerspectiveView report={report} perspective={view as Perspective} params={params} link={link} />}
          {view === "influence" && <InfluenceView report={report} params={params} link={link} />}
          {view === "kpis" && (
            <Panel title="Strategic KPIs by country" sub="Each country against its own target (client and market targets where set). Red cells are below target.">
              <CountryTable rows={report.country.rows} definitions={report.country.definitions} />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function PerspectiveView({ report, perspective, params, link }: {
  report: ScorecardReport; perspective: Perspective; params: ScorecardParams; link: (p: Partial<Record<keyof ScorecardParams, string | null>>) => string;
}) {
  const kpis = kpisOf(report, perspective);
  const kpi = kpis.find((k) => k.code === params.kpi) ?? kpis[0];
  const p = PERSPECTIVES.find((x) => x.key === perspective)!;
  if (!kpi) return null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{p.blurb}</p>
      <div className="flex flex-wrap gap-2">
        {kpis.map((k) => (
          <Link key={k.code} href={link({ kpi: k.code })} aria-current={k.code === kpi.code ? "true" : undefined}
            className={clsx("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold",
              k.code === kpi.code ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg")}>
            {k.name}<span className="tabular-nums text-fg">{k.status === "not_measured" ? "—" : fmtKpi(k.unit, k.current)}</span>
            <i className={clsx("block h-2 w-2 rounded-full", k.status === "on_target" ? "bg-ok" : k.status === "off_target" ? "bg-bad" : "bg-line")} />
          </Link>
        ))}
      </div>
      {!kpi.measured ? <NotMeasured kpi={kpi} /> : <KpiDetail report={report} kpi={kpi} />}
    </div>
  );
}

function KpiDetail({ report, kpi }: { report: ScorecardReport; kpi: Kpi }) {
  const b = report.breakdowns[kpi.code];
  const survey = kpi.code === "MARKET_TEMPERATURE_PCT";
  const routes = ROUTES.filter((r) => b?.by_route_month.some((x) => x.route === r.key && x.value != null));
  const series: Series[] = survey || routes.length === 0
    ? [{ key: "all", label: kpi.name, color: "#010062", points: (b?.by_month ?? []).map((m) => ({ x: m.month, y: m.value })) }]
    : routes.map((r) => ({ key: r.key, label: r.label, color: r.color, points: b!.by_route_month.filter((x) => x.route === r.key).map((x) => ({ x: x.month, y: x.value })) }));
  return (
    <div className="space-y-4">
      <Card><KpiHeadline kpi={kpi} /></Card>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title={survey ? `${kpi.name} by month` : `${kpi.name} by AAC route over time`} className="xl:col-span-2">
          <div className="px-5 py-4"><LineChart series={series} unit={kpi.unit} target={kpi.target} title={`${kpi.name} by month`} /></div>
        </Panel>
        <Panel title="By market" sub={kpi.direction === "lower" ? "Lower is better; green tick = target" : "Green tick = target"}>
          <div className="max-h-[22rem] overflow-y-auto px-5 py-4">
            <HBars unit={kpi.unit} direction={kpi.direction} rows={(b?.by_market ?? []).map((m) => ({ label: m.name ?? m.market, value: m.value, target: m.target }))} />
          </div>
        </Panel>
      </div>
      {survey ? (
        <Card className="px-5 py-3 text-xs text-muted">Survey responses are cut by market and date only: they are not tied to an AAC route, spec type or business unit.</Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Spec type by AAC route">
            <div className="px-5 py-4"><RouteMatrix unit={kpi.unit} rowLabel="Spec type" rows={(b?.by_spec_type ?? []).map((x) => ({ row: x.spec_type, route: x.route, value: x.value }))} /></div>
          </Panel>
          <Panel title="Business unit by AAC route">
            <div className="px-5 py-4"><GroupedBars unit={kpi.unit} rows={(b?.by_business_unit ?? []).map((x) => ({ row: x.business_unit, route: x.route, value: x.value }))} /></div>
          </Panel>
        </div>
      )}
    </div>
  );
}


function InfluenceView({ report, params, link }: { report: ScorecardReport; params: ScorecardParams; link: (p: Partial<Record<keyof ScorecardParams, string | null>>) => string }) {
  const metric = INFLUENCE_METRICS.find((m) => m.key === params.metric) ?? INFLUENCE_METRICS[0];
  const f = report.influence;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">How the way work is set up changes the result: the same measures split by urgency, governance model and spec complexity, across AAC routes.</p>
      <div className="flex flex-wrap gap-2">
        {INFLUENCE_METRICS.map((m) => (
          <Link key={m.key} href={link({ metric: m.key === "savings_pct" ? null : m.key })} aria-current={m.key === metric.key ? "true" : undefined}
            className={clsx("rounded-lg border px-3 py-1.5 text-sm font-semibold", m.key === metric.key ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg")}>
            {m.label}
          </Link>
        ))}
      </div>
      <Card className="px-5 py-3 text-sm">All lines in this selection: <b>{fmtKpi(metric.unit, f.total[metric.key] as number | null)}</b> {metric.label.toLowerCase()} over {f.total.lines} order lines.</Card>
      <div className="grid gap-4 xl:grid-cols-3">
        {f.factors.map((fx) => {
          const routes = ROUTES.filter((r) => fx.groups.some((g) => g.by_route.some((x) => x.route === r.key && x.metrics.lines > 0)));
          return (
            <Panel key={fx.key} title={`${metric.label} by ${fx.label.toLowerCase()}`}>
              <div className="space-y-4 px-5 py-4">
                <Legend items={routes.map((r) => ({ label: r.label, color: r.color }))} />
                {fx.groups.length === 0 ? <p className="text-sm text-muted">No data for this selection.</p> : fx.groups.map((g) => {
                  const vals = fx.groups.flatMap((gg) => gg.by_route.map((x) => Number(x.metrics[metric.key] ?? 0)));
                  const max = Math.max(1, ...vals.map(Math.abs));
                  return (
                    <div key={g.key}>
                      <p className="flex justify-between text-sm font-semibold"><span>{g.label}</span>
                        <span className="tabular-nums">{fmtKpi(metric.unit, g.metrics[metric.key] as number | null)} <span className="text-xs font-normal text-muted">· {g.metrics.lines} lines</span></span></p>
                      <ul className="mt-1 space-y-0.5">
                        {g.by_route.filter((x) => x.metrics.lines > 0 && x.route !== "unrouted").map((x) => {
                          const v = x.metrics[metric.key] as number | null;
                          return (
                            <li key={x.route} className="grid grid-cols-[4rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
                              <span className="text-muted">{routeLabel(x.route)}</span>
                              <span className="h-2 rounded-full bg-surface-2"><span className="block h-2 rounded-full" style={{ width: `${v == null ? 0 : Math.max(2, (Math.abs(v) / max) * 100)}%`, background: routeColor(x.route) }} /></span>
                              <span className="text-right tabular-nums">{fmtKpi(metric.unit, v)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Panel>
          );
        })}
      </div>
      <Panel title="All influence measures" sub="Each split adds up to the selection: lines and spend by group">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Factor</th><th className="th">Group</th><th className="th text-right">Lines</th>
              {INFLUENCE_METRICS.map((m) => <th key={m.key} className="th text-right">{m.label}</th>)}</tr></thead>
            <tbody>
              {f.factors.flatMap((fx) => fx.groups.map((g, i) => (
                <tr key={`${fx.key}-${g.key}`}>
                  <td className="td font-semibold">{i === 0 ? fx.label : ""}</td><td className="td">{g.label}</td>
                  <td className="td text-right tabular-nums">{g.metrics.lines}</td>
                  {INFLUENCE_METRICS.map((m) => <td key={m.key} className="td text-right tabular-nums">{fmtKpi(m.unit, g.metrics[m.key] as number | null)}</td>)}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/** Compact scorecard for a business review pack: perspective panels and the country table. */
export function ScorecardPackSection({ pack }: {
  pack: { since?: string; summary?: Pick<Kpi, "code" | "name" | "perspective" | "unit" | "direction" | "current" | "target" | "status">[];
          country?: { rows?: CountryRow[]; definitions?: KpiDefinition[] } | null;
          callouts?: Callout[] } | null | undefined;
}) {
  if (!pack?.summary?.length) return null;
  return (
    <div className="space-y-4 px-5 py-4">
      <p className="eyebrow">Balanced scorecard, last 12 months</p>
      <Callouts items={pack.callouts ?? []} />
      <PerspectiveGrid kpis={pack.summary} />
      {pack.country?.rows && pack.country.rows.length > 0 && (
        <Card><div className="border-b border-line px-5 py-3"><h3 className="font-display text-[0.95rem] font-bold">Strategic KPIs by country</h3></div>
          <CountryTable rows={pack.country.rows} definitions={pack.country.definitions} /></Card>
      )}
    </div>
  );
}

