import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getComponents, getEmissionLibraries, getEvents, getPeople, getSpec, getVersions, rows } from "@/lib/sourcing-data";
import { COMPONENT_TYPES, money, ROUTES, SPEC_TYPES, specType } from "@/lib/sourcing";
import { computeSpecCo2e, deriveComponentWeight } from "@/lib/sourcing-emissions";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Facts, RoutePill, Td, Th, fmtDateTime } from "@/components/sourcing/bits";
import { SubstrateSelect } from "@/components/sourcing/spec-fields";
import { addComponent, addVersion, deleteComponent, deleteVersion, overrideTriage, recomputeSpec, runTriage, updateSpec } from "../../actions";

export const metadata: Metadata = { title: "Spec" };

export default async function SpecPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const spec = await getSpec(supabase, id);
  if (!spec) notFound();
  const [versions, components, libs, events, people, lines] = await Promise.all([
    getVersions(supabase, id), getComponents(supabase, id), getEmissionLibraries(supabase), getEvents(supabase, { entity_id: id }), getPeople(supabase),
    rows<{ rfq_id: string }>(supabase, "rfq_lines", { eq: { spec_id: id } }),
  ]);
  const live = computeSpecCo2e({ spec, versions, components, substratesById: libs.substrates, factorsByCode: libs.factors, singleSubstrate: spec.substrate_id ? libs.substrates[spec.substrate_id] : null });
  const locked = lines.length > 0;
  const job = { id: spec.job_id, number: spec.job_number };

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing+", href: "/sourcing" }, { label: job.number, href: `/sourcing/jobs/${job.id}?tab=specs` }, { label: `Spec ${spec.spec_no}` }]}
        title={spec.title} sub={`${specType(spec.spec_type)} · ${spec.total_quantity.toLocaleString("en-GB")} units · ${spec.market} (${spec.region})`}>
        {spec.is_draft && <Pill tone="warn">Draft</Pill>}
        <RoutePill route={spec.route} confidence={spec.confidence} />
      </PageHead>
      {locked && <Card className="border-warn/40 bg-warn-soft px-5 py-3 text-sm text-warn">This spec is on an RFQ. Once the RFQ is sent the spec is locked, so every supplier quotes on the same thing.</Card>}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Item details">
            <div className="p-5">
              <ActionForm action={updateSpec} hidden={{ id }} submit="Save spec">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Title" htmlFor="title" className="sm:col-span-2"><input id="title" name="title" defaultValue={spec.title} required className="input" /></Field>
                  <Field label="Spec type" htmlFor="spec_type">
                    <select id="spec_type" name="spec_type" defaultValue={spec.spec_type} className="input">{SPEC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                  </Field>
                  <Field label="Priced by" htmlFor="calculation_method">
                    <select id="calculation_method" name="calculation_method" defaultValue={spec.calculation_method} className="input"><option value="quantity">Quantity</option><option value="square_measurement">Square measurement</option></select>
                  </Field>
                  <SubstrateSelect substrates={libs.substrateList} value={spec.substrate_id} label="Main substrate (single-material specs)" />
                  <Field label="Size unit" htmlFor="size_unit">
                    <select id="size_unit" name="size_unit" defaultValue={spec.size_unit ?? "mm"} className="input"><option>mm</option><option>cm</option><option>in</option></select>
                  </Field>
                  <Field label="HS code" htmlFor="hs_code" hint="Suggested from the dominant material; check it"><input id="hs_code" name="hs_code" defaultValue={spec.hs_code ?? ""} className="input" /></Field>
                  <Field label="Pages (paper items)" htmlFor="total_pages"><input id="total_pages" name="total_pages" inputMode="numeric" defaultValue={String(spec.spec_data?.total_pages ?? "")} className="input" /></Field>
                  <Field label="Supplier-confirmed unit weight (g)" htmlFor="supplier_confirmed_unit_weight_grams" hint="Promo, merch and custom items">
                    <input id="supplier_confirmed_unit_weight_grams" name="supplier_confirmed_unit_weight_grams" inputMode="decimal" defaultValue={String(spec.spec_data?.supplier_confirmed_unit_weight_grams ?? "")} className="input" />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="is_draft" defaultChecked={spec.is_draft} /> Still a draft (can&apos;t go to triage or RFQ)</label>
                  <Field label="Description" htmlFor="description" className="sm:col-span-2"><textarea id="description" name="description" rows={3} defaultValue={spec.description ?? ""} className="input" /></Field>
                </div>
              </ActionForm>
            </div>
          </Panel>

          <Panel title="Versions" sub="Quantities and sizes. The first version's size is used for rate-card matching.">
            <table className="w-full text-sm">
              <thead><tr><Th>Version</Th><Th>Quantity</Th><Th>Size</Th><Th>Item code</Th><Th /></tr></thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <Td>{v.name}</Td><Td className="tabular-nums">{v.quantity.toLocaleString("en-GB")}</Td>
                    <Td>{v.finished_length && v.finished_width ? `${v.finished_length} × ${v.finished_width} ${spec.size_unit ?? ""}` : "—"}</Td><Td>{v.item_code ?? "—"}</Td>
                    <Td className="text-right">{!locked && <ActionForm action={deleteVersion} hidden={{ id: v.id, spec_id: id }} submit="Remove" variant="danger" inline confirm="Remove this version?" />}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!locked && (
              <div className="border-t border-line p-5">
                <ActionForm action={addVersion} hidden={{ spec_id: id, sort: versions.length }} submit="Add version" variant="secondary">
                  <div className="grid gap-3 sm:grid-cols-5">
                    <Field label="Name" htmlFor="v_name"><input id="v_name" name="name" className="input" placeholder="e.g. Sensitive" /></Field>
                    <Field label="Quantity" htmlFor="v_qty"><input id="v_qty" name="quantity" required inputMode="numeric" className="input" /></Field>
                    <Field label="Length" htmlFor="v_len"><input id="v_len" name="finished_length" inputMode="decimal" className="input" /></Field>
                    <Field label="Width" htmlFor="v_wid"><input id="v_wid" name="finished_width" inputMode="decimal" className="input" /></Field>
                    <Field label="Item code" htmlFor="v_code"><input id="v_code" name="item_code" className="input" /></Field>
                  </div>
                </ActionForm>
              </div>
            )}
          </Panel>

          <Panel title="Bill of materials" sub="One row per material. Weights come from the substrate library: grammage × area, or area × thickness × density.">
            {components.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Single-material spec: weight comes from the main substrate and the first version&apos;s size. Add components for multi-material items.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><Th>Component</Th><Th>Substrate</Th><Th>Per unit</Th><Th>Area (cm)</Th><Th>Weight</Th><Th /></tr></thead>
                  <tbody>
                    {components.map((c) => {
                      const sub = c.substrate_id ? libs.substrates[c.substrate_id] : null;
                      const w = deriveComponentWeight(c, sub);
                      return (
                        <tr key={c.id}>
                          <Td><span className="font-semibold">{c.component_name}</span> <span className="text-xs capitalize text-muted">{c.component_type}</span>{c.is_packaging && <Pill>Packaging</Pill>}</Td>
                          <Td>{sub?.name ?? "—"}</Td><Td className="tabular-nums">{c.quantity_per_unit}</Td>
                          <Td>{c.direct_weight_grams ? `${c.direct_weight_grams} g direct` : c.area_length_cm && c.area_width_cm ? `${c.area_length_cm} × ${c.area_width_cm}` : "—"}</Td>
                          <Td className="tabular-nums">{w.grams != null ? `${w.grams.toLocaleString("en-GB")} g` : <span className="text-warn">Missing {w.missing.join(", ")}</span>}</Td>
                          <Td className="text-right">{!locked && <ActionForm action={deleteComponent} hidden={{ id: c.id, spec_id: id }} submit="Remove" variant="danger" inline confirm="Remove this component?" />}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!locked && (
              <div className="border-t border-line p-5">
                <ActionForm action={addComponent} hidden={{ spec_id: id }} submit="Add component" variant="secondary">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Component" htmlFor="c_name"><input id="c_name" name="component_name" required className="input" placeholder="e.g. Header card" /></Field>
                    <Field label="Type" htmlFor="c_type"><select id="c_type" name="component_type" className="input">{COMPONENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
                    <SubstrateSelect name="substrate_id" substrates={libs.substrateList} label="Substrate" />
                    <Field label="Per finished unit" htmlFor="c_qty"><input id="c_qty" name="quantity_per_unit" defaultValue="1" inputMode="decimal" className="input" /></Field>
                    <Field label="Length (cm)" htmlFor="c_len"><input id="c_len" name="area_length_cm" inputMode="decimal" className="input" /></Field>
                    <Field label="Width (cm)" htmlFor="c_wid"><input id="c_wid" name="area_width_cm" inputMode="decimal" className="input" /></Field>
                    <Field label="Or direct weight (g)" htmlFor="c_dw"><input id="c_dw" name="direct_weight_grams" inputMode="decimal" className="input" /></Field>
                    <Field label="Thickness override (mm)" htmlFor="c_th"><input id="c_th" name="thickness_mm_override" inputMode="decimal" className="input" /></Field>
                  </div>
                </ActionForm>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Triage" sub="Adopt / Adapt / Create / Push, before any RFQ">
            <div className="space-y-3 p-5 text-sm">
              {spec.route ? (
                <>
                  <p><RoutePill route={spec.route} confidence={spec.confidence} /></p>
                  <p>{spec.triage_reason}</p>
                  <Facts items={[
                    ["Applied price", spec.route !== "create" ? money(spec.triage_unit_price, "EUR", 2) : "From the RFQ"],
                    ["Rate card", spec.rate_card_name], ["Supplier", spec.triage_supplier_name], ["Decided", fmtDateTime(spec.triage_at)],
                    ["Basis", spec.triage_source === "override" ? "Override" : spec.triage_source === "supplier" ? "Supplier response" : "Rules v1"],
                    ...(spec.route === "push" ? [["Supplier response", spec.push_status ?? "pending"] as [string, string]] : []),
                  ]} />
                </>
              ) : <p className="text-muted">Not triaged yet.</p>}
              {!spec.is_draft && spec.push_status !== "accepted" && <ActionForm action={runTriage} hidden={{ id }} submit={spec.route ? "Re-run triage" : "Run triage"} variant="primary" />}
              {spec.route && spec.push_status !== "accepted" && (
                <details className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer font-semibold">Override the route</summary>
                  <div className="mt-3">
                    <ActionForm action={overrideTriage} hidden={{ id }} submit="Override" variant="secondary">
                      <Field label="Route" htmlFor="route"><select id="route" name="route" className="input">{ROUTES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
                      <Field label="Reason" htmlFor="reason" hint="Anyone can send a line to an RFQ; routing away from an RFQ needs a sourcing lead."><input id="reason" name="reason" required className="input" /></Field>
                    </ActionForm>
                  </div>
                </details>
              )}
            </div>
          </Panel>

          <Panel title="Material CO2e estimate" sub="Raw-material production only. Not a product carbon footprint.">
            <div className="space-y-3 p-5 text-sm">
              {live.excluded ? <p className="text-muted">Design work has no physical goods, so no material emissions.</p> : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="eyebrow">Per unit</p><p className="font-display text-xl font-bold">{live.perUnitKg != null ? `${live.perUnitKg.toLocaleString("en-GB", { maximumFractionDigits: 3 })} kg` : "—"}</p></div>
                    <div><p className="eyebrow">All {live.quantity.toLocaleString("en-GB")} units</p><p className="font-display text-xl font-bold">{live.totalKg != null ? `${live.totalKg.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg` : "—"}</p></div>
                  </div>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {live.lines.map((l, i) => (
                      <li key={i} className="px-3 py-2">
                        <div className="flex justify-between gap-2"><span className="font-semibold">{l.label}{l.packaging ? " (packaging)" : ""}</span><span className="tabular-nums">{l.kgco2e != null ? `${l.kgco2e.toFixed(3)} kg` : "—"}</span></div>
                        <div className="text-xs text-muted">{l.grams != null ? `${l.grams} g` : "weight unknown"} × {l.factor != null ? `${l.factor.toFixed(3)} kgCO2e/kg` : "no factor"}{l.formula ? ` (${l.formula})` : ""}</div>
                        {l.missing.length > 0 && <div className="text-xs text-warn">Missing: {l.missing.join(", ")}</div>}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted">Unit weight {live.unitWeightGrams != null ? `${live.unitWeightGrams} g` : "unknown"}{live.packagingGrams ? `, packaging ${live.packagingGrams} g` : ""}. Factors come from the Watchtower material emission factor library; recycled content blends virgin and recycled factors.</p>
                  <ActionForm action={recomputeSpec} hidden={{ id }} submit="Save these figures to the spec" variant="secondary" />
                </>
              )}
            </div>
          </Panel>

          <Panel title="History"><ActivityList events={events} people={people} /></Panel>
          <p className="text-xs text-muted"><Link className="hover:underline" href={`/sourcing/jobs/${job.id}?tab=specs`}>Back to the job</Link></p>
        </div>
      </div>
    </>
  );
}
