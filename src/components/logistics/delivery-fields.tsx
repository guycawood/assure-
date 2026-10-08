import { DELIVERY_METHODS, INCOTERMS, cap, type Delivery } from "@/lib/logistics";

type Market = { code: string; name: string; region_code: string };

/** Destination + plan fields shared by "add a destination" and "edit the plan". Region follows the market (kept separate in the data). */
export function DeliveryFields({ d, markets, showQuantity = true }: { d?: Partial<Delivery>; markets: Market[]; showQuantity?: boolean }) {
  const f = (k: keyof Delivery) => (d?.[k] == null ? "" : String(d[k]));
  const input = (name: keyof Delivery, label: string, type = "text", extra: Record<string, string> = {}) => (
    <div>
      <label className="label" htmlFor={`df-${name}`}>{label}</label>
      <input id={`df-${name}`} name={name} type={type} defaultValue={f(name)} className="input" {...extra} />
    </div>
  );
  return (
    <div className="space-y-4">
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="eyebrow mb-1">Destination</legend>
        {input("recipient_name", "Recipient")}
        {input("recipient_contact", "Contact person")}
        {input("recipient_phone", "Phone")}
        {input("recipient_email", "Email", "email")}
        {input("address_line", "Address")}
        {input("city", "City")}
        {input("postcode", "Postcode")}
        <div>
          <label className="label" htmlFor="df-market">Market</label>
          <select id="df-market" name="market" defaultValue={f("market")} className="input" required>
            <option value="">Choose…</option>
            {markets.map((m) => <option key={m.code} value={m.code}>{m.name} ({m.region_code})</option>)}
          </select>
        </div>
        {input("destination_lat", "Latitude", "number", { step: "0.000001" })}
        {input("destination_lon", "Longitude", "number", { step: "0.000001" })}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="eyebrow mb-1">Origin (optional)</legend>
        {input("origin_name", "Dispatch site")}
        <div>
          <label className="label" htmlFor="df-origin_market">Origin market</label>
          <select id="df-origin_market" name="origin_market" defaultValue={f("origin_market")} className="input">
            <option value="">—</option>
            {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>
        </div>
        {input("origin_lat", "Origin latitude", "number", { step: "0.000001" })}
        {input("origin_lon", "Origin longitude", "number", { step: "0.000001" })}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="eyebrow mb-1">Plan</legend>
        {showQuantity && input("quantity", "Quantity", "number", { min: "1" })}
        {input("uom", "Unit")}
        <div>
          <label className="label" htmlFor="df-delivery_method">Method</label>
          <select id="df-delivery_method" name="delivery_method" defaultValue={f("delivery_method") || "road"} className="input">
            {DELIVERY_METHODS.map((m) => <option key={m} value={m}>{cap(m)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="df-incoterm">Incoterm</label>
          <select id="df-incoterm" name="incoterm" defaultValue={f("incoterm")} className="input">
            <option value="">—</option>
            {INCOTERMS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {input("planned_dispatch_date", "Planned dispatch", "date")}
        {input("planned_delivery_date", "Planned delivery", "date")}
        {input("gross_weight_kg", "Gross weight (kg)", "number", { step: "0.001", min: "0" })}
        {input("distance_km", "Distance (km)", "number", { step: "0.1", min: "0" })}
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="label" htmlFor="df-special_instructions">Special instructions</label>
          <textarea id="df-special_instructions" name="special_instructions" defaultValue={f("special_instructions")} className="input" rows={2} />
        </div>
      </fieldset>
      <p className="text-xs text-muted">Leave distance blank to have it worked out from the origin and destination coordinates. Weight and distance drive the transport CO2e recorded on delivery.</p>
    </div>
  );
}
