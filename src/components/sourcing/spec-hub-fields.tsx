import type { LibraryRecord } from "@/lib/sourcing";
import { SPEC_FORMS, TESTING_CHECKS, type SpecHub } from "@/lib/sourcing-hub";
import { Field } from "./action-form";

type Libs = { brandingMethods: LibraryRecord[]; aqlLevels: LibraryRecord[] };
const str = (v: unknown) => (v == null ? "" : String(v));
const tri = (v: boolean | null | undefined) => (v == null ? "" : v ? "yes" : "no");

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-4">
      <legend className="px-1 text-sm font-bold">{title}</legend>
      {hint && <p className="-mt-1 text-xs text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

function LibSelect({ id, name, label, records, value, hint }: { id: string; name: string; label: string; records: LibraryRecord[]; value: string | null | undefined; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <select id={id} name={name} defaultValue={value ?? ""} className="input">
        <option value="">Not set</option>
        {records.filter((r) => r.status === "active" || r.id === value).map((r) => <option key={r.id} value={r.id}>{r.name}{r.code ? ` (${r.code})` : ""}</option>)}
      </select>
    </Field>
  );
}

function YesNo({ id, name, label, value }: { id: string; name: string; label: string; value: boolean | null | undefined }) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} name={name} defaultValue={tri(value)} className="input"><option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option></select>
    </Field>
  );
}

/**
 * Structured spec fields (Sourcing Hub): spec form, Promo & Merch product detail, testing and inspection, lighting,
 * packing, design and market, sustainability and the Stocktool article data. Field names match job_specs columns.
 */
export function SpecHubFields({ spec, libs, idPrefix = "h" }: { spec: Partial<SpecHub>; libs: Libs; idPrefix?: string }) {
  const id = (k: string) => `${idPrefix}_${k}`;
  const checks = new Set(spec.testing_checklist ?? []);
  const text = (k: keyof SpecHub, label: string, opts: { hint?: string; placeholder?: string; className?: string } = {}) => (
    <Field label={label} htmlFor={id(k)} hint={opts.hint} className={opts.className}>
      <input id={id(k)} name={k} defaultValue={str(spec[k])} placeholder={opts.placeholder} className="input" />
    </Field>
  );
  const num = (k: keyof SpecHub, label: string, hint?: string) => (
    <Field label={label} htmlFor={id(k)} hint={hint}><input id={id(k)} name={k} inputMode="decimal" defaultValue={str(spec[k])} className="input" /></Field>
  );
  return (
    <div className="space-y-4">
      <Section title="Spec form" hint="How firm the spec is. Ideation briefs go to suppliers as a loose brief and they send back a proposed spec with their price.">
        <div className="grid gap-2 sm:grid-cols-3">
          {SPEC_FORMS.map((f) => (
            <label key={f.value} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input type="radio" name="spec_form" value={f.value} defaultChecked={(spec.spec_form ?? "fixed") === f.value} className="mt-1" />
              <span><span className="font-semibold">{f.label}</span><span className="block text-xs text-muted">{f.hint}</span></span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Product">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {text("product_category", "Product category", { placeholder: "e.g. Bags, Drinkware, Bar accessories" })}
          {text("product_sub_type", "Sub-product type", { placeholder: "e.g. Tote, Mug, Bar runner" })}
          {text("size_description", "Size", { placeholder: "e.g. 380 x 420 mm, 70 cm handles" })}
          {text("material", "Material", { placeholder: "e.g. Cotton 180gsm" })}
          {num("substrate_weight_gsm", "Substrate weight (gsm)")}
          <LibSelect id={id("branding_method_id")} name="branding_method_id" label="Printing / branding method" records={libs.brandingMethods} value={spec.branding_method_id} hint="Watchtower library" />
          {text("finished_style", "Finished product style", { placeholder: "e.g. Flat, gusseted, lidded box" })}
          {text("life_expectancy", "Life expectancy", { placeholder: "e.g. 12 months of daily use" })}
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="has_components" defaultChecked={!!spec.has_components} /> Made of several components (list them in the bill of materials)</label>
        </div>
      </Section>

      <Section title="Testing and inspection">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {TESTING_CHECKS.map((c) => (
            <label key={c.value} className="flex items-center gap-2"><input type="checkbox" name="testing_checklist" value={c.value} defaultChecked={checks.has(c.value)} /> {c.label}</label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LibSelect id={id("aql_level_id")} name="aql_level_id" label="AQL level" records={libs.aqlLevels} value={spec.aql_level_id} hint="Watchtower library" />
        </div>
      </Section>

      <Section title="Lighting and electronics">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="has_lighting_electronics" defaultChecked={!!spec.has_lighting_electronics} /> Has lighting or electronics</label>
          {text("lighting_electronics_detail", "Detail", { placeholder: "e.g. LED strip 24 V, CE-marked driver, EU plug", className: "sm:col-span-2" })}
        </div>
      </Section>

      <Section title="Packing specification">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {num("units_per_inner", "Units per inner")}
          {num("units_per_outer", "Units per outer carton")}
          {num("carton_length_cm", "Carton length (cm)")}
          {num("carton_width_cm", "Carton width (cm)")}
          {num("carton_height_cm", "Carton height (cm)")}
          {text("packing_method", "Packing method", { placeholder: "e.g. Polybag, 10 per inner" })}
        </div>
      </Section>

      <Section title="Design and market">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Design guidelines" htmlFor={id("design_guidelines")} className="sm:col-span-2"><textarea id={id("design_guidelines")} name="design_guidelines" rows={2} defaultValue={str(spec.design_guidelines)} className="input" /></Field>
          {text("end_market", "End market", { placeholder: "e.g. Germany" })}
        </div>
      </Section>

      <Section title="Sustainability" hint="Article data for the sustainability report.">
        <div className="grid gap-3 sm:grid-cols-4">
          <YesNo id={id("reusable")} name="reusable" label="Reusable" value={spec.reusable} />
          {num("number_of_uses", "Number of uses")}
          <YesNo id={id("designed_for_disassembly")} name="designed_for_disassembly" label="Designed for disassembly" value={spec.designed_for_disassembly} />
          {num("recycled_content_percent", "Recycled content (%)")}
        </div>
      </Section>

      <Section title="Stocktool article data" hint="Needed for the Stocktool hand-off. HS code is mandatory for promo and merch before the RFQ goes out.">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {text("origin_country", "Country of origin")}
          {text("unit_of_measure", "Unit of measure", { placeholder: "EA" })}
          {num("selling_unit_qty", "Selling unit (SU) qty")}
          {num("moq", "MOQ")}
          {num("net_weight_kg", "Net weight (kg)")}
          {num("gross_weight_kg", "Gross weight (kg)")}
        </div>
      </Section>
    </div>
  );
}
