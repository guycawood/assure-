import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getComponents, getEmissionLibraries, getEvents, getLibrary, getPeople, getSpec, getVersions, rows } from "@/lib/sourcing-data";
import { COMPONENT_TYPES, money, ROUTES, SPEC_TYPES, specType } from "@/lib/sourcing";
import { computeSpecCo2e, deriveComponentWeight } from "@/lib/sourcing-emissions";
import { rfqBlockers, specForm, testingLabel, type SpecHub, type SpecRevision } from "@/lib/sourcing-hub";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { ActivityList, Facts, RoutePill, Td, Th, fmtDateTime } from "@/components/sourcing/bits";
import { ApprovalRequests } from "@/components/approvals/requests";
import { SubstrateSelect } from "@/components/sourcing/spec-fields";
import { SpecHubFields } from "@/components/sourcing/spec-hub-fields";
import { addComponent, addVersion, deleteComponent, deleteVersion, overrideTriage, recomputeSpec, reviseSpec, runTriage, updateSpec, updateSpecDetails } from "../../actions";
import { getSheetDetails, getSheetRows } from "@/lib/tech-sheet-data";
import { SpecTechSheets } from "@/components/tech-sheet/internal-panel";
import { DuplicateDialog } from "@/components/repeat/duplicate-dialog";
import { MSymbol } from "@/components/symbol";
import { duplicateSpec } from "../../actions";

type RepeatContext = {
  original: { spec_id: string; spec_no: number; title: string; job_number: string };
  generations: number;
  last_purchase: { supplier_name: string | null; unit_cost: number; quantity: number; currency: string; po_number: string | null; approved_at: string | null } | null;
  verified_sheet: { sheet_ref: string; supplier_name: string } | null;
};

export const metadata: Metadata = { title: "Spec" };

/** Spec | Technical & packaging tabs. */
function SpecTabs({ id, tab, count }: { id: string; tab: string; count: number }) {
  const t = (key: string, label: string) => (
    <Link href={`/sourcing/specs/${id}${key === "spec" ? "" : `?tab=${key}`}`}
      className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>{label}</Link>
  );
  return <nav className="flex gap-1 border-b border-line">{t("spec", "Spec")}{t("tech", `Technical & packaging${count ? ` (${count})` : ""}`)}</nav>;
}

