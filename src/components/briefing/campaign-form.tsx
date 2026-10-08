"use client";

import Link from "next/link";
import { useActionState } from "react";
import { btn, Card } from "@/components/ui";
import { ACTIVATION_OBJECTIVES, CAMPAIGN_TYPES, CHANNELS, CLIENT_OPTIONS, MARKETS, P2P_STAGES, STORE_TYPES, type Campaign } from "@/lib/briefing";

type Result = { ok: boolean; message: string };

function Checks({ name, options, selected }: { name: string; options: { value: string; label: string }[]; selected: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} /> {o.label}
        </label>
      ))}
    </div>
  );
}

export function CampaignForm({ action, campaign, markets, cancelHref }: {
  action: (prev: Result, fd: FormData) => Promise<Result>; campaign?: Campaign; markets?: { region: string; market: string }[]; cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true, message: "" });
  const c = campaign;
  const asOpts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Card className="grid gap-4 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div><label className="label" htmlFor="name">Campaign name <span className="text-bad">*</span></label><input id="name" name="name" required className="input" defaultValue={c?.name ?? ""} /></div>
          <div>
            <label className="label" htmlFor="client">Client</label>
            <input id="client" name="client" className="input" list="camp-clients" defaultValue={c?.client ?? ""} />
            <datalist id="camp-clients">{CLIENT_OPTIONS.map((x) => <option key={x} value={x} />)}</datalist>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label" htmlFor="brands">Brands <span className="font-normal text-muted">(comma separated)</span></label><input id="brands" name="brands" className="input" defaultValue={c?.brands?.join(", ") ?? ""} /></div>
          <div><label className="label" htmlFor="division">Division</label><input id="division" name="division" className="input" defaultValue={c?.division ?? ""} /></div>
          <div><label className="label" htmlFor="brand_tier">Brand tier / market strategy</label><input id="brand_tier" name="brand_tier" className="input" placeholder="Core, Premium, Entry, Innovation…" defaultValue={c?.brand_tier ?? ""} /></div>
        </div>
        <div><label className="label" htmlFor="objective">Objective</label><textarea id="objective" name="objective" rows={2} className="input" defaultValue={c?.objective ?? ""} /></div>
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="label" htmlFor="campaign_type">Campaign type</label>
            <select id="campaign_type" name="campaign_type" className="input" defaultValue={c?.campaign_type ?? ""}><option value="">Choose</option>{CAMPAIGN_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          </div>
          <div>
            <label className="label" htmlFor="activation_objective">Activation objective</label>
            <select id="activation_objective" name="activation_objective" className="input" defaultValue={c?.activation_objective ?? ""}><option value="">Choose</option>{ACTIVATION_OBJECTIVES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          </div>
          <div><label className="label" htmlFor="start_date">Starts</label><input id="start_date" name="start_date" type="date" className="input" defaultValue={c?.start_date ?? ""} /></div>
          <div><label className="label" htmlFor="end_date">Ends</label><input id="end_date" name="end_date" type="date" className="input" defaultValue={c?.end_date ?? ""} /></div>
        </div>
        {c && (
          <div className="max-w-xs">
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" className="input" defaultValue={c.status}><option value="planning">Planning</option><option value="live">Live</option><option value="closed">Closed</option></select>
          </div>
        )}
      </Card>
      <Card className="grid gap-4 p-5">
        <div><p className="label">Channels</p><Checks name="channels" options={asOpts(CHANNELS)} selected={c?.channels ?? []} /></div>
        <div><p className="label">Store types</p><Checks name="store_types" options={asOpts(STORE_TYPES)} selected={c?.store_types ?? []} /></div>
        <div><p className="label">Path-to-purchase stages</p><Checks name="p2p_stages" options={asOpts(P2P_STAGES)} selected={c?.p2p_stages ?? []} /></div>
        <div>
          <p className="label">Markets <span className="font-normal text-muted">(each brief is written for one of these)</span></p>
          <Checks name="markets" options={MARKETS.map((m) => ({ value: `${m.region}:${m.code}`, label: `${m.name} · ${m.region}` }))} selected={(markets ?? []).map((m) => `${m.region}:${m.market}`)} />
        </div>
      </Card>
      {!state.ok && state.message && <p className="text-sm text-bad" role="alert">{state.message}</p>}
      <div className="flex justify-end gap-2">
        <Link href={cancelHref} className={btn.secondary}>Cancel</Link>
        <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Saving…" : c ? "Save campaign" : "Create campaign"}</button>
      </div>
    </form>
  );
}
