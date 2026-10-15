"use client";

import { ActionForm } from "@/components/vendor/action-form";
import { copyTechSheet, saveTechSheet } from "@/app/vendor/(portal)/tech-sheets/actions";
import { LEVELS, MATERIAL_ROWS, PACK_MATERIAL_ROWS, packOf, type MaterialOptions, type RequiredField, type TechSheet } from "@/lib/tech-sheet";

const v = (x: unknown) => (x == null ? "" : String(x));
const yn = (b: boolean | null | undefined) => (b == null ? "" : b ? "yes" : "no");

function Num({ name, label, value, req }: { name: string; label: string; value: unknown; req?: boolean }) {
  return (
    <label className="block text-xs">
      <span className="label">{label}{req && <span className="ml-1 text-bad" title="Required by adm Indicia">*</span>}</span>
      <input name={name} inputMode="decimal" defaultValue={v(value)} className="input" />
    </label>
  );
}
function Txt({ name, label, value, req, wide }: { name: string; label: string; value: unknown; req?: boolean; wide?: boolean }) {
  return (
    <label className={`block text-xs ${wide ? "sm:col-span-2" : ""}`}>
      <span className="label">{label}{req && <span className="ml-1 text-bad" title="Required by adm Indicia">*</span>}</span>
      <input name={name} defaultValue={v(value)} maxLength={500} className="input" />
    </label>
  );
}

/**
 * The vendor's technical & packaging data sheet for one PO line. "Save draft" keeps it private to the vendor's work; "Declare"
 * confirms the values (a new version is recorded). Fields adm Indicia requires (by the requirement matrix) are starred.
 */
