import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople, rows } from "@/lib/sourcing-data";
import { getActiveLibrary, getDelivery, getLegs, getLogisticsEvents, getMarkets, getShipments, getSnapshots } from "@/lib/logistics-data";
import { DELIVERY_STATUS, LEG_MODES, NEXT_STATUS, POD_STATUS, cap, kg, type Shipment } from "@/lib/logistics";
import { getFiles, FileList } from "@/components/file-list";
import { FileUpload } from "@/components/file-upload";
import { PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Facts, StatusPill, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { Milestones } from "@/components/logistics/milestones";
import { DeliveryFields } from "@/components/logistics/delivery-fields";
import {
  attachPod, linkOutlet, markDelivered, recomputeEmissions, recordShipment, rejectPod, saveLeg, setDeliveryStatus, updateDelivery, verifyPod,
} from "../../actions";

export const metadata: Metadata = { title: "Delivery" };

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const d = await getDelivery(supabase, id);
  if (!d) notFound();
  const [ships, legs, snaps, events, people, carriers, podChecks, markets, outlets] = await Promise.all([
    getShipments(supabase, { delivery_id: id }), getLegs(supabase), getSnapshots(supabase, { delivery_id: id }), getLogisticsEvents(supabase, id),
    getPeople(supabase), getActiveLibrary(supabase, "carriers"), getActiveLibrary(supabase, "pod_checklist"), getMarkets(supabase),
    rows<{ id: string; name: string; outlet_code: string; market: string }>(supabase, "outlets", { order: [["name"]] }),
  ]);
  const podFiles = new Map(await Promise.all(ships.map(async (s) => [s.id, await getFiles("shipment", s.id)] as const)));
  const open = !["delivered", "cancelled", "failed"].includes(d.status);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHead crumbs={[{ label: "Logistics+", href: "/logistics" }, { label: "Deliveries", href: "/logistics/deliveries" }, { label: d.delivery_number }]}
        title={`Delivery ${d.delivery_number}`} sub={`${d.supplier_name} · ${d.po_number} · ${d.job_number} · to ${d.outlet_name ?? d.recipient_name ?? "destination not set"}, ${d.market_name ?? d.market} (${d.region})`}>
        <StatusPill meta={DELIVERY_STATUS} value={d.status} />
      </PageHead>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel title="Plan">
            <Facts items={[
              ["Purchase order", <Link key="po" className="hover:underline" href={`/orders/purchase-orders/${d.po_id}`}>{d.po_number}</Link>],
              ["Job", <Link key="j" className="hover:underline" href={`/execution/jobs/${d.job_id}`}>{d.job_number}</Link>],
              ["Spec", `#${d.spec_no} ${d.spec_title}${d.spec_version_name ? ` · ${d.spec_version_name}` : ""}`],
              ["Quantity", `${d.quantity} ${d.uom}`], ["Shipped", `${d.quantity_shipped} (${d.quantity_remaining} left to ship)`],
              ["Method", `${cap(d.delivery_method)}${d.incoterm ? ` · ${d.incoterm}` : ""}`],
              ["Planned dispatch", fmtDate(d.planned_dispatch_date)], ["Planned delivery", fmtDate(d.planned_delivery_date)],
              ["Delivered", d.actual_delivery_date ? <span key="a" className={d.on_time ? "text-ok" : "text-bad"}>{fmtDate(d.actual_delivery_date)} {d.on_time ? "(on time)" : "(late)"}</span> : "—"],
              ["Destination", [d.recipient_name, d.address_line, d.city, d.postcode].filter(Boolean).join(", ") || "Not set"],
              ["Contact", [d.recipient_contact, d.recipient_phone, d.recipient_email].filter(Boolean).join(" · ") || "—"],
              ["Outlet", d.outlet_id ? <Link key="o" className="hover:underline" href={`/execution/outlets/${d.outlet_id}`}>{d.outlet_name} ({d.outlet_code})</Link> : "—"],
              ["Region / market", `${d.region} / ${d.market_name ?? d.market}`],
              ["Origin", d.origin_name ? `${d.origin_name}${d.origin_market ? ` (${d.origin_market})` : ""}` : "—"],
              ["Gross weight", kg(d.gross_weight_kg, 3)], ["Distance", d.distance_km != null ? `${d.distance_km} km` : "—"],
            ]} />
            {d.special_instructions && <p className="border-t border-line px-5 py-2.5 text-sm"><span className="eyebrow mr-2">Instructions</span>{d.special_instructions}</p>}
          </Panel>

          <Panel title="Shipments and proof of delivery" sub="POD is uploaded by the vendor (or here) and verified by someone else against every mandatory point.">
            {ships.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing shipped yet.</p> : (
              <div className="divide-y divide-line">
                {ships.map((s) => (
                  <ShipmentBlock key={s.id} s={s} deliveryStatus={d.status} legs={legs.filter((l) => l.shipment_id === s.id)} meId={me.id} people={people}
                    files={podFiles.get(s.id) ?? []} podChecks={podChecks} carriers={carriers.map((c) => c.code ?? "").filter(Boolean)} />
                ))}
              </div>
            )}
          </Panel>

          {open && d.quantity_remaining > 0 && (
            <Panel title="Record a shipment" sub="Vendors usually record this in the vendor portal.">
              <div className="p-5">
                <ActionForm action={recordShipment} hidden={{ id }} submit="Record shipment">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Carrier" htmlFor="carrier_code">
                      <select id="carrier_code" name="carrier_code" className="input"><option value="">—</option>{carriers.map((c) => <option key={c.id} value={c.code ?? ""}>{c.name} ({c.code})</option>)}</select>
                    </Field>
                    <Field label="Service level" htmlFor="service_level"><input id="service_level" name="service_level" className="input" /></Field>
                    <Field label="Tracking reference" htmlFor="tracking"><input id="tracking" name="tracking" className="input" /></Field>
                    <Field label="Dispatch date" htmlFor="dispatch_date"><input id="dispatch_date" name="dispatch_date" type="date" defaultValue={today} className="input" required /></Field>
                    <Field label={`Quantity (max ${d.quantity_remaining})`} htmlFor="quantity"><input id="quantity" name="quantity" type="number" min={1} max={d.quantity_remaining} className="input" required /></Field>
                    <Field label="Gross weight (kg)" htmlFor="gross_weight_kg"><input id="gross_weight_kg" name="gross_weight_kg" type="number" step="0.001" className="input" /></Field>
                    <Field label="Notes" htmlFor="notes" className="sm:col-span-2"><input id="notes" name="notes" className="input" /></Field>
                  </div>
                </ActionForm>
              </div>
            </Panel>
          )}

          {open && (
            <Panel title="Edit the plan">
              <details className="p-5">
                <summary className="cursor-pointer text-sm font-semibold">Destination, dates, weight and distance</summary>
                <div className="mt-4">
                  <ActionForm action={updateDelivery} hidden={{ id }} submit="Save plan"><DeliveryFields d={d} markets={markets} /></ActionForm>
                </div>
              </details>
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Next step">
            <div className="space-y-3 p-5 text-sm">
              {["booked", "dispatched", "in_transit"].includes(d.status) && d.shipment_count > 0 && (
                <ActionForm action={markDelivered} hidden={{ id }} submit="Mark delivered" confirm="Mark this delivery delivered? Transport CO2e is recorded from the factor in force on that date.">
                  <Field label="Delivered on" htmlFor="delivered_on" hint="Defaults to the latest shipment delivery date"><input id="delivered_on" name="delivered_on" type="date" max={today} className="input" /></Field>
                  <Field label="Note" htmlFor="dnote"><input id="dnote" name="note" className="input" /></Field>
                </ActionForm>
              )}
              {(NEXT_STATUS[d.status] ?? []).length > 0 && (
                <ActionForm action={setDeliveryStatus} hidden={{ id }} submit="Update status" variant="secondary">
                  <Field label="Move to" htmlFor="status">
                    <select id="status" name="status" className="input">{NEXT_STATUS[d.status].map((s) => <option key={s} value={s}>{DELIVERY_STATUS[s].label}</option>)}</select>
                  </Field>
                  <Field label="Note (required for failed or cancelled)" htmlFor="snote"><input id="snote" name="note" className="input" /></Field>
                </ActionForm>
              )}
              {d.status === "delivered" && <p className="text-ok">Delivered {fmtDate(d.actual_delivery_date)}. {d.in_full ? "In full." : "Not in full."}</p>}
              {open && (
                <ActionForm action={linkOutlet} hidden={{ id }} submit="Use outlet as destination" variant="secondary">
                  <Field label="Outlet (Execution+)" htmlFor="outlet_id" hint="Copies address, coordinates, region and market from the outlet">
                    <select id="outlet_id" name="outlet_id" defaultValue={d.outlet_id ?? ""} className="input" required>
                      <option value="">Choose…</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.outlet_code} ({o.market})</option>)}
                    </select>
                  </Field>
                </ActionForm>
              )}
            </div>
          </Panel>

          <Panel title="Transport CO2e" sub="Scope 3 Cat. 4: tonnes × km × distance correction × gCO2e/t·km ÷ 1000. Snapshots never change.">
            {snaps.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Recorded when the delivery is delivered.</p> : (
              <ul className="divide-y divide-line text-sm">
                {snaps.map((x, i) => (
                  <li key={x.id} className="space-y-1 px-5 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-display text-lg font-bold tabular-nums">{kg(x.kgco2e, 3)} CO2e</span>
                      {i === 0 ? <Pill tone={x.complete ? "ok" : "warn"}>{x.complete ? "Current" : "Incomplete"}</Pill> : <Pill>Earlier</Pill>}
                    </div>
                    <p className="text-xs text-muted">Planned {kg(x.planned_kgco2e, 3)} · {cap(x.mode)} · {x.distance_km ?? "?"} km · {kg(x.actual_weight_kg ?? x.planned_weight_kg, 3)}</p>
                    <p className="text-xs text-muted">Factor {x.factor_code ?? "none"}{x.factor_version ? ` v${x.factor_version}` : ""}{x.factor_g_per_tkm != null ? ` (${x.factor_g_per_tkm} g/t·km × ${x.distance_correction})` : ""}, in force on {fmtDate(x.delivery_date)}</p>
                    <p className="text-xs text-muted">{x.basis}{x.missing?.length ? ` · Missing: ${x.missing.join(", ")}` : ""}{x.reason ? ` · ${x.reason}` : ""} · {fmtDateTime(x.computed_at)}</p>
                  </li>
                ))}
              </ul>
            )}
            {d.status === "delivered" && (
              <details className="border-t border-line px-5 py-3 text-sm"><summary className="cursor-pointer font-semibold">Recompute after a correction</summary>
                <div className="mt-3"><ActionForm action={recomputeEmissions} hidden={{ id }} submit="Record new snapshot" variant="secondary"><Field label="Reason" htmlFor="reason"><input id="reason" name="reason" className="input" required /></Field></ActionForm></div>
              </details>
            )}
            <p className="border-t border-line px-5 py-2 text-[0.7rem] text-muted">Transport only; not a product carbon footprint.</p>
          </Panel>

          <Panel title="History">
            {events.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing recorded yet.</p> : (
              <ol className="divide-y divide-line text-sm">
                {events.map((e) => (
                  <li key={e.id} className="px-5 py-2.5">
                    <div className="flex justify-between gap-2"><span className="font-semibold">{cap(e.event)}</span><span className="text-xs text-muted">{fmtDateTime(e.at)}</span></div>
                    <div className="text-xs text-muted">{e.actor ? people.get(e.actor) ?? "Vendor" : "System"}{typeof e.detail?.reason === "string" ? ` · ${e.detail.reason}` : ""}{typeof e.detail?.note === "string" ? ` · ${e.detail.note}` : ""}</div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function ShipmentBlock({ s, deliveryStatus, legs, meId, people, files, podChecks, carriers }: {
  s: Shipment; deliveryStatus: string; legs: { id: string; sequence: number; from_location: string; to_location: string; mode: string; carrier_code: string | null; planned_departure: string | null; actual_departure: string | null; planned_arrival: string | null; actual_arrival: string | null; status: string }[];
  meId: string; people: Map<string, string>; files: { id: string; file_name: string; label: string | null }[];
  podChecks: { id: string; code: string | null; name: string; data: Record<string, unknown> }[]; carriers: string[];
}) {
  const uploadedByMe = s.pod_uploaded_by === meId;
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{s.shipment_number}</span>
          <span className="ml-2 text-sm text-muted">{s.quantity_shipped} units · dispatched {fmtDate(s.dispatch_date)}{s.carrier_name ? ` · ${s.carrier_name}` : ""}{s.service_level ? ` (${s.service_level})` : ""}</span>
          {s.tracking_reference && <span className="ml-2 text-sm">Tracking {s.carrier_tracking_url ? <a className="underline" href={s.carrier_tracking_url} target="_blank" rel="noreferrer">{s.tracking_reference}</a> : s.tracking_reference}</span>}
        </div>
        <StatusPill meta={POD_STATUS} value={s.pod_status} />
      </div>
      <Milestones shipment={s} deliveryStatus={deliveryStatus} />
      <p className="text-xs text-muted">{s.recorded_by_vendor ? "Recorded by the vendor" : "Recorded internally"}{s.gross_weight_kg != null ? ` · ${kg(s.gross_weight_kg, 3)} gross` : ""}{s.actual_delivery_date ? ` · arrived ${fmtDate(s.actual_delivery_date)}` : ""}</p>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="eyebrow">POD files</p>
          <FileList entityType="shipment" entityId={s.id} empty="No POD uploaded yet." />
          {s.pod_status !== "verified" && (
            <details className="rounded-lg border border-line p-3 text-sm">
              <summary className="cursor-pointer font-semibold">Upload a POD here instead</summary>
              <div className="mt-3 space-y-3">
                <FileUpload module="logistics" entityType="shipment" entityId={s.id} supplierId={s.supplier_id} label="POD" compact />
                {files.length > 0 && (
                  <ActionForm action={attachPod} hidden={{ id: s.id }} submit="Attach as the POD" variant="secondary">
                    <Field label="File" htmlFor={`f-${s.id}`}><select id={`f-${s.id}`} name="file_id" className="input">{files.map((f) => <option key={f.id} value={f.id}>{f.file_name}</option>)}</select></Field>
                    <Field label="Delivered on" htmlFor={`do-${s.id}`}><input id={`do-${s.id}`} name="delivered_on" type="date" className="input" /></Field>
                  </ActionForm>
                )}
              </div>
            </details>
          )}
        </div>
        <div className="space-y-2">
          <p className="eyebrow">8-point check</p>
          {s.pod_status === "received" ? (
            uploadedByMe ? <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">You attached this POD, so someone else must verify it.</p> : (
              <>
                <ActionForm action={verifyPod} hidden={{ id: s.id }} submit="Verify POD" confirm="Verify this POD? The vendor will be told.">
                  <ul className="space-y-1.5 text-sm">
                    {podChecks.map((c) => (
                      <li key={c.id}><label className="flex items-start gap-2">
                        <input type="checkbox" name={`check:${c.code}`} className="mt-1" />
                        <span><span className="font-semibold">{c.name}</span>{c.data.mandatory === false ? <span className="text-xs text-muted"> (optional)</span> : null}
                          {typeof c.data.guidance === "string" && <span className="block text-xs text-muted">{c.data.guidance}</span>}</span>
                      </label></li>
                    ))}
                  </ul>
                  <Field label="Note" htmlFor={`vn-${s.id}`}><input id={`vn-${s.id}`} name="note" className="input" /></Field>
                </ActionForm>
                <details className="rounded-lg border border-line p-3 text-sm"><summary className="cursor-pointer font-semibold">Reject the POD</summary>
                  <div className="mt-3"><ActionForm action={rejectPod} hidden={{ id: s.id }} submit="Reject POD" variant="danger">
                    <Field label="What is wrong" htmlFor={`rr-${s.id}`}><input id={`rr-${s.id}`} name="reason" className="input" required /></Field>
                  </ActionForm></div>
                </details>
              </>
            )
          ) : s.pod_checklist?.length ? (
            <ul className="space-y-1 text-sm">
              {s.pod_checklist.map((c) => <li key={c.code} className={c.passed ? "text-ok" : "text-bad"}>{c.passed ? "✓" : "✗"} {c.name}{!c.mandatory ? " (optional)" : ""}</li>)}
              <li className="pt-1 text-xs text-muted">{s.pod_status === "verified" ? "Verified" : "Checked"} by {s.pod_verified_by_name ?? (s.pod_verified_by ? people.get(s.pod_verified_by) : null) ?? "—"} {fmtDateTime(s.pod_verified_at)}</li>
              {s.pod_rejection_reason && <li className="text-sm text-bad">Rejected: {s.pod_rejection_reason}</li>}
            </ul>
          ) : <p className="text-sm text-muted">Waiting for the POD.</p>}
        </div>
      </div>

      <div className="space-y-2">
        <p className="eyebrow">Legs</p>
        {legs.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm"><thead><tr><Th>#</Th><Th>From → to</Th><Th>Mode</Th><Th>Departure</Th><Th>Arrival</Th><Th>Status</Th></tr></thead>
              <tbody>{legs.map((l) => (
                <tr key={l.id}><Td>{l.sequence}</Td><Td>{l.from_location} → {l.to_location}</Td><Td>{cap(l.mode)}{l.carrier_code ? ` · ${l.carrier_code}` : ""}</Td>
                  <Td>{fmtDate(l.actual_departure ?? l.planned_departure)}{!l.actual_departure && l.planned_departure ? " (planned)" : ""}</Td>
                  <Td>{fmtDate(l.actual_arrival ?? l.planned_arrival)}{!l.actual_arrival && l.planned_arrival ? " (planned)" : ""}</Td>
                  <Td><Pill tone={l.status === "arrived" ? "ok" : l.status === "in_transit" ? "warn" : "neutral"}>{cap(l.status)}</Pill></Td></tr>))}</tbody></table>
          </div>
        )}
        <details className="rounded-lg border border-line p-3 text-sm"><summary className="cursor-pointer font-semibold">Add a leg</summary>
          <div className="mt-3"><ActionForm action={saveLeg} hidden={{ shipment_id: s.id }} submit="Save leg" variant="secondary">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="From" htmlFor={`lf-${s.id}`}><input id={`lf-${s.id}`} name="from_location" className="input" required /></Field>
              <Field label="To" htmlFor={`lt-${s.id}`}><input id={`lt-${s.id}`} name="to_location" className="input" required /></Field>
              <Field label="Mode" htmlFor={`lm-${s.id}`}><select id={`lm-${s.id}`} name="mode" className="input">{LEG_MODES.map((m) => <option key={m} value={m}>{cap(m)}</option>)}</select></Field>
              <Field label="Carrier" htmlFor={`lc-${s.id}`}><select id={`lc-${s.id}`} name="carrier_code" className="input"><option value="">—</option>{carriers.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Planned departure" htmlFor={`pd-${s.id}`}><input id={`pd-${s.id}`} name="planned_departure" type="date" className="input" /></Field>
              <Field label="Actual departure" htmlFor={`ad-${s.id}`}><input id={`ad-${s.id}`} name="actual_departure" type="date" className="input" /></Field>
              <Field label="Planned arrival" htmlFor={`pa-${s.id}`}><input id={`pa-${s.id}`} name="planned_arrival" type="date" className="input" /></Field>
              <Field label="Actual arrival" htmlFor={`aa-${s.id}`}><input id={`aa-${s.id}`} name="actual_arrival" type="date" className="input" /></Field>
            </div>
          </ActionForm></div>
        </details>
      </div>
    </div>
  );
}
