import { Card, Stat } from "@/components/ui";
import { fmtDays, fmtPct, levelLabel, targetTone, type DeliveryKpis } from "@/lib/qaqc";

const STAGES: [keyof NonNullable<DeliveryKpis["speed"]>["stages"], string][] = [
  ["brief_to_approval", "Brief to approval"], ["approval_to_po", "Approval to PO"], ["po_to_pod", "PO to proof of delivery"], ["pod_to_installed", "Delivery to install"],
];

/** OTIF, QA/QC pass rate by level, NCRs (internal only) and speed to market, as returned by the *_delivery_kpis functions. */
export function DeliveryKpisView({ kpis, internal }: { kpis: DeliveryKpis; internal?: boolean }) {
  const o = kpis.otif, q = kpis.qaqc, sp = kpis.speed;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="On time in full" value={fmtPct(o?.otif_percent)} tone={targetTone(o?.otif_percent, o?.target)}
          hint={o?.measured ? `${o.otif} of ${o.measured} deliveries · on time ${fmtPct(o.on_time_percent)} · in full ${fmtPct(o.in_full_percent)} · target ${fmtPct(o.target)}` : "No deliveries measured yet"} />
        <Stat label="QA/QC pass rate" value={fmtPct(q?.pass_percent)} tone={targetTone(q?.pass_percent, q?.target)}
          hint={q?.plans ? `${q.passed} passed, ${q.failed} failed, ${q.open} open of ${q.plans} plans · first time ${fmtPct(q.first_time_pass_percent)}` : "No QA/QC plans yet"} />
        <Stat label="Speed to market (median)" value={fmtDays(sp?.median_brief_to_delivery_days)} tone={targetTone(sp?.median_brief_to_delivery_days, sp?.target_days, true)}
          hint={sp?.jobs ? `Brief to delivery over ${sp.jobs} job(s) · target ${fmtDays(sp.target_days)}` : "No delivered jobs yet"} />
        {internal && kpis.ncrs ? (
          <Stat label="Non-conformances" value={kpis.ncrs.raised} tone={kpis.ncrs.open > 0 ? "warn" : undefined} hint={`${kpis.ncrs.open} open · ${kpis.ncrs.from_qaqc} from QA/QC · ${kpis.ncrs.critical} critical`} />
        ) : (
          <Stat label="Deliveries measured" value={o?.measured ?? 0} hint="Last 12 months" />
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <p className="eyebrow mb-2">QA/QC by level</p>
          {q?.by_level.length ? (
            <table className="w-full text-sm"><thead><tr><th className="th">Level</th><th className="th text-right">Plans</th><th className="th text-right">Passed</th><th className="th text-right">Pass rate</th></tr></thead>
              <tbody>{q.by_level.map((l) => <tr key={l.level}><td className="td font-semibold">{levelLabel(l.level)}</td><td className="td text-right">{l.plans}</td><td className="td text-right">{l.passed}</td><td className="td text-right">{fmtPct(l.pass_percent)}</td></tr>)}</tbody></table>
          ) : <p className="text-sm text-muted">No QA/QC plans yet.</p>}
        </Card>
        <Card className="p-5">
          <p className="eyebrow mb-2">Speed to market by stage (median days)</p>
          <ul className="space-y-1.5 text-sm">{STAGES.map(([k, label]) => (
            <li key={k} className="flex justify-between"><span>{label}</span><span className="font-semibold tabular-nums">{fmtDays(sp?.stages?.[k])}</span></li>))}</ul>
        </Card>
        <Card className="p-5">
          <p className="eyebrow mb-2">OTIF by month</p>
          {kpis.otif_by_month.length ? (
            <ul className="space-y-1.5 text-sm">{kpis.otif_by_month.map((m) => (
              <li key={m.month} className="flex items-center gap-2"><span className="w-16 text-muted">{m.month}</span>
                <span className="h-2 flex-1 rounded-full bg-surface-2"><span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, Number(m.otif_percent ?? 0))}%` }} /></span>
                <span className="w-24 text-right tabular-nums">{fmtPct(m.otif_percent)} <span className="text-xs text-muted">({m.measured})</span></span></li>))}</ul>
          ) : <p className="text-sm text-muted">No deliveries measured yet.</p>}
        </Card>
      </div>
    </div>
  );
}
