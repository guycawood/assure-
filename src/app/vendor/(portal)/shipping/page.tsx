import Link from "next/link";
import { requireVendorCompany, rows, rpcList, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate, today } from "@/lib/srt";
import { human, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionDialog } from "@/components/vendor/action-form";
import { attachPod, recordShipment } from "../actions";

export const metadata = { title: "Shipping & POD" };

type Shipment = { id: string; shipment_number: string; carrier_code: string | null; service_level: string | null; tracking_reference: string | null; dispatch_date: string;
  actual_delivery_date: string | null; quantity_shipped: number; gross_weight_kg: number | null; pod_file_id: string | null; pod_status: string;
  pod_rejection_reason: string | null; pod_checklist: { code: string; name: string; passed: boolean }[] };
type Delivery = { id: string; delivery_number: string; po_id: string; po_number: string; job_number: string; spec_title: string; spec_version: string | null;
  quantity: number; uom: string | null; shipped: number; remaining: number; recipient_name: string | null; recipient_contact: string | null; recipient_phone: string | null;
  address_line: string | null; city: string | null; postcode: string | null; market: string | null; delivery_method: string | null; incoterm: string | null;
  planned_dispatch_date: string | null; planned_delivery_date: string | null; actual_delivery_date: string | null; status: string; special_instructions: string | null; shipments: Shipment[] };
type Check = { code: string; name: string; guidance: string | null; mandatory: boolean };

const POD_LABEL: Record<string, string> = { not_received: "POD needed", received: "POD with adm Indicia", verified: "POD verified", rejected: "POD rejected" };

