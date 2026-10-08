import { computeUnitsFit, type Space } from "@/lib/execution";

/** Shows the units-fit derivation so the number is never a bare figure. The stored value is computed in the database. */
export function UnitsFit({ recce, stored }: { recce: Space; stored?: number | null }) {
  const r = computeUnitsFit(recce);
  return (
    <div className="space-y-1.5 text-sm">
      <p className="font-display text-2xl font-bold tabular-nums">{stored ?? r.total ?? "—"} <span className="text-sm font-normal text-muted">unit{(stored ?? r.total) === 1 ? "" : "s"} fit</span></p>
      <ul className="space-y-0.5 font-mono text-xs text-muted">{r.steps.map((s) => <li key={s}>{s}</li>)}</ul>
    </div>
  );
}

/** Recce measurement fields (shared by new + edit). */
export function RecceFields({ r, internal = true }: { r?: Partial<Record<string, unknown>>; internal?: boolean }) {
  const v = (k: string) => (r?.[k] == null ? "" : String(r[k]));
  const num = (k: string, label: string) => (
    <div>
      <label className="label" htmlFor={`rf-${k}`}>{label}</label>
      <input id={`rf-${k}`} name={k} type="number" step="0.1" min="0" defaultValue={v(k)} className="input" />
    </div>
  );
  const surfaces = ["glass", "wall", "shelf", "floor", "ceiling", "counter", "gondola_end", "other"];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><label className="label" htmlFor="rf-product_name">Product</label><input id="rf-product_name" name="product_name" defaultValue={v("product_name")} className="input" /></div>
        <div><label className="label" htmlFor="rf-location_in_store">Location in store</label><input id="rf-location_in_store" name="location_in_store" defaultValue={v("location_in_store")} className="input" /></div>
        <div><label className="label" htmlFor="rf-surface_type">Surface</label>
          <select id="rf-surface_type" name="surface_type" defaultValue={v("surface_type")} className="input"><option value="">—</option>{surfaces.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
        <div><label className="label" htmlFor="rf-survey_date">Survey date</label><input id="rf-survey_date" name="survey_date" type="date" defaultValue={v("survey_date")} className="input" /></div>
        <div><label className="label" htmlFor="rf-wall">Wall space available</label>
          <select id="rf-wall" name="wall_space_available" defaultValue={v("wall_space_available")} className="input"><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select></div>
        <div><label className="label" htmlFor="rf-power">Power nearby</label>
          <select id="rf-power" name="power_outlet_nearby" defaultValue={v("power_outlet_nearby")} className="input"><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select></div>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="eyebrow mb-1">Available space (cm)</legend>
        {num("available_width_cm", "Width")}{num("available_height_cm", "Height")}{num("available_depth_cm", "Depth")}</fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="eyebrow mb-1">Unit size (cm)</legend>
        {num("unit_width_cm", "Width")}{num("unit_height_cm", "Height")}{num("unit_depth_cm", "Depth")}</fieldset>
      {internal && (
        <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="eyebrow mb-1">Recommended finished size (cm), set by adm Indicia</legend>
          {num("recommended_width_cm", "Width")}{num("recommended_height_cm", "Height")}{num("recommended_depth_cm", "Depth")}
          <div className="sm:col-span-3"><label className="label" htmlFor="rf-rn">Recommendation notes</label><input id="rf-rn" name="recommended_notes" defaultValue={v("recommended_notes")} className="input" /></div>
        </fieldset>
      )}
      <div><label className="label" htmlFor="rf-notes">Notes</label><textarea id="rf-notes" name="notes" rows={2} defaultValue={v("notes")} className="input" /></div>
    </div>
  );
}
