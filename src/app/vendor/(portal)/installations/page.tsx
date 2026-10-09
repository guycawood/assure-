import { requireVendorCompany, rpcList, canAct } from "@/lib/vendor-data";
import { getFiles } from "@/components/file-list";
import { formatDate, today } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionDialog } from "@/components/vendor/action-form";
import { GeoFields } from "@/components/vendor/geo-fields";
import { recordInstall } from "../actions";

export const metadata = { title: "Installations" };

type Deployment = { id: string; deployment_code: string; po_number: string; job_number: string; spec_title: string; spec_version: string | null; quantity: number;
  planned_date: string | null; stage: string; outlet_name: string; outlet_code: string | null; address_line: string | null; city: string | null; postcode: string | null;
  market: string | null; installation_date: string | null; installed_quantity: number | null; installer_name: string | null; gps_distance_m: number | null;
  gps_flag: boolean | null; audit_status: string; audit_score: number | null };

const STAGE: Record<string, string> = { planned: "Planned", in_transit: "Goods on the way", delivered: "Ready to install", installed: "Installed, awaiting audit", audited: "Audited", rejected: "Rejected" };

export default async function InstallationsPage() {
  const ctx = await requireVendorCompany();
  const deployments = await rpcList<Deployment>("execution_vendor_deployments");
  const photos = new Map(await Promise.all(deployments.map(async (d) => [d.id, (await getFiles("deployment", d.id)).map((f) => (f.label ?? "").toLowerCase())] as const)));
  const act = canAct(ctx.permission);
  const toDo = deployments.filter((d) => ["planned", "in_transit", "delivered"].includes(d.stage)).length;

  return (
    <>
      <PageHead title="Installations" sub={`Installs at outlets for your purchase orders. Take a before and an after photo, then record the install with the GPS position at the outlet. adm Indicia audits every install.${toDo ? ` ${toDo} to do.` : ""}`} />
      {deployments.length === 0 ? <Card><Empty title="No installations for you yet" /></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {deployments.map((d) => {
            const ph = photos.get(d.id) ?? [];
            const hasBefore = ph.includes("before"), hasAfter = ph.includes("after");
            const canInstall = act && ["planned", "in_transit", "delivered"].includes(d.stage);
            return (
              <Card key={d.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><MSymbol name="storefront" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{d.outlet_name}{d.outlet_code ? ` (${d.outlet_code})` : ""}</p>
                    <p className="text-xs text-muted">{[d.address_line, d.city, d.postcode, d.market].filter(Boolean).join(", ")}</p>
                  </div>
                  <Pill tone={d.stage === "delivered" ? "warn" : statusTone(d.stage)}>{STAGE[d.stage] ?? human(d.stage)}</Pill>
                </div>
                <p className="text-sm"><b>{d.spec_title}</b>{d.spec_version ? ` (${d.spec_version})` : ""} · {d.quantity} unit{d.quantity === 1 ? "" : "s"}</p>
                <p className="text-xs text-muted">{d.deployment_code} · {d.po_number} · {d.job_number}{d.planned_date ? ` · planned ${formatDate(d.planned_date)}` : ""}</p>
                {d.installation_date && (
                  <div className="rounded-lg bg-surface-2 p-3 text-xs">
                    Installed {formatDate(d.installation_date)} by {d.installer_name} · {d.installed_quantity} of {d.quantity}
                    {d.gps_distance_m !== null && <> · {d.gps_distance_m} m from the outlet</>}
                    {d.gps_flag && <span className="block text-warn">The GPS position needs a check by adm Indicia.</span>}
                    <span className="mt-1 block">Audit: <Pill tone={statusTone(d.audit_status)}>{human(d.audit_status)}</Pill>{d.audit_score !== null && ` score ${d.audit_score}`}</span>
                  </div>
                )}
                <p className="flex gap-3 text-xs">
                  <span className={hasBefore ? "text-ok" : "text-muted"}><MSymbol name={hasBefore ? "check_circle" : "photo_camera"} size={15} /> Before photo</span>
                  <span className={hasAfter ? "text-ok" : "text-muted"}><MSymbol name={hasAfter ? "check_circle" : "photo_camera"} size={15} /> After photo</span>
                </p>
                {d.stage === "planned" &&<p className="text-xs text-muted">If the goods come through a delivery, you can record the install once it has been delivered.</p>}
                {canInstall && (
                  <div className="mt-auto">
                    <ActionDialog label="Record install" variant="primary" title={`Record install at ${d.outlet_name}`} sub={`${d.spec_title} · ${d.quantity} planned`} action={recordInstall} hidden={{ deployment: d.id }} submit="Record install" wide>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><label className="label" htmlFor={`b-${d.id}`}>Before photo{hasBefore && " (uploaded; add another to replace)"}</label><input id={`b-${d.id}`} name="before" type="file" accept="image/*" capture="environment" required={!hasBefore} className="input" /></div>
                        <div><label className="label" htmlFor={`a-${d.id}`}>After photo{hasAfter && " (uploaded; add another to replace)"}</label><input id={`a-${d.id}`} name="after" type="file" accept="image/*" capture="environment" required={!hasAfter} className="input" /></div>
                        <div><label className="label" htmlFor={`dt-${d.id}`}>Installation date</label><input id={`dt-${d.id}`} name="installation_date" type="date" required max={today()} defaultValue={today()} className="input" /></div>
                        <div><label className="label" htmlFor={`q-${d.id}`}>Installed quantity</label><input id={`q-${d.id}`} name="quantity" type="number" min={0} max={d.quantity} required defaultValue={d.quantity} className="input" /></div>
                        <div className="sm:col-span-2"><label className="label" htmlFor={`i-${d.id}`}>Installed by</label><input id={`i-${d.id}`} name="installer" required maxLength={200} className="input" placeholder="Installer or team name" /></div>
                        <GeoFields id={d.id} />
                        <div className="sm:col-span-2"><label className="label" htmlFor={`n-${d.id}`}>Notes</label><textarea id={`n-${d.id}`} name="notes" rows={2} maxLength={2000} className="input" placeholder="Anything adm Indicia should know, e.g. a unit couldn't be fitted" /></div>
                      </div>
                    </ActionDialog>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
