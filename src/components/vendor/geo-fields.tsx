"use client";

import { useState } from "react";
import { btn } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

/** Latitude/longitude inputs with a "use my location" button (browser geolocation) and manual entry as the fallback. */
export function GeoFields({ id }: { id: string }) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [state, setState] = useState<{ busy?: boolean; msg?: string }>({});
  const locate = () => {
    if (!("geolocation" in navigator)) { setState({ msg: "This browser can't share its location. Type the coordinates instead." }); return; }
    setState({ busy: true });
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); setState({ msg: `Located to within about ${Math.round(p.coords.accuracy)} m.` }); },
      (e) => setState({ msg: e.code === e.PERMISSION_DENIED ? "Location permission was refused. Type the coordinates instead." : "Couldn't get your location. Type the coordinates instead." }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };
  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div><label className="label" htmlFor={`lat-${id}`}>Latitude</label><input id={`lat-${id}`} name="lat" inputMode="decimal" className="input" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="e.g. 1.3048" /></div>
      <div><label className="label" htmlFor={`lon-${id}`}>Longitude</label><input id={`lon-${id}`} name="lon" inputMode="decimal" className="input" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="e.g. 103.8318" /></div>
      <button type="button" className={btn.secondary} onClick={locate} disabled={state.busy}><MSymbol name="my_location" size={18} /> {state.busy ? "Locating…" : "Use my location"}</button>
      <p className="text-xs text-muted sm:col-span-3">{state.msg ?? "Record the position at the outlet. Installs more than the allowed distance from the outlet are flagged for review."}</p>
    </div>
  );
}