export default async function ShippingPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const [deliveries, checklist, carriers] = await Promise.all([
    rpcList<Delivery>("logistics_vendor_deliveries"),
    rows<Check>(supabase.from("vendor_pod_checklist").select("code, name, guidance, mandatory").order("code")),
    rows<{ code: string; name: string }>(supabase.from("vendor_carriers").select("code, name").order("name")),
  ]);
  const act = canAct(ctx.permission);
  const podsNeeded = deliveries.flatMap((d) => d.shipments).filter((s) => s.pod_status === "not_received" || s.pod_status === "rejected").length;

  const checklistBox = (
    <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
      <p className="mb-1 font-bold">The POD must show:</p>
      <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {checklist.map((c) => <li key={c.code} className="flex gap-1.5"><MSymbol name={c.mandatory ? "check_box" : "check_box_outline_blank"} size={16} className={c.mandatory ? "text-accent" : "text-muted"} /><span><b>{c.name}</b>{c.mandatory ? "" : " (if applicable)"}</span></li>)}
      </ul>
    </div>
  );

  return (
    <>
      <PageHead title="Shipping & POD" sub={`Deliveries planned against your accepted purchase orders. Record each shipment as it leaves, then upload the signed proof of delivery (POD).${podsNeeded ? ` ${podsNeeded} POD${podsNeeded > 1 ? "s" : ""} needed.` : ""}`} />

      <Panel title="What a proof of delivery must show" sub="adm Indicia checks every POD against this list before it's accepted">
        <ul className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {checklist.map((c, i) => (
            <li key={c.code} className="flex gap-2.5 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.7rem] font-bold text-accent">{i + 1}</span>
              <span><b>{c.name}</b>{!c.mandatory && <span className="text-muted"> (if applicable)</span>}{c.guidance && <span className="block text-xs text-muted">{c.guidance}</span>}</span>
            </li>
          ))}
          {checklist.length === 0 && <li className="text-sm text-muted">The checklist hasn&apos;t been set up yet.</li>}
        </ul>
      </Panel>

      {deliveries.length === 0 ? <Card><Empty title="No deliveries yet">When adm Indicia plans deliveries against your accepted purchase orders, they appear here.</Empty></Card> : deliveries.map((d) => {
        const canShip = act && d.remaining > 0 && ["planned", "booked", "dispatched", "in_transit"].includes(d.status);
        return (
          <Card key={d.id} className="overflow-hidden">
            <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-display text-[1.05rem] font-bold">{d.delivery_number} · {d.spec_title}{d.spec_version ? ` (${d.spec_version})` : ""}</p>
                <p className="text-xs text-muted"><Link href={`/vendor/orders/${d.po_id}`} className="hover:underline">{d.po_number}</Link> · {d.job_number}{d.delivery_method ? ` · ${human(d.delivery_method)}` : ""}{d.incoterm ? ` · ${d.incoterm}` : ""}</p>
              </div>
              <Pill tone={statusTone(d.status)}>{human(d.status)}</Pill>
              {canShip && (
                <ActionDialog label="Record shipment" variant="primary" title={`Record a shipment for ${d.delivery_number}`} sub={`${d.remaining} of ${d.quantity} left to ship`} action={recordShipment} hidden={{ delivery: d.id }} submit="Record shipment" wide>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label" htmlFor={`c-${d.id}`}>Carrier</label>
                      <select id={`c-${d.id}`} name="carrier_code" className="input" defaultValue=""><option value="">Own transport / other</option>{carriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
                    <div><label className="label" htmlFor={`sl-${d.id}`}>Service level</label><input id={`sl-${d.id}`} name="service_level" maxLength={60} className="input" placeholder="e.g. Express, Economy" /></div>
                    <div><label className="label" htmlFor={`t-${d.id}`}>Tracking reference</label><input id={`t-${d.id}`} name="tracking" maxLength={100} className="input" /></div>
                    <div><label className="label" htmlFor={`dd-${d.id}`}>Dispatch date</label><input id={`dd-${d.id}`} name="dispatch_date" type="date" required max={today()} defaultValue={today()} className="input" /></div>
                    <div><label className="label" htmlFor={`q-${d.id}`}>Quantity shipped</label><input id={`q-${d.id}`} name="quantity" type="number" min={1} max={d.remaining} required defaultValue={d.remaining} className="input" /></div>
                    <div><label className="label" htmlFor={`w-${d.id}`}>Gross weight (kg)</label><input id={`w-${d.id}`} name="gross_weight_kg" inputMode="decimal" className="input" /></div>
                    <div className="sm:col-span-2"><label className="label" htmlFor={`n-${d.id}`}>Notes</label><textarea id={`n-${d.id}`} name="notes" rows={2} maxLength={1000} className="input" placeholder="Cartons, pallets, anything the receiver should know" /></div>
                  </div>
                </ActionDialog>
              )}
            </div>
            <div className="grid gap-4 px-5 py-4 text-sm md:grid-cols-3">
              <div><p className="eyebrow">Deliver to</p><p className="font-semibold">{d.recipient_name ?? "—"}</p><p className="text-muted">{[d.address_line, d.city, d.postcode, d.market].filter(Boolean).join(", ")}</p>
                {(d.recipient_contact || d.recipient_phone) && <p className="text-xs text-muted">{[d.recipient_contact, d.recipient_phone].filter(Boolean).join(" · ")}</p>}</div>
              <div><p className="eyebrow">Dates</p><p>Dispatch {formatDate(d.planned_dispatch_date) || "—"}</p><p>Deliver by <b>{formatDate(d.planned_delivery_date) || "—"}</b></p>{d.actual_delivery_date && <p className="text-ok">Delivered {formatDate(d.actual_delivery_date)}</p>}</div>
              <div><p className="eyebrow">Quantity</p><p><b className="tabular-nums">{d.shipped}</b> of {d.quantity}{d.uom ? ` ${d.uom}` : ""} shipped</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (d.shipped / Math.max(1, d.quantity)) * 100)}%` }} /></div></div>
              {d.special_instructions && <p className="rounded-lg bg-warn-soft p-2.5 text-xs md:col-span-3"><b>Instructions:</b> {d.special_instructions}</p>}
            </div>
            {d.shipments.length > 0 && (
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">Shipment</th><th className="th">Carrier / tracking</th><th className="th">Dispatched</th><th className="th text-right">Qty</th><th className="th">Proof of delivery</th><th className="th" /></tr></thead>
                  <tbody>
                    {d.shipments.map((s) => {
                      const needsPod = s.pod_status === "not_received" || s.pod_status === "rejected";
                      return (
                        <tr key={s.id}>
                          <td className="td font-semibold">{s.shipment_number}</td>
                          <td className="td">{s.carrier_code ?? "Own transport"}{s.service_level ? ` · ${s.service_level}` : ""}<span className="block text-xs text-muted">{s.tracking_reference}</span></td>
                          <td className="td">{formatDate(s.dispatch_date)}{s.actual_delivery_date && <span className="block text-xs text-muted">Delivered {formatDate(s.actual_delivery_date)}</span>}</td>
                          <td className="td text-right tabular-nums">{s.quantity_shipped}</td>
                          <td className="td"><Pill tone={s.pod_status === "not_received" ? "warn" : statusTone(s.pod_status)}>{POD_LABEL[s.pod_status] ?? human(s.pod_status)}</Pill>
                            {s.pod_status === "rejected" && s.pod_rejection_reason && <span className="mt-1 block max-w-[36ch] text-xs text-bad">{s.pod_rejection_reason}</span>}
                            {s.pod_file_id && <a href={`/api/files/${s.pod_file_id}`} target="_blank" rel="noreferrer" className="mt-1 block text-xs font-semibold text-accent hover:underline">View POD</a>}</td>
                          <td className="td text-right">
                            {act && needsPod && (
                              <ActionDialog label={s.pod_status === "rejected" ? "Upload corrected POD" : "Upload POD"} variant={s.pod_status === "rejected" ? "danger" : "primary"} title={`Proof of delivery for ${s.shipment_number}`}
                                action={attachPod} hidden={{ shipment: s.id }} submit="Upload POD" wide>
                                {checklistBox}
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div><label className="label" htmlFor={`do-${s.id}`}>Delivered on</label><input id={`do-${s.id}`} name="delivered_on" type="date" min={s.dispatch_date} max={today()} defaultValue={today()} className="input" /></div>
                                  <div><label className="label" htmlFor={`f-${s.id}`}>Signed POD (PDF or photo)</label><input id={`f-${s.id}`} name="file" type="file" required accept=".pdf,image/*" className="input" /></div>
                                </div>
                              </ActionDialog>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
