"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { btn, Card } from "@/components/ui";
import { CLIENT_OPTIONS, CURRENCIES, MARKETS, REGIONS, type Brief, type Campaign } from "@/lib/briefing";

type Result = { ok: boolean; message: string };

/** New brief and edit brief share this form. Edits after submission become numbered revisions (server side). */
export function BriefForm({ action, brief, campaigns, categories, defaults, cancelHref }: {
  action: (prev: Result, fd: FormData) => Promise<Result>;
  brief?: Brief; campaigns: Pick<Campaign, "id" | "name" | "client" | "division" | "brands">[];
  categories: string[]; defaults?: Partial<Brief>; cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true, message: "" });
  const b = { ...defaults, ...brief } as Partial<Brief>;
  const [market, setMarket] = useState(b.market ?? "");
  const [region, setRegion] = useState(b.region ?? "");
  const [campaignId, setCampaignId] = useState(b.campaign_id ?? "");
  const [client, setClient] = useState(b.client ?? "");
  const [brand, setBrand] = useState(b.brand ?? "");
  const [division, setDivision] = useState(b.division ?? "");
  const camp = campaigns.find((c) => c.id === campaignId);
  const editingSubmitted = brief && brief.status !== "draft";

  function pickCampaign(id: string) {
    setCampaignId(id);
    const c = campaigns.find((x) => x.id === id);
    if (c) {
      if (!client && c.client) setClient(c.client);
      if (!division && c.division) setDivision(c.division);
      if (!brand && c.brands?.[0]) setBrand(c.brands[0]);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {editingSubmitted && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
          This brief has been submitted. Saving records a new revision with what changed and keeps the previous version.
        </p>
      )}
      <Card className="grid gap-4 p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label" htmlFor="campaign_id">Campaign</label>
            <select id="campaign_id" name="campaign_id" className="input" value={campaignId} onChange={(e) => pickCampaign(e.target.value)}>
              <option value="">Not part of a campaign</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.client ? ` (${c.client})` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="market">Market</label>
            <select id="market" name="market" className="input" value={market} onChange={(e) => { setMarket(e.target.value); const m = MARKETS.find((x) => x.code === e.target.value); if (m) setRegion(m.region); }}>
              <option value="">Choose a market</option>
              {MARKETS.map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="region">Region</label>
            <select id="region" name="region" className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Choose a region</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label" htmlFor="client">Client</label>
            <input id="client" name="client" className="input" list="client-options" value={client} onChange={(e) => setClient(e.target.value)} />
            <datalist id="client-options">{CLIENT_OPTIONS.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="brand">Brand</label>
            <input id="brand" name="brand" className="input" list="brand-options" value={brand} onChange={(e) => setBrand(e.target.value)} />
            <datalist id="brand-options">{(camp?.brands ?? []).map((x) => <option key={x} value={x} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="division">Division</label>
            <input id="division" name="division" className="input" value={division} onChange={(e) => setDivision(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="title">Title <span className="text-bad">*</span></label>
          <input id="title" name="title" required className="input" defaultValue={b.title ?? ""} placeholder="Short name for the brief" />
        </div>
        <div>
          <label className="label" htmlFor="objective">Objective</label>
          <textarea id="objective" name="objective" rows={2} className="input" defaultValue={b.objective ?? ""} placeholder="What is this brief trying to achieve?" />
        </div>
        <div>
          <label className="label" htmlFor="brief_text">Brief</label>
          <textarea id="brief_text" name="brief_text" rows={6} className="input" defaultValue={b.brief_text ?? ""} placeholder="The requirement as the client states it. This is the main text ideation reads." />
        </div>
        <div>
          <label className="label" htmlFor="target_outlets">Target outlets</label>
          <textarea id="target_outlets" name="target_outlets" rows={2} className="input" defaultValue={b.target_outlets ?? ""} placeholder="e.g. top 50 GB stores" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div><label className="label" htmlFor="budget_low">Budget from</label><input id="budget_low" name="budget_low" type="number" min="0" step="any" className="input" defaultValue={b.budget_low ?? ""} /></div>
          <div><label className="label" htmlFor="budget_high">Budget to</label><input id="budget_high" name="budget_high" type="number" min="0" step="any" className="input" defaultValue={b.budget_high ?? ""} /></div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" defaultValue={b.currency ?? "GBP"}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div><label className="label" htmlFor="target_launch">Target launch</label><input id="target_launch" name="target_launch" type="date" className="input" defaultValue={b.target_launch ?? ""} /></div>
        </div>
        <div>
          <label className="label" htmlFor="product_category">Product category <span className="font-normal text-muted">(optional, leave blank if unsure)</span></label>
          <input id="product_category" name="product_category" className="input" list="category-options" defaultValue={b.product_category ?? ""} placeholder="Not sure yet" />
          <datalist id="category-options">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      </Card>

      <Card className="grid gap-4 p-5">
        <h2 className="font-bold">Sustainability targets</h2>
        <div>
          <label className="label" htmlFor="sustainability_targets">What the client wants</label>
          <textarea id="sustainability_targets" name="sustainability_targets" rows={2} className="input" defaultValue={b.sustainability_targets ?? ""} placeholder="e.g. no PVC, recyclable at end of life, reuse the structure next season" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="min_recycled_pct">Minimum recycled content (%)</label><input id="min_recycled_pct" name="min_recycled_pct" type="number" min="0" max="100" className="input" defaultValue={b.min_recycled_pct ?? ""} /></div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="require_fsc" defaultChecked={!!b.require_fsc} /> FSC certified material required</label>
        </div>
        <p className="text-xs text-muted">Ideation only suggests approved substrates and flags any concept that misses these targets.</p>
      </Card>

      {!state.ok && state.message && <p className="text-sm text-bad" role="alert">{state.message}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Link href={cancelHref} className={btn.secondary}>Cancel</Link>
        {brief ? (
          <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Saving…" : "Save changes"}</button>
        ) : (
          <>
            <button type="submit" name="intent" value="draft" disabled={pending} className={btn.secondary}>{pending ? "Saving…" : "Save draft"}</button>
            <button type="submit" name="intent" value="submit" disabled={pending} className={btn.primary}>{pending ? "Saving…" : "Submit for approval"}</button>
          </>
        )}
      </div>
    </form>
  );
}