export function VendorSheetForm({ poId, specId, versionId, sheet, required, options }: {
  poId: string; specId: string; versionId: string | null; sheet: TechSheet | null; required: RequiredField[]; options: MaterialOptions;
}) {
  const req = new Set(required.map((r) => r.code));
  const hidden: Record<string, string> = { po: poId, spec: specId, ...(versionId ? { version: versionId } : {}) };
  const mats = sheet?.materials ?? [];
  return (
    <ActionForm action={saveTechSheet} hidden={hidden} submit="Declare these values" secondary={[{ label: "Save draft", intent: "draft" }]} className="flex flex-col gap-5">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-bold">Product as built</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <Num name="length_mm" label="Length (mm)" value={sheet?.length_mm} req={req.has("product_dims")} />
          <Num name="width_mm" label="Width (mm)" value={sheet?.width_mm} req={req.has("product_dims")} />
          <Num name="height_mm" label="Height (mm)" value={sheet?.height_mm} req={req.has("product_dims")} />
          <Num name="net_weight_g" label="Net weight of one unit (g)" value={sheet?.net_weight_g} req={req.has("net_weight")} />
          <Txt name="origin_country" label="Country of origin" value={sheet?.origin_country} req={req.has("origin_country")} />
          <Txt name="hs_code" label="HS code" value={sheet?.hs_code} req={req.has("hs_code")} />
          <Txt name="finishes" label="Finishes (print, coatings, laminates)" value={sheet?.finishes} req={req.has("finishes")} wide />
          <Txt name="components_note" label="Components" value={sheet?.components_note} req={req.has("components")} wide />
          <label className="block text-xs"><span className="label">Electrical parts{req.has("electrical") && <span className="ml-1 text-bad">*</span>}</span>
            <select name="has_electrical" defaultValue={yn(sheet?.has_electrical)} className="input"><option value="">Not stated</option><option value="no">No</option><option value="yes">Yes</option></select></label>
          <label className="block text-xs"><span className="label">Battery</span>
            <select name="has_battery" defaultValue={yn(sheet?.has_battery)} className="input"><option value="">Not stated</option><option value="no">No</option><option value="yes">Yes</option></select></label>
          <Txt name="electrical_detail" label="Electrical / battery details" value={sheet?.electrical_detail} wide />
        </div>
        <div className="overflow-x-auto">
          <p className="mb-1 text-xs font-semibold">Materials breakdown{req.has("materials") && <span className="ml-1 text-bad">*</span>} <span className="font-normal text-muted">(shares add up to 100%)</span></p>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Material (library)</th><th className="th">Or describe it</th><th className="th">Share %</th><th className="th">Weight g</th><th className="th">Recycled %</th></tr></thead>
            <tbody>
              {Array.from({ length: MATERIAL_ROWS }, (_, i) => {
                const m = mats[i];
                return (
                  <tr key={i}>
                    <td className="td"><select name={`m${i}_substrate_code`} defaultValue={v(m?.substrate_code)} className="input min-w-[180px]">
                      <option value="">–</option>{options.substrates.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}</select></td>
                    <td className="td"><input name={`m${i}_material_name`} defaultValue={v(m?.substrate_code ? "" : m?.material_name)} className="input min-w-[140px]" /></td>
                    <td className="td"><input name={`m${i}_share_pct`} inputMode="decimal" defaultValue={v(m?.share_pct)} className="input max-w-[90px]" /></td>
                    <td className="td"><input name={`m${i}_weight_g`} inputMode="decimal" defaultValue={v(m?.weight_g)} className="input max-w-[100px]" /></td>
                    <td className="td"><input name={`m${i}_recycled_pct`} inputMode="decimal" defaultValue={v(m?.recycled_pct)} className="input max-w-[90px]" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-bold">Packaging</legend>
        <Txt name="packing_method" label="Packing method" value={sheet?.packing_method} req={req.has("packing_method")} wide />
        {LEVELS.map((lv) => {
          const p = packOf(sheet, lv.key);
          const k = lv.key;
          const pre = k === "primary" ? "primary_" : k === "secondary" ? "carton_" : "pallet_";
          return (
            <div key={k} className="space-y-2 rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold">{lv.label}</p><span className="text-xs text-muted">{lv.hint}</span>
                <label className="ml-auto flex items-center gap-1.5 text-xs"><input type="checkbox" name={`${k}_not_used`} defaultChecked={!!p?.not_used} />
                  {k === "primary" ? "No unit pack" : k === "secondary" ? "No carton" : "No pallet (parcel or loose)"}</label>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <Txt name={`${k}_description`} label="What it is" value={p?.description} req={req.has("primary_pack") && k === "primary"} wide />
                <Num name={`${k}_length_mm`} label="Length (mm)" value={p?.length_mm} req={(k === "secondary" && req.has("carton_dims")) || (k === "tertiary" && req.has("pallet"))} />
                <Num name={`${k}_width_mm`} label="Width (mm)" value={p?.width_mm} />
                <Num name={`${k}_height_mm`} label="Height (mm)" value={p?.height_mm} />
                {k !== "tertiary" && <Num name={`${k}_units_per_pack`} label={k === "secondary" ? "Units per carton" : "Units per unit pack"} value={p?.units_per_pack} req={k === "secondary" && req.has("units_per_carton")} />}
                {k === "secondary" && <Num name={`${k}_packs_per_carton`} label="Inner packs per carton" value={p?.packs_per_carton} />}
                {k === "tertiary" && <>
                  <Txt name={`${k}_pallet_type`} label="Pallet type" value={p?.pallet_type} req={req.has("pallet")} />
                  <Num name={`${k}_cartons_per_layer`} label="Cartons per layer" value={p?.cartons_per_layer} req={req.has("pallet_config")} />
                  <Num name={`${k}_layers`} label="Layers" value={p?.layers} />
                  <Num name={`${k}_cartons_per_pallet`} label="Cartons per pallet" value={p?.cartons_per_pallet} />
                </>}
                {k !== "primary" && <Num name={`${k}_gross_weight_kg`} label={k === "secondary" ? "Gross weight, full carton (kg)" : "Gross weight, full pallet (kg)"} value={p?.gross_weight_kg}
                  req={(k === "secondary" && req.has("carton_gross_weight")) || (k === "tertiary" && req.has("pallet_gross_weight"))} />}
                {k !== "primary" && <Num name={`${k}_max_stack`} label="Maximum stacking" value={p?.max_stack} req={req.has("max_stack")} />}
                {k === "secondary" && <Txt name={`${k}_labelling`} label="Labelling and marking" value={p?.labelling} req={req.has("carton_marking")} wide />}
                {k !== "tertiary" && <Txt name={`${k}_protective_fill`} label="Protective packaging / void fill" value={p?.protective_fill} req={req.has("protective_fill") && k === "secondary"} wide />}
              </div>
              <table className="w-full text-sm">
                <thead><tr><th className="th">Material{req.has(`${pre}materials`) && <span className="ml-1 text-bad">*</span>}</th><th className="th">Part</th>
                  <th className="th">Weight g{req.has(`${pre}material_weights`) && <span className="ml-1 text-bad">*</span>}</th>
                  <th className="th">Recycled %{req.has(`${pre}recycled`) && <span className="ml-1 text-bad">*</span>}</th><th className="th">Reusable{req.has("reusable_packaging") && <span className="ml-1 text-bad">*</span>}</th></tr></thead>
                <tbody>
                  {Array.from({ length: PACK_MATERIAL_ROWS }, (_, i) => {
                    const m = p?.materials[i];
                    return (
                      <tr key={i}>
                        <td className="td"><select name={`${k}_pm${i}_code`} defaultValue={v(m?.material_code)} className="input min-w-[180px]">
                          <option value="">–</option>{options.packaging.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}</select></td>
                        <td className="td"><input name={`${k}_pm${i}_component`} defaultValue={v(m?.component)} className="input min-w-[120px]" placeholder={k === "tertiary" ? "e.g. Stretch wrap" : "e.g. Outer carton"} /></td>
                        <td className="td"><input name={`${k}_pm${i}_weight_g`} inputMode="decimal" defaultValue={v(m?.weight_g)} className="input max-w-[100px]" /></td>
                        <td className="td"><input name={`${k}_pm${i}_recycled_pct`} inputMode="decimal" defaultValue={v(m?.recycled_pct)} className="input max-w-[90px]" /></td>
                        <td className="td"><select name={`${k}_pm${i}_reusable`} defaultValue={yn(m?.reusable)} className="input max-w-[110px]"><option value="">–</option><option value="no">No</option><option value="yes">Yes</option></select></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </fieldset>
      <label className="block text-xs"><span className="label">Notes for adm Indicia (optional)</span><input name="notes" defaultValue={v(sheet?.notes)} maxLength={2000} className="input" /></label>
    </ActionForm>
  );
}

/** Copy a previous sheet of this vendor (same spec or a similar one) into this line, then check and declare it. */
export function CopySheetForm({ poId, specId, versionId, sources }: {
  poId: string; specId: string; versionId: string | null; sources: { id: string; sheet_ref: string; status: string; spec_title: string; same_spec: boolean }[];
}) {
  if (sources.length === 0) return null;
  return (
    <ActionForm action={copyTechSheet} hidden={{ po: poId, spec: specId, ...(versionId ? { version: versionId } : {}) }} submit="Copy into this sheet" variant="secondary"
      className="flex flex-wrap items-end gap-2">
      <label className="block min-w-[260px] flex-1 text-xs"><span className="label">Copy from a previous sheet</span>
        <select name="source" className="input" required defaultValue="">
          <option value="" disabled>Choose one of your sheets</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.sheet_ref} · {s.spec_title}{s.same_spec ? " (same spec)" : ""} · {s.status}</option>)}
        </select>
      </label>
    </ActionForm>
  );
}