export default async function SpecPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const tab = (await searchParams).tab === "tech" ? "tech" : "spec";
  const supabase = await createClient();
  const spec = (await getSpec(supabase, id)) as SpecHub | null;
  if (!spec) notFound();
  const sheetRows = await getSheetRows(supabase, { spec_id: id });
  if (tab === "tech") {
    // Suppliers on this spec: invited to quote on it, or on an estimate / PO for it.
    const lineRows = await rows<{ rfq_id: string }>(supabase, "rfq_lines", { eq: { spec_id: id } });
    const [{ data: inv }, { data: estLines }, { data: lib }] = await Promise.all([
      lineRows.length ? supabase.from("v_rfq_invitations").select("supplier_id, supplier_name").in("rfq_id", lineRows.map((l) => l.rfq_id)) : Promise.resolve({ data: [] }),
      supabase.from("estimate_lines").select("estimate_id").eq("spec_id", id),
      supabase.from("spec_tech_library").select("sheet_id, spec_id").eq("title_key", spec.title.trim().toLowerCase()).neq("spec_id", id).limit(10),
    ]);
    const estIds = ((estLines ?? []) as { estimate_id: string }[]).map((e) => e.estimate_id);
    const { data: ests } = estIds.length ? await supabase.from("v_estimates").select("supplier_id, supplier_name").in("id", estIds) : { data: [] };
    const sup = new Map<string, string>();
    for (const r of [...((inv ?? []) as { supplier_id: string; supplier_name: string }[]), ...((ests ?? []) as { supplier_id: string; supplier_name: string }[])]) sup.set(r.supplier_id, r.supplier_name);
    const libIds = ((lib ?? []) as { sheet_id: string }[]).map((l) => l.sheet_id);
    const elsewhere = libIds.length ? (await supabase.from("v_tech_sheets").select("sheet_ref, supplier_name, spec_title").in("id", libIds)).data ?? [] : [];
    const details = await getSheetDetails(supabase, sheetRows.map((r) => r.id));
    return (
      <>
        <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: spec.job_number, href: `/sourcing/jobs/${spec.job_id}?tab=specs` }, { label: `Spec ${spec.spec_no}` }]}
          title={spec.title} sub={`${specType(spec.spec_type)} · ${spec.total_quantity.toLocaleString("en-GB")} units · ${spec.market} (${spec.region})`}>
          <Pill tone="info">Revision {spec.revision ?? 1}</Pill>
        </PageHead>
        <SpecTabs id={id} tab={tab} count={sheetRows.length} />
        <Panel title="Technical & packaging data sheets" sub="Declared by each vendor in stages (quote, PO acceptance, pre-shipment), checked against a packed carton at the QA/QC pre-shipment check, and reused from the library of verified sheets.">
          <div className="p-5">
            <SpecTechSheets specId={id} sheets={details} suppliers={[...sup.entries()].map(([sid, name]) => ({ id: sid, name }))}
              verifiedElsewhere={elsewhere as { sheet_ref: string; supplier_name: string; spec_title: string }[]} />
          </div>
        </Panel>
      </>
    );
  }
  const [versions, components, libs, events, people, lines, brandingMethods, aqlLevels, revisions] = await Promise.all([
    getVersions(supabase, id), getComponents(supabase, id), getEmissionLibraries(supabase), getEvents(supabase, { entity_id: id }), getPeople(supabase),
    rows<{ rfq_id: string; spec_revision: number | null }>(supabase, "rfq_lines", { eq: { spec_id: id } }),
    getLibrary(supabase, "branding_methods", false), getLibrary(supabase, "aql_levels", false),
    rows<SpecRevision>(supabase, "spec_revisions", { eq: { spec_id: id }, order: [["revision", false]] }),
  ]);
  // Repeat orders: open jobs for the same client to duplicate onto, and what was bought last time if this is a repeat.
  const { data: jobRow } = await supabase.from("jobs").select("client_id").eq("id", spec.job_id).maybeSingle();
  const [{ data: openJobs }, { data: repeatCtx }] = await Promise.all([
    supabase.from("jobs").select("id, job_number, title, status").eq("client_id", (jobRow as { client_id: string } | null)?.client_id ?? "").order("job_number", { ascending: false }).limit(50),
    supabase.rpc("spec_repeat_context", { p_spec: id }),
  ]);
  const jobsForRepeat = ((openJobs ?? []) as { id: string; job_number: string; title: string; status: string }[]).filter((j) => !["closed", "cancelled"].includes(j.status));
  const repeat = repeatCtx as RepeatContext | null;
  const live = computeSpecCo2e({ spec, versions, components, substratesById: libs.substrates, factorsByCode: libs.factors, singleSubstrate: spec.substrate_id ? libs.substrates[spec.substrate_id] : null });
  // On a sent or awarded RFQ the spec can't be edited directly: changes go through a new revision.
  const locked = !!spec.on_live_rfq;
  const onDraftRfq = lines.length > 0 && !locked;
  const blockers = rfqBlockers(spec);
  const hubLibs = { brandingMethods, aqlLevels };
  const job = { id: spec.job_id, number: spec.job_number };

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: job.number, href: `/sourcing/jobs/${job.id}?tab=specs` }, { label: `Spec ${spec.spec_no}` }]}
        title={spec.title} sub={`${specType(spec.spec_type)} · ${specForm(spec.spec_form).label} · ${spec.total_quantity.toLocaleString("en-GB")} units · ${spec.market} (${spec.region})`}>
        {spec.is_draft && <Pill tone="warn">Draft</Pill>}
        <Pill tone="info">Revision {spec.revision ?? 1}</Pill>
        <RoutePill route={spec.route} confidence={spec.confidence} />
        <DuplicateDialog label="Duplicate for repeat order" title={`Duplicate spec ${spec.spec_no}: ${spec.title}`} submit="Create the repeat spec" action={duplicateSpec} hidden={{ id }}
          sub="Copies every product field, the versions and the bill of materials as a draft, linked to this spec. The RFQ, quotes, triage, estimates and POs are not copied.">
          <Field label="Put it on job" htmlFor="dup-job">
            <select id="dup-job" name="job_id" className="input" defaultValue={spec.job_id}>
              {jobsForRepeat.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.title}{j.id === spec.job_id ? " (this job)" : ""}</option>)}
            </select>
          </Field>
          <Field label="New quantity (optional)" htmlFor="dup-qty" hint="Applies when the spec has one version; otherwise edit the versions after copying.">
            <input id="dup-qty" name="quantity" type="number" min={1} step={1} className="input" placeholder={String(spec.total_quantity)} />
          </Field>
        </DuplicateDialog>
      </PageHead>
      <SpecTabs id={id} tab={tab} count={sheetRows.length} />
      {repeat && (
        <Card className="flex flex-wrap items-start gap-x-6 gap-y-2 border-accent/30 px-5 py-3 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold"><MSymbol name="repeat" size={18} className="text-accent" /> Repeat order</span>
          <span>Repeat of <Link className="font-semibold text-accent hover:underline" href={`/sourcing/specs/${repeat.original.spec_id}`}>{repeat.original.job_number} · spec {repeat.original.spec_no}</Link>{repeat.generations > 1 ? ` (${repeat.generations} repeats back)` : ""}</span>
          {repeat.last_purchase ? (
            <span>Last bought from <b>{repeat.last_purchase.supplier_name ?? "—"}</b> at <b>{money(Number(repeat.last_purchase.unit_cost), repeat.last_purchase.currency)}</b> per unit × {Number(repeat.last_purchase.quantity).toLocaleString("en-GB")}
              {repeat.last_purchase.po_number ? ` on ${repeat.last_purchase.po_number}` : ""}{repeat.last_purchase.approved_at ? ` (${new Date(repeat.last_purchase.approved_at).toLocaleDateString("en-GB")})` : ""}</span>
          ) : <span className="text-muted">No approved purchase on the original yet.</span>}
          {repeat.verified_sheet && <span>Verified packaging data: <b>{repeat.verified_sheet.sheet_ref}</b> ({repeat.verified_sheet.supplier_name})</span>}
        </Card>
      )}
      <ApprovalRequests entityIds={id} types={["TRIAGE_OVERRIDE"]} meId={me.id} title="Route change waiting for a sourcing lead" />
      {locked && <Card className="border-warn/40 bg-warn-soft px-5 py-3 text-sm text-warn">This spec is on a sent RFQ, so suppliers are quoting on it. To change it, use <b>Revise spec</b> below: a new revision is saved with your note, the RFQ is flagged &quot;spec changed&quot; and the invited suppliers are asked to re-quote. The revision they quoted on stays on record.</Card>}
      {onDraftRfq && <Card className="px-5 py-3 text-sm text-muted">This spec is on a draft RFQ. Edit it freely until the RFQ is sent.</Card>}
      {blockers.length > 0 && <Card className="border-bad/30 bg-bad-soft px-5 py-3 text-sm text-bad">Before this spec can go out on an RFQ, add: {blockers.join(", ")}.</Card>}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {locked ? (
            <Panel title="Revise spec" sub="Saves a new revision. Only what you change is recorded. On an awarded RFQ only Stocktool article data (HS code, origin, units, weights, cartons) can change.">
              <div className="p-5">
                <ActionForm action={reviseSpec} hidden={{ id }} submit="Save new revision and ask suppliers to re-quote" confirm="Save a new revision? Invited suppliers on open RFQs are asked to re-quote.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Title" htmlFor="r_title" className="sm:col-span-2"><input id="r_title" name="title" defaultValue={spec.title} required className="input" /></Field>
                    <Field label="HS code" htmlFor="r_hs"><input id="r_hs" name="hs_code" defaultValue={spec.hs_code ?? ""} className="input" /></Field>
                    <Field label="Description" htmlFor="r_desc" className="sm:col-span-2"><textarea id="r_desc" name="description" rows={2} defaultValue={spec.description ?? ""} className="input" /></Field>
                  </div>
                  {versions.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      {versions.map((v) => (
                        <Field key={v.id} label={`${v.name}: quantity`} htmlFor={`vqty_${v.id}`}><input id={`vqty_${v.id}`} name={`vqty_${v.id}`} inputMode="numeric" defaultValue={v.quantity} className="input" /></Field>
                      ))}
                    </div>
                  )}
                  <SpecHubFields spec={spec} libs={hubLibs} idPrefix="rev" />
                  <Field label="What changed (sent to the suppliers)" htmlFor="change_note"><input id="change_note" name="change_note" required className="input" placeholder="e.g. Corner radius increased to 10 mm" /></Field>
                </ActionForm>
              </div>
            </Panel>
          ) : null}
          {!locked && (<>
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

          <Panel title="Spec form and product details" sub="Structured fields from the Sourcing Hub spec forms: Promo & Merch detail, testing, packing, sustainability and Stocktool article data.">
            <div className="p-5">
              <ActionForm action={updateSpecDetails} hidden={{ id }} submit="Save details">
                <SpecHubFields spec={spec} libs={hubLibs} idPrefix="d" />
              </ActionForm>
            </div>
          </Panel>
          </>)}

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
                      <Field label="Reason" htmlFor="reason" hint="Anyone can send a line to an RFQ. Routing away from an RFQ is applied by a sourcing lead; where the approval policy says so, a second lead approves it first."><input id="reason" name="reason" required className="input" /></Field>
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

          <Panel title="At a glance">
            <Facts items={[
              ["Spec form", specForm(spec.spec_form).label], ["Category", [spec.product_category, spec.product_sub_type].filter(Boolean).join(" · ") || null],
              ["Branding", spec.branding_method_name], ["AQL", spec.aql_level_name],
              ["Testing", (spec.testing_checklist ?? []).length ? (spec.testing_checklist ?? []).map(testingLabel).join(", ") : null],
              ["HS code", spec.hs_code], ["Origin", spec.origin_country], ["MOQ / SU", spec.moq || spec.selling_unit_qty ? `${spec.moq ?? "—"} / ${spec.selling_unit_qty ?? "—"} ${spec.unit_of_measure ?? ""}` : null],
              ["Weights (net / gross)", spec.net_weight_kg != null || spec.gross_weight_kg != null ? `${spec.net_weight_kg ?? "—"} / ${spec.gross_weight_kg ?? "—"} kg` : null],
              ["Reusable", spec.reusable == null ? null : spec.reusable ? `Yes${spec.number_of_uses ? `, ${spec.number_of_uses} uses` : ""}` : "No"],
              ["Recycled content", spec.recycled_content_percent != null ? `${spec.recycled_content_percent}%` : null],
              ["Lighting / electronics", spec.has_lighting_electronics ? spec.lighting_electronics_detail ?? "Yes" : "No"],
            ]} />
          </Panel>

          <Panel title="Revisions" sub="A revision is kept each time the spec goes out on an RFQ or is revised afterwards.">
            {revisions.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Revision 1. Nothing sent yet.</p> : (
              <ol className="divide-y divide-line text-sm">
                {revisions.map((r) => (
                  <li key={r.id} className="px-5 py-2.5">
                    <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">Revision {r.revision}</span><span className="text-xs text-muted">{fmtDateTime(r.created_at)}</span></div>
                    {r.change_note && <p className="text-xs">{r.change_note}</p>}
                    {lines.some((l) => l.spec_revision === r.revision) && <p className="text-xs text-muted">Quoted on by suppliers</p>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="History"><ActivityList events={events} people={people} /></Panel>
          <p className="text-xs text-muted"><Link className="hover:underline" href={`/sourcing/jobs/${job.id}?tab=specs`}>Back to the job</Link></p>
        </div>
      </div>
    </>
  );
}
