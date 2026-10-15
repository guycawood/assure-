import { clsx } from "clsx";
import { Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import {
  EVENT_LABEL, LEVELS, SOURCE_LABEL, STAGES, fmtDims, fmtNum, packOf, pctTone, sheetStatus, type Completeness, type TechSheet,
} from "@/lib/tech-sheet";

const d = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");

/** Completeness per stage: percentage and what is still missing, in plain words. */
export function StageBars({ completeness, compact }: { completeness: Record<string, Completeness | undefined>; compact?: boolean }) {
  return (
    <div className={clsx("grid gap-3", compact ? "sm:grid-cols-3" : "md:grid-cols-3")}>
      {STAGES.map((st) => {
        const c = completeness[st.key];
        if (!c) return null;
        return (
          <div key={st.key} className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-muted">
              <span>{st.label}</span><Pill tone={c.required === 0 ? "neutral" : pctTone(c.percent)}>{c.required === 0 ? "Nothing required" : `${c.percent}%`}</Pill>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className={clsx("h-full", c.percent >= 100 ? "bg-ok" : c.percent >= 60 ? "bg-warn" : "bg-bad")} style={{ width: `${Math.min(100, c.percent)}%` }} />
            </div>
            {!compact && c.missing.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted">{c.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            )}
            {compact && c.missing.length > 0 && <p className="mt-1.5 text-xs text-muted">Missing: {c.missing.slice(0, 3).join("; ")}{c.missing.length > 3 ? ` and ${c.missing.length - 3} more` : ""}</p>}
            {c.tbc_by && st.key === "quote" && <p className="mt-1.5 text-xs text-warn">To be confirmed by {d(c.tbc_by)}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Declared values next to what QA/QC measured on a packed carton, with the tolerance outcome. */
export function DeclaredVsMeasured({ sheet }: { sheet: TechSheet }) {
  const p2 = packOf(sheet, "secondary");
  const rows: [string, string, string][] = [
    ["Carton gross weight", fmtNum(p2?.gross_weight_kg, "kg"), fmtNum(sheet.actual.gross_weight_kg, "kg")],
    ["Carton size", fmtDims(p2?.length_mm, p2?.width_mm, p2?.height_mm), fmtDims(sheet.actual.length_mm, sheet.actual.width_mm, sheet.actual.height_mm)],
    ["Units per carton", fmtNum(p2?.units_per_pack), "–"],
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead><tr><th className="th">Value</th><th className="th">Declared by the vendor</th><th className="th">Measured at pre-shipment</th></tr></thead>
        <tbody>{rows.map(([k, a, b]) => <tr key={k}><td className="td font-semibold">{k}</td><td className="td tabular-nums">{a}</td><td className="td tabular-nums">{b}</td></tr>)}</tbody>
      </table>
      {sheet.verification.length > 0 && (
        <ul className="space-y-0.5 border-t border-line px-4 py-2 text-xs">
          {sheet.verification.map((c, i) => (
            <li key={i} className={c.ok ? "text-ok" : "text-bad"}><MSymbol name={c.ok ? "check_circle" : "error"} size={14} className="mr-1 align-[-2px]" />{c.detail}</li>
          ))}
        </ul>
      )}
      {!sheet.actual.measured_at && <p className="border-t border-line px-4 py-2 text-xs text-muted">Not measured yet: QA/QC measures a packed carton at the pre-shipment check.</p>}
    </div>
  );
}

function Facts({ items }: { items: [string, string | null | undefined][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="min-w-[9rem] text-muted">{k}</dt><dd className="font-medium">{v || "–"}</dd></div>)}
    </dl>
  );
}

/** The whole sheet, read-only: status, completeness, product as built, packaging per level, declared vs measured, history. */
export function SheetView({ sheet, compact, vendor }: { sheet: TechSheet; compact?: boolean; vendor?: boolean }) {
  const st = sheetStatus(sheet.status);
  const specChanged = sheet.spec_revision != null && sheet.current_spec_revision != null && sheet.current_spec_revision > sheet.spec_revision;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-sm font-bold">{sheet.sheet_ref}</span>
        <Pill tone={st.tone}>{st.label}</Pill>
        <span className="text-xs text-muted">{SOURCE_LABEL[sheet.source] ?? sheet.source}{sheet.copied_from_ref ? ` (${sheet.copied_from_ref})` : ""}
          {sheet.version > 0 ? ` · version ${sheet.version}` : ""}{sheet.declared_at ? ` · declared ${d(sheet.declared_at)}${!vendor && sheet.declared_by_name ? ` by ${sheet.declared_by_name}` : ""}` : ""}</span>
      </div>
      {sheet.status === "mismatch" && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">The packed carton measured at pre-shipment does not match this sheet. {vendor ? "Correct the sheet (or the packing) and declare it again." : "The QA/QC checkpoint is with a quality role for review."}</p>}
      {specChanged && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">The spec changed (revision {sheet.current_spec_revision}) after this sheet was declared on revision {sheet.spec_revision}. Check it still holds.</p>}
      {sheet.tbc_by && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Packaging to be confirmed by {d(sheet.tbc_by)}{sheet.tbc_note ? `: ${sheet.tbc_note}` : ""}.</p>}
      <StageBars completeness={sheet.completeness} compact={compact} />
      <DeclaredVsMeasured sheet={sheet} />
      {!compact && (
        <>
          <section className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted">Product as built</h4>
            <Facts items={[
              ["Size", fmtDims(sheet.length_mm, sheet.width_mm, sheet.height_mm)], ["Net weight", fmtNum(sheet.net_weight_g, "g")],
              ["Finishes", sheet.finishes], ["Components", sheet.components_note],
              ["Electrical / battery", sheet.has_electrical == null ? null : sheet.has_electrical ? `Yes${sheet.has_battery ? ", with battery" : ""}${sheet.electrical_detail ? `: ${sheet.electrical_detail}` : ""}` : "No"],
              ["Country of origin", sheet.origin_country], ["HS code", sheet.hs_code], ["Packing method", sheet.packing_method],
            ]} />
            {sheet.materials.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Material</th><th className="th text-right">Share</th><th className="th text-right">Weight</th><th className="th text-right">Recycled</th></tr></thead>
                <tbody>{sheet.materials.map((m, i) => (
                  <tr key={i}><td className="td">{m.substrate_name ?? m.material_name}</td><td className="td text-right tabular-nums">{fmtNum(m.share_pct, "%")}</td>
                    <td className="td text-right tabular-nums">{fmtNum(m.weight_g, "g")}</td><td className="td text-right tabular-nums">{fmtNum(m.recycled_pct, "%")}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
          <section className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted">Packaging</h4>
            {LEVELS.map((lv) => {
              const p = packOf(sheet, lv.key);
              return (
                <div key={lv.key} className="rounded-lg border border-line p-3">
                  <p className="text-sm font-semibold">{lv.label}</p>
                  {!p ? <p className="text-xs text-muted">Not declared.</p> : p.not_used ? <p className="text-xs text-muted">Not used{p.description ? `: ${p.description}` : ""}.</p> : (
                    <>
                      <p className="mt-1 text-xs text-muted">{[p.description, fmtDims(p.length_mm, p.width_mm, p.height_mm) !== "–" ? fmtDims(p.length_mm, p.width_mm, p.height_mm) : null,
                        p.units_per_pack ? `${p.units_per_pack} ${lv.key === "secondary" ? "units per carton" : "per pack"}` : null, p.packs_per_carton ? `${p.packs_per_carton} packs per carton` : null,
                        p.cartons_per_layer ? `${p.cartons_per_layer} cartons per layer` : null, p.layers ? `${p.layers} layers` : null, p.cartons_per_pallet ? `${p.cartons_per_pallet} cartons per pallet` : null,
                        p.pallet_type, p.max_stack ? `stack max ${p.max_stack}` : null, p.gross_weight_kg != null ? `${p.gross_weight_kg} kg gross` : null,
                        p.labelling ? `marking: ${p.labelling}` : null, p.protective_fill ? `fill: ${p.protective_fill}` : null].filter(Boolean).join(" · ")}</p>
                      {p.materials.length > 0 && (
                        <ul className="mt-1 text-xs">{p.materials.map((m, i) => (
                          <li key={i}>{m.material_name}{m.component ? ` (${m.component})` : ""}: {fmtNum(m.weight_g, "g")}, {fmtNum(m.recycled_pct, "%")} recycled, {m.reusable == null ? "reuse not stated" : m.reusable ? "reusable" : "single use"}</li>
                        ))}</ul>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </section>
          <section>
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">History</h4>
            <ol className="space-y-1 text-xs">
              {sheet.history.map((h, i) => (
                <li key={i} className="flex flex-wrap gap-x-2"><span className="text-muted">{d(h.at)}</span><span className="font-semibold">{EVENT_LABEL[h.event] ?? h.event}</span>
                  {h.version ? <span className="text-muted">v{h.version}</span> : null}<span className="text-muted">{h.by_vendor ? "by the vendor" : h.actor ? `by ${h.actor}` : ""}</span>
                  {typeof h.detail?.reason === "string" && <span>· {h.detail.reason}</span>}
                  {typeof h.detail?.prefilled_from === "string" && <span>· pre-filled from verified sheet {h.detail.prefilled_from}</span>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
