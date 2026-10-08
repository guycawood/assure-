import { STORE_TYPES, cap, type Outlet } from "@/lib/execution";

type Market = { code: string; name: string; region_code: string };

export function OutletFields({ o, markets, clients }: { o?: Partial<Outlet>; markets: Market[]; clients: { id: string; name: string }[] }) {
  const v = (k: keyof Outlet) => (o?.[k] == null ? "" : String(o[k]));
  const text = (k: keyof Outlet, label: string, extra: Record<string, string> = {}) => (
    <div><label className="label" htmlFor={`of-${k}`}>{label}</label><input id={`of-${k}`} name={k} defaultValue={v(k)} className="input" {...extra} /></div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {text("name", "Outlet name", { required: "" })}
      {text("outlet_code", "Outlet code", { required: "" })}
      <div><label className="label" htmlFor="of-client_id">Client</label>
        <select id="of-client_id" name="client_id" defaultValue={v("client_id")} className="input"><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      {text("address_line", "Address")}
      {text("city", "City")}
      {text("postcode", "Postcode")}
      <div><label className="label" htmlFor="of-market">Market</label>
        <select id="of-market" name="market" defaultValue={v("market")} className="input" required><option value="">Choose…</option>{markets.map((m) => <option key={m.code} value={m.code}>{m.name} ({m.region_code})</option>)}</select></div>
      {text("latitude", "Latitude", { type: "number", step: "0.000001" })}
      {text("longitude", "Longitude", { type: "number", step: "0.000001" })}
      <div><label className="label" htmlFor="of-store_type">Store type</label>
        <select id="of-store_type" name="store_type" defaultValue={v("store_type") || "other"} className="input">{STORE_TYPES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></div>
      <div><label className="label" htmlFor="of-status">Status</label>
        <select id="of-status" name="status" defaultValue={v("status") || "active"} className="input">{["active", "inactive", "pending_survey"].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></div>
      {text("contact_name", "Contact")}
      {text("contact_phone", "Phone")}
      {text("contact_email", "Email", { type: "email" })}
      <div className="sm:col-span-2 lg:col-span-3"><label className="label" htmlFor="of-notes">Notes</label><textarea id="of-notes" name="notes" rows={2} defaultValue={v("notes")} className="input" /></div>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">Coordinates are used to check installer GPS positions and as the destination for delivery emissions.</p>
    </div>
  );
}
