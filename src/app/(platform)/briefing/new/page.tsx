import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCampaigns, getLibrary } from "@/lib/briefing-data";
import { PageHead } from "@/components/ui";
import { BriefForm } from "@/components/briefing/brief-form";
import { createBrief } from "../actions";

export const metadata: Metadata = { title: "New brief" };

export default async function NewBrief({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  await requireInternal();
  const { campaign } = await searchParams;
  const supabase = await createClient();
  const [campaigns, touchpoints] = await Promise.all([getCampaigns(supabase), getLibrary(supabase, "touchpoint_types")]);
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "New brief" }]} title="New brief"
        sub="Capture the requirement as the client states it, for one market. Quick to fill in; refine later." />
      <div className="max-w-4xl">
        <BriefForm action={createBrief} campaigns={campaigns} categories={touchpoints.map((t) => t.name)} cancelHref="/briefing"
          defaults={campaign ? { campaign_id: campaign, client: campaigns.find((c) => c.id === campaign)?.client ?? null } : undefined} />
      </div>
    </>
  );
}
