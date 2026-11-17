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
import { ActionForm } from "@/components/sourcing/action-form";
import { ImpactGradeBadge } from "@/components/impact-grade/grade-badge";
import { addAsset, linkAssetSpec, signOffAsset } from "../actions";

export const metadata: Metadata = { title: "Asset library" };

const ICON: Record<string, string> = { executional_image: "photo_camera", render_3d: "view_in_ar", production_art: "draw", playbook: "menu_book" };

export default async function AssetLibrary({ searchParams }: { searchParams: Promise<{ type?: string; brand?: string; grade?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, campaigns, touchpoints, stages] = await Promise.all([getAssets(supabase), getCampaigns(supabase), getLibrary(supabase, "touchpoint_types"), getLibrary(supabase, "p2p_stages")]);
  const gradeOf = (a: (typeof all)[number]) => (a.ig_score === null || a.ig_score === undefined ? null : Number(a.ig_score));
  const assets = all.filter((a) => (!sp.type || a.asset_type === sp.type) && (!sp.brand || a.brand === sp.brand)
    && (!sp.grade || (sp.grade === "none" ? gradeOf(a) === null : sp.grade === "any" ? gradeOf(a) !== null : a.ig_letter === sp.grade)));
  const { data: specRows } = await supabase.from("job_specs").select("id, title, spec_no, job_id").order("created_at", { ascending: false }).limit(500);
  const specList = (specRows ?? []) as { id: string; title: string; spec_no: number; job_id: string }[];
  const { data: jobRows } = specList.length ? await supabase.from("jobs").select("id, job_number").in("id", [...new Set(specList.map((s) => s.job_id))]) : { data: [] };
  const jobNo = new Map(((jobRows ?? []) as { id: string; job_number: string }[]).map((j) => [j.id, j.job_number]));
  const specOptions = specList.map((s) => ({ id: s.id, label: `${jobNo.get(s.job_id) ?? "Job"} · ${s.spec_no} · ${s.title}` }));
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
        <span className="eyebrow ml-4">Impact Grade</span>
        <Link href={link({ grade: undefined })} className={!sp.grade ? "font-bold text-accent" : "text-muted"}>All</Link>
        {[["any", "Graded"], ["none", "Not graded"], ["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"]].map(([v, l]) => <Link key={v} href={link({ grade: v })} className={sp.grade === v ? "font-bold text-accent" : "text-muted hover:text-fg"}>{l}</Link>)}
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
                  {a.rights_status === "pending" ? <Pill tone="warn">Rights sign-off needed</Pill> : a.rights_status === "rejected" ? <Pill tone="bad">Not for reuse</Pill> : null}
                </div>
                {a.can_signoff && (
                  <div className="flex flex-wrap gap-1">
                    <ActionForm action={signOffAsset} hidden={{ id: a.id, decision: "approve" }} submit="Sign off rights" variant="secondary" inline />
                    <ActionForm action={signOffAsset} hidden={{ id: a.id, decision: "reject" }} submit="Reject" variant="danger" inline>
                      <input name="note" required className="input w-28 py-1" placeholder="Why" aria-label="Why rejected" />
                    </ActionForm>
                  </div>
                )}
                <div className="space-y-1 border-t border-line pt-1.5 text-xs">
                  {a.spec_id ? (
                    <>
                      <p className="flex flex-wrap items-center gap-1.5">
                        <ImpactGradeBadge score={gradeOf(a)} href={`/sourcing/specs/${a.spec_id}`} />
                        {gradeOf(a) !== null && <span className="text-muted">{a.ig_confidence}% confident{a.ig_range_low != null && a.ig_range_high != null ? ` · ${Math.round(Number(a.ig_range_low))} to ${Math.round(Number(a.ig_range_high))}` : ""}</span>}
                        {gradeOf(a) !== null && a.ig_review_status !== "reviewed" && <Pill tone={a.ig_review_status === "disputed" ? "bad" : "warn"}>{a.ig_review_status === "disputed" ? "Disputed" : "Not reviewed"}</Pill>}
                      </p>
                      <p className="text-muted">Shows <Link href={`/sourcing/specs/${a.spec_id}`} className="text-accent hover:underline">{a.spec_title}</Link>{a.spec_job_number ? ` (${a.spec_job_number})` : ""}</p>
                    </>
                  ) : <p className="text-muted">Not linked to a spec, so no Impact Grade.</p>}
                  <details><summary className="cursor-pointer font-semibold text-accent">{a.spec_id ? "Change spec" : "Link to a spec"}</summary>
                    <ActionForm action={linkAssetSpec} hidden={{ id: a.id }} submit="Save" variant="secondary" className="mt-2">
                      <select name="spec_id" className="input py-1" defaultValue={a.spec_id ?? ""} aria-label="Spec this asset shows">
                        <option value="">No spec</option>{specOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </ActionForm>
                  </details>
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
