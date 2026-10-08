import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJobs } from "@/lib/sourcing-data";
import { getRecce } from "@/lib/execution-data";
import { RECCE_STATUS, cap } from "@/lib/execution";
import { FileList } from "@/components/file-list";
import { FileUpload } from "@/components/file-upload";
import { PageHead, Panel } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Facts, StatusPill, fmtDate } from "@/components/sourcing/bits";
import { RecceFields, UnitsFit } from "@/components/execution/units-fit";
import { saveRecce, setRecceStatus } from "../../actions";

export const metadata: Metadata = { title: "Recce" };

export default async function RecceDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const r = await getRecce(supabase, id);
  if (!r) notFound();
  const jobs = (await getJobs(supabase)).filter((j) => !["closed", "cancelled"].includes(j.status));
  const dims = (a: (number | null | undefined)[]) => (a.some((x) => x != null) ? a.map((x) => x ?? "–").join(" × ") + " cm" : "—");
  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Recces", href: "/execution/recces" }, { label: r.recce_code }]}
        title={`Recce ${r.recce_code}`} sub={`${r.outlet_name} (${r.outlet_code}) · ${r.market} · ${r.region}`}>
        <StatusPill meta={RECCE_STATUS} value={r.status} />
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel title="Survey">
            <Facts items={[
              ["Outlet", <Link key="o" className="hover:underline" href={`/execution/outlets/${r.outlet_id}`}>{r.outlet_name}</Link>],
              ["Job", r.job_id ? <Link key="j" className="hover:underline" href={`/execution/jobs/${r.job_id}`}>{r.job_number}</Link> : "—"],
              ["Product", r.product_name], ["Location in store", r.location_in_store], ["Surface", cap(r.surface_type)],
              ["Available space", dims([r.available_width_cm, r.available_height_cm, r.available_depth_cm])], ["Unit size", dims([r.unit_width_cm, r.unit_height_cm, r.unit_depth_cm])],
              ["Wall space", r.wall_space_available == null ? "—" : r.wall_space_available ? "Yes" : "No"], ["Power nearby", r.power_outlet_nearby == null ? "—" : r.power_outlet_nearby ? "Yes" : "No"],
              ["Surveyed", `${fmtDate(r.survey_date)}${r.captured_by_vendor ? ` by ${r.supplier_name ?? "the vendor"}` : r.surveyed_by_name ? ` by ${r.surveyed_by_name}` : ""}`],
              ["Recommended finished size", dims([r.recommended_width_cm, r.recommended_height_cm, r.recommended_depth_cm])],
              ["Recommendation notes", r.recommended_notes],
            ]} />
            {r.notes && <p className="border-t border-line px-5 py-2.5 text-sm">{r.notes}</p>}
          </Panel>
          <Panel title="Photos">
            <div className="space-y-3 p-5">
              <FileList entityType="recce" entityId={r.id} empty="No photos yet." />
              <FileUpload module="execution" entityType="recce" entityId={r.id} supplierId={r.supplier_id} label="Recce photo" accept="image/*,application/pdf" compact />
            </div>
          </Panel>
          <Panel title="Edit survey">
            <details className="p-5"><summary className="cursor-pointer text-sm font-semibold">Measurements and recommendation</summary>
              <div className="mt-4"><ActionForm action={saveRecce} hidden={{ id }} submit="Save recce">
                <Field label="Job (optional)" htmlFor="job_id"><select id="job_id" name="job_id" defaultValue={r.job_id ?? ""} className="input"><option value="">—</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.title}</option>)}</select></Field>
                <RecceFields r={r as unknown as Record<string, unknown>} />
              </ActionForm></div>
            </details>
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Units that fit"><div className="p-5"><UnitsFit recce={r} stored={r.units_fit} /></div></Panel>
          <Panel title="Status" sub="Confirming activates an outlet waiting for its survey. Production ready needs the recommended size.">
            <div className="p-5">
              <ActionForm action={setRecceStatus} hidden={{ id }} submit="Update status" variant="secondary">
                <Field label="Status" htmlFor="status"><select id="status" name="status" defaultValue={r.status} className="input">{Object.entries(RECCE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
              </ActionForm>
            </div>
          </Panel>
          {r.status === "production_ready" && (
            <Panel title="Next: specify it">
              <p className="px-5 py-4 text-sm">Build the spec to {r.recommended_width_cm} × {r.recommended_height_cm}{r.recommended_depth_cm ? ` × ${r.recommended_depth_cm}` : ""} cm for {r.units_fit ?? "?"} unit(s) per outlet{r.job_id ? <> on <Link className="underline" href={`/sourcing/jobs/${r.job_id}`}>{r.job_number}</Link> in Sourcing+</> : " in Sourcing+"}.</p>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
