"use client";

import { useActionState, useRef, useState } from "react";
import { btn } from "@/components/ui";
import { MARKETS, REGIONS } from "@/lib/briefing";
import { ASSET_TYPES, UPLIFT_SOURCES } from "@/lib/shopper-iq";

type Result = { ok: boolean; message: string };
type Opt = { id: string; name: string };

function MarketRegion() {
  const [region, setRegion] = useState("");
  return (
    <>
      <div>
        <label className="label" htmlFor="f-market">Market</label>
        <select id="f-market" name="market" className="input" onChange={(e) => setRegion(MARKETS.find((m) => m.code === e.target.value)?.region ?? region)}>
          <option value="">Choose</option>{MARKETS.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="f-region">Region</label>
        <select id="f-region" name="region" className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Choose</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>
    </>
  );
}

function useResetOnOk(action: (p: Result, fd: FormData) => Promise<Result>) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(async (p: Result, fd: FormData) => {
    const r = await action(p, fd);
    if (r.ok) ref.current?.reset();
    return r;
  }, { ok: true, message: "" });
  return { ref, state, formAction, pending };
}

export function EffectivenessForm({ action, campaigns, touchpoints, stages, defaultCampaign }: {
  action: (p: Result, fd: FormData) => Promise<Result>; campaigns: Opt[]; touchpoints: Opt[]; stages: Opt[]; defaultCampaign?: string;
}) {
  const { ref, state, formAction, pending } = useResetOnOk(action);
  return (
    <form ref={ref} action={formAction} className="grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="f-campaign">Campaign</label>
        <select id="f-campaign" name="campaign_id" required className="input" defaultValue={defaultCampaign ?? ""}><option value="">Choose</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <MarketRegion />
      <div>
        <label className="label" htmlFor="f-tp">Touchpoint</label>
        <select id="f-tp" name="touchpoint" required className="input"><option value="">Choose</option>{touchpoints.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </div>
      <div>
        <label className="label" htmlFor="f-stage">P2P stage</label>
        <select id="f-stage" name="p2p_stage" className="input"><option value="">—</option>{stages.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </div>
      <div><label className="label" htmlFor="f-channel">Channel</label><input id="f-channel" name="channel" className="input" placeholder="Off-trade" /></div>
      <div><label className="label" htmlFor="f-spend">Spend (EUR)</label><input id="f-spend" name="spend" type="number" min="0" step="any" className="input" /></div>
      <div><label className="label" htmlFor="f-score">Execution score (0–100)</label><input id="f-score" name="execution_score" type="number" min="0" max="100" className="input" /></div>
      <div><label className="label" htmlFor="f-uplift">Uplift %</label><input id="f-uplift" name="uplift_pct" type="number" step="any" className="input" /></div>
      <div>
        <label className="label" htmlFor="f-src">Uplift source</label>
        <select id="f-src" name="uplift_source" className="input">{Object.entries(UPLIFT_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div><label className="label" htmlFor="f-units">Units</label><input id="f-units" name="units" type="number" min="0" className="input" /></div>
      <div><label className="label" htmlFor="f-ps">From</label><input id="f-ps" name="period_start" type="date" className="input" /></div>
      <div><label className="label" htmlFor="f-pe">To</label><input id="f-pe" name="period_end" type="date" className="input" /></div>
      <input type="hidden" name="currency" value="EUR" />
      <div className="sm:col-span-2"><label className="label" htmlFor="f-notes">Notes</label><input id="f-notes" name="notes" className="input" /></div>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
        <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Saving…" : "Record"}</button>
        {state.message && <p className={state.ok ? "text-ok" : "text-bad"} role={state.ok ? "status" : "alert"}>{state.message}</p>}
      </div>
    </form>
  );
}

export function AssetForm({ action, campaigns, touchpoints, stages }: { action: (p: Result, fd: FormData) => Promise<Result>; campaigns: Opt[]; touchpoints: Opt[]; stages: Opt[] }) {
  const { ref, state, formAction, pending } = useResetOnOk(action);
  return (
    <form ref={ref} action={formAction} className="grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2"><label className="label" htmlFor="a-title">Title</label><input id="a-title" name="title" required className="input" /></div>
      <div>
        <label className="label" htmlFor="a-type">Type</label>
        <select id="a-type" name="asset_type" className="input">{ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </div>
      <div>
        <label className="label" htmlFor="a-campaign">Campaign</label>
        <select id="a-campaign" name="campaign_id" className="input"><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <MarketRegion />
      <div><label className="label" htmlFor="a-brand">Brand <span className="font-normal text-muted">(blank: from campaign)</span></label><input id="a-brand" name="brand" className="input" /></div>
      <div>
        <label className="label" htmlFor="a-tp">Touchpoint</label>
        <select id="a-tp" name="touchpoint" className="input"><option value="">—</option>{touchpoints.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </div>
      <div>
        <label className="label" htmlFor="a-stage">P2P stage</label>
        <select id="a-stage" name="p2p_stage" className="input"><option value="">—</option>{stages.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </div>
      <div><label className="label" htmlFor="a-file">File name</label><input id="a-file" name="file_name" className="input" placeholder="photo.jpg" /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="a-url">Link <span className="font-normal text-muted">(placeholder until file storage is connected)</span></label><input id="a-url" name="file_url" type="url" className="input" placeholder="https://" /></div>
      <div><label className="label" htmlFor="a-headline">Headline</label><input id="a-headline" name="headline" className="input" /></div>
      <div><label className="label" htmlFor="a-theme">Theme</label><input id="a-theme" name="theme" className="input" /></div>
      <div><label className="label" htmlFor="a-format">Format</label><input id="a-format" name="format" className="input" /></div>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
        <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Saving…" : "Add asset"}</button>
        {state.message && <p className={state.ok ? "text-ok" : "text-bad"} role={state.ok ? "status" : "alert"}>{state.message}</p>}
      </div>
    </form>
  );
}
