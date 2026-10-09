import { requireVendorCompany, rpcList, canAct } from "@/lib/vendor-data";
import { formatDate, today } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { ActionDialog } from "@/components/vendor/action-form";
import { saveRecce } from "../actions";

export const metadata = { title: "Recces" };

type Recce = { id: string; recce_code: string | null; outlet_id: string; outlet_name: string; product_name: string | null; location_in_store: string | null; surface_type: string | null;
  available_width_cm: number | null; available_height_cm: number | null; available_depth_cm: number | null; unit_width_cm: number | null; unit_height_cm: number | null;
  unit_depth_cm: number | null; units_fit: number | null; wall_space_available: boolean | null; power_outlet_nearby: boolean | null; survey_date: string | null; status: string; notes: string | null };
type Outlet = { id: string; name: string; outlet_code: string | null; city: string | null; market: string | null };

const SURFACES = ["glass", "wall", "shelf", "floor", "ceiling", "counter", "gondola_end", "other"];
const v = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const yn = (b: boolean | null | undefined) => (b === true ? "true" : b === false ? "false" : "");

function RecceFields({ r, outlets }: { r?: Recce; outlets: Outlet[] }) {
  const k = r?.id ?? "new";
  const num = (name: keyof Recce, label: string) => (
    <div><label className="label" htmlFor={`${name}-${k}`}>{label}</label><input id={`${name}-${k}`} name={name} inputMode="decimal" className="input" defaultValue={v(r?.[name] as number | null)} /></div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {r ? <input type="hidden" name="recce" value={r.id} /> : (
        <div className="sm:col-span-3"><label className="label" htmlFor="outlet-new">Outlet</label>
          <select id="outlet-new" name="outlet" required className="input" defaultValue=""><option value="" disabled>Choose…</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}{o.outlet_code ? ` (${o.outlet_code})` : ""}{o.city ? `, ${o.city}` : ""}</option>)}</select></div>
      )}
      <div className="sm:col-span-2"><label className="label" htmlFor={`p-${k}`}>Product / display</label><input id={`p-${k}`} name="product_name" maxLength={200} className="input" defaultValue={r?.product_name ?? ""} /></div>
      <div><label className="label" htmlFor={`sd-${k}`}>Survey date</label><input id={`sd-${k}`} name="survey_date" type="date" max={today()} className="input" defaultValue={r?.survey_date ?? today()} /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor={`l-${k}`}>Location in store</label><input id={`l-${k}`} name="location_in_store" maxLength={200} className="input" defaultValue={r?.location_in_store ?? ""} placeholder="e.g. Front window, left of entrance" /></div>
      <div><label className="label" htmlFor={`st-${k}`}>Surface</label>
        <select id={`st-${k}`} name="surface_type" className="input" defaultValue={r?.surface_type ?? ""}><option value="">Choose…</option>{SURFACES.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted sm:col-span-3">Available space (cm)</p>
      {num("available_width_cm", "Width")}{num("available_height_cm", "Height")}{num("available_depth_cm", "Depth")}
      <p className="text-xs font-bold uppercase tracking-wider text-muted sm:col-span-3">Unit size (cm)</p>
      {num("unit_width_cm", "Width")}{num("unit_height_cm", "Height")}{num("unit_depth_cm", "Depth")}
      <div><label className="label" htmlFor={`w-${k}`}>Wall space available</label><select id={`w-${k}`} name="wall_space_available" className="input" defaultValue={yn(r?.wall_space_available)}><option value="">Not checked</option><option value="true">Yes</option><option value="false">No</option></select></div>
      <div><label className="label" htmlFor={`pw-${k}`}>Power outlet nearby</label><select id={`pw-${k}`} name="power_outlet_nearby" className="input" defaultValue={yn(r?.power_outlet_nearby)}><option value="">Not checked</option><option value="true">Yes</option><option value="false">No</option></select></div>
      <div className="sm:col-span-3"><label className="label" htmlFor={`n-${k}`}>Notes</label><textarea id={`n-${k}`} name="notes" rows={2} maxLength={2000} className="input" defaultValue={r?.notes ?? ""} /></div>
      <p className="text-xs text-muted sm:col-span-3">Save as a draft while you&apos;re measuring. Confirm when the space and unit size are complete; we work out how many units fit.</p>
    </div>
  );
}

export default async function RecceesPage() {
  const ctx = await requireVendorCompany();
  const [recces, outlets] = await Promise.all([rpcList<Recce>("execution_vendor_recces"), rpcList<Outlet>("execution_vendor_outlets")]);
  const act = canAct(ctx.permission);

  return (
    <>
      <PageHead title="Recces" sub="Site surveys at the outlets you work on: measure the space and the unit so the right display is made and fits first time.">
        {act && outlets.length > 0 && (
          <ActionDialog label="New recce" variant="primary" title="New recce" action={saveRecce} submit="Save draft" secondary={[{ label: "Save and confirm", intent: "confirm" }]} wide>
            <RecceFields outlets={outlets} />
          </ActionDialog>
        )}
      </PageHead>
      {recces.length === 0 ? <Card><Empty title="No recces yet">{outlets.length ? "Start one with the New recce button." : "When adm Indicia assigns outlets to you, you can survey them here."}</Empty></Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Outlet</th><th className="th">Product / location</th><th className="th">Space (W×H×D cm)</th><th className="th">Unit (W×H×D cm)</th><th className="th text-right">Units fit</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>
              {recces.map((r) => (
                <tr key={r.id}>
                  <td className="td font-semibold">{r.outlet_name}<span className="block text-xs font-normal text-muted">{r.recce_code}{r.survey_date ? ` · ${formatDate(r.survey_date)}` : ""}</span></td>
                  <td className="td">{r.product_name ?? "—"}<span className="block text-xs text-muted">{[r.location_in_store, r.surface_type && human(r.surface_type)].filter(Boolean).join(" · ")}</span></td>
                  <td className="td tabular-nums">{[r.available_width_cm, r.available_height_cm, r.available_depth_cm].map((x) => v(x) || "?").join(" × ")}</td>
                  <td className="td tabular-nums">{[r.unit_width_cm, r.unit_height_cm, r.unit_depth_cm].map((x) => v(x) || "?").join(" × ")}</td>
                  <td className="td text-right tabular-nums font-bold">{r.units_fit ?? "—"}</td>
                  <td className="td"><Pill tone={r.status === "draft" ? "warn" : statusTone(r.status)}>{human(r.status)}</Pill></td>
                  <td className="td text-right">
                    {act && r.status === "draft" && (
                      <ActionDialog label="Continue" title={`Recce at ${r.outlet_name}`} action={saveRecce} submit="Save draft" secondary={[{ label: "Save and confirm", intent: "confirm" }]} wide>
                        <RecceFields r={r} outlets={outlets} />
                      </ActionDialog>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
