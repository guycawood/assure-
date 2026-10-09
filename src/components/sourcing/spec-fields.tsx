import { SPEC_TYPES } from "@/lib/sourcing";
import { SPEC_FORMS } from "@/lib/sourcing-hub";
import type { Substrate } from "@/lib/sourcing-emissions";
import { Field } from "./action-form";

export function SubstrateSelect({ name = "substrate_id", substrates, value, label = "Substrate (Watchtower library)" }: { name?: string; substrates: (Substrate & { status?: string })[]; value?: string | null; label?: string }) {
  return (
    <Field label={label} htmlFor={name}>
      <select id={name} name={name} defaultValue={value ?? ""} className="input">
        <option value="">None / multi-material (use components)</option>
        {substrates.filter((s) => s.status === "active" || s.id === value).map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>
        ))}
      </select>
    </Field>
  );
}

/** Fields for a new spec: type, title, first version (quantity and size). */
export function NewSpecFields({ substrates }: { substrates: (Substrate & { status?: string })[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Spec title" htmlFor="title" className="sm:col-span-2"><input id="title" name="title" required className="input" placeholder="e.g. A2 header card" /></Field>
      <Field label="Spec type" htmlFor="spec_type">
        <select id="spec_type" name="spec_type" required className="input" defaultValue="2d">
          {SPEC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <SubstrateSelect substrates={substrates} />
      <Field label="Spec form" htmlFor="spec_form" hint="Ideation = a loose brief; suppliers propose the spec">
        <select id="spec_form" name="spec_form" defaultValue="fixed" className="input">
          {SPEC_FORMS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </Field>
      <Field label="First version name" htmlFor="version_name"><input id="version_name" name="version_name" defaultValue="Main" className="input" /></Field>
      <Field label="Quantity" htmlFor="quantity"><input id="quantity" name="quantity" required inputMode="numeric" className="input" /></Field>
      <Field label="Finished length" htmlFor="finished_length"><input id="finished_length" name="finished_length" inputMode="decimal" className="input" /></Field>
      <Field label="Finished width" htmlFor="finished_width"><input id="finished_width" name="finished_width" inputMode="decimal" className="input" /></Field>
      <Field label="Size unit" htmlFor="size_unit">
        <select id="size_unit" name="size_unit" defaultValue="mm" className="input"><option>mm</option><option>cm</option><option>in</option></select>
      </Field>
      <Field label="Description" htmlFor="description" className="sm:col-span-2 lg:col-span-3"><input id="description" name="description" className="input" placeholder="Print, finish, materials, anything the supplier needs" /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="is_draft" /> Save as draft</label>
    </div>
  );
}
