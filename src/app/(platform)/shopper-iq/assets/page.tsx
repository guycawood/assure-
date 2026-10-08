import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCampaigns, getLibrary } from "@/lib/briefing-data";
import { getAssets } from "@/lib/shopper-iq-data";
import { ASSET_TYPES, METADATA_SOURCE } from "@/lib/shopper-iq";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { AssetForm } from "@/components/shopper-iq/forms";
import { addAsset } from "../actions";

export const metadata: Metadata = { title: "Asset library" };

const ICON: Record<string, string> = { executional_image: "photo_camera", render_3d: "view_in_ar", production_art: "draw", playbook: "menu_book" };

export default async function AssetLibrary({ searchParams }: { searchParams: Promise<{ type?: string; brand?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, campaigns, touchpoints, stages] = await Promise.all([getAssets(supabase), getCampaigns(supabase), getLibrary(supabase, "touchpoint_types"), getLibrary(supabase, "p2p_stages")]);
  const assets = all.filter((a) => (!sp.type || a.asset_type === sp.type) && (!sp.brand || a.brand === sp.brand));
  const brands = [...new Set(all.map((a) => a.brand).filter(Boolean) as string[])].sort();
  const link = (q: Record<string, string | undefined>) => "/shopper-iq/assets?" + new URLSearchParams(Object.entries({ ...sp, ...q }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHead crumbs={[{ label: "Shopper IQ", href: "/shopper-iq" }, { label: "Asset library" }]} title="Asset library"
        sub="Production-ready art, 3D renders, executional photos and playbooks, tagged with campaign, brand, market and touchpoint so they can be found and compared." />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="eyebrow">Type</span>
        <Link href={link({ type: undefined })} className={!sp.type ? "font-bold text-accent" : "text-muted"}>All</Link>
        {ASSET_TYPES.map((t) => <Link key={t.value} href={link({ type: t.value })} className={sp.type === t.value ? "font-bold text-accent" : "text-muted hover:text-fg"}>{t.label}</Link>)}
        <span className="eyebrow ml-4">Brand</span>
        <Link href={link({ brand: undefined })} className={!sp.brand ? "font-bold text-accent" : "text-muted"}>All</Link>
        {brands.map((b) => <Link key={b} href={link({ brand: b })} className={sp.brand === b ? "font-bold text-accent" : "text-muted hover:text-fg"}>{b}</Link>)}
      </div>
      {assets.length === 0 ? <Card><Empty title="No assets match">Add one below.</Empty></Card> : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {assets.map((a) => (
            <Card key={a.id} className="flex flex-col overflow-hidden">
              <div className="grid aspect-[4/3] place-items-center text-[#c8243a]" style={{ background: "linear-gradient(135deg, #EE4E6214, #F0F7F7)" }}>
                <MSymbol name={ICON[a.asset_type] ?? "image"} size={36} />
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <p className="text-sm font-bold leading-snug">{a.title}</p>
                <p className="text-xs text-muted">{a.asset_code} · {ASSET_TYPES.find((t) => t.value === a.asset_type)?.label}</p>
                <div className="flex flex-wrap gap-1">
                  {a.brand && <Pill>{a.brand}</Pill>}
                  {a.market && <Pill tone="info">{a.market}{a.region ? ` · ${a.region}` : ""}</Pill>}
                  {a.touchpoint_name && <Pill tone="accent">{a.touchpoint_name}</Pill>}
                  {a.p2p_stage_name && <Pill>{a.p2p_stage_name}</Pill>}
                </div>
                {a.campaign_name && <p className="text-xs">Campaign: {a.campaign_id ? <Link href={`/shopper-iq/campaigns?campaign=${a.campaign_id}`} className="text-accent hover:underline">{a.campaign_name}</Link> : a.campaign_name}</p>}
                {Object.keys(a.metadata ?? {}).length > 0 && (
                  <dl className="mt-1 space-y-0.5 text-[0.7rem]">
                    {Object.entries(a.metadata).map(([k, v]) => <div key={k} className="flex gap-1"><dt className="capitalize text-muted">{k.replace(/_/g, " ")}:</dt><dd className="truncate">{Array.isArray(v) ? v.join(", ") : String(v)}</dd></div>)}
                  </dl>
                )}
                <p className="mt-auto pt-1 text-[0.65rem] text-muted">{a.file_name ?? "No file"} · metadata {METADATA_SOURCE[a.metadata_source]?.toLowerCase()}</p>
              </div>
            </Card>
          ))}
        </section>
      )}
      <Panel title="Add an asset" sub="File upload is a placeholder for now: record the file name and a link. Brand fills in from the campaign when left blank.">
        <AssetForm action={addAsset} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} touchpoints={touchpoints.map((t) => ({ id: t.id, name: t.name }))} stages={stages.map((t) => ({ id: t.id, name: t.name }))} />
      </Panel>
    </>
  );
}
