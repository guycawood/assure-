import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { conceptDecisionRights, getCampaignConcepts } from "@/lib/briefing-data";
import { formatDate } from "@/lib/srt";
import { PageHead, Panel, Pill } from "@/components/ui";
import { CreativeSuggestionLabel } from "@/components/briefing/labels";
import { CampaignIdeation } from "./campaign-ideation";
import { ConceptActions } from "../concept-actions";

export const metadata: Metadata = { title: "Campaign ideation" };

export default async function CampaignIdeationPage({ searchParams }: { searchParams: Promise<{ concept?: string }> }) {
  await requireInternal();
  const { concept: pick } = await searchParams;
  const supabase = await createClient();
  const concepts = await getCampaignConcepts(supabase, pick);
  const decide = await conceptDecisionRights(supabase, concepts);
  const ordered = pick ? [...concepts.filter((c) => c.id === pick), ...concepts.filter((c) => c.id !== pick)] : concepts;

  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "Campaign ideation" }]} title="Campaign ideation"
        sub="Describe a campaign objective and get a shortlist of product types that could serve it, drawn from the touchpoint taxonomy and this client's history in Shopper IQ. Submit a product type for approval to turn it into draft briefs per market, or pick one to create a single draft brief now." />
      <div><CreativeSuggestionLabel /></div>
      <CampaignIdeation />

      <Panel title="Campaign concepts in approval" sub="Approved product types become one draft brief per market, linked back to the concept. The approver is never the person who submitted it."
        actions={<Link href="/watchtower/approvals?type=CONCEPT" className="text-sm font-semibold text-accent hover:underline">Approvals</Link>}>
        {ordered.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing submitted yet. Generate a shortlist above and submit a product type for approval.</p> : (
          <ul className="divide-y divide-line">
            {ordered.map((c) => (
              <li key={c.id} id={`concept-${c.id}`} className={`grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_320px] ${c.id === pick ? "bg-accent-soft/40" : ""}`}>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{c.name} {c.demo && <Pill>Demo</Pill>}</p>
                  {c.objective && <p className="text-xs text-muted">Objective: {c.objective}</p>}
                  <p className="text-xs text-muted">
                    {[c.context?.client, c.context?.brand].filter(Boolean).join(" · ")}
                    {c.submitted_at ? ` · submitted ${formatDate(c.submitted_at)}` : ""}{c.decided_at ? ` · decided ${formatDate(c.decided_at)}` : ""}
                  </p>
                  {c.data?.rationale && <p className="mt-1 text-xs">{c.data.rationale}</p>}
                </div>
                <ConceptActions c={c} canDecide={Boolean(decide[c.id])} approvalRequired mode="campaign" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
