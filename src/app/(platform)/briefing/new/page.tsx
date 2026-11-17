import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCampaigns, getLibrary } from "@/lib/briefing-data";
import Link from "next/link";
import { Card, PageHead } from "@/components/ui";
import { BriefForm } from "@/components/briefing/brief-form";
import { createBrief } from "../actions";
import { listClientTargets } from "@/lib/client-targets-data";

export const metadata: Metadata = { title: "New brief" };

export default async function NewBrief({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  await requireInternal();
  const { campaign } = await searchParams;
  const supabase = await createClient();
  const [campaigns, touchpoints, clientTargets] = await Promise.all([getCampaigns(supabase), getLibrary(supabase, "touchpoint_types"), listClientTargets(supabase)]);
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "New brief" }]} title="New brief"
        sub="Capture the requirement as the client states it, for one market. Quick to fill in; refine later." />
      <div className="grid max-w-4xl gap-3 md:grid-cols-2">
        <Card className="border-accent px-5 py-4 ring-1 ring-accent/30">
          <p className="font-semibold">New brief</p>
          <p className="mt-1 text-sm text-muted">Something new. Fill in the brief below. It goes through concepts and, where needed, an RFQ.</p>
        </Card>
        <Link href="/briefing/new/rate-card" className="block rounded-xl border border-line bg-surface px-5 py-4 shadow-sm transition hover:border-accent/50">
          <p className="font-semibold">Existing rate card</p>
          <p className="mt-1 text-sm text-muted">Repeat work with an agreed price. Pick an approved card and skip concepts and the RFQ.</p>
        </Link>
      </div>
      <div className="max-w-4xl">
        <BriefForm action={createBrief} campaigns={campaigns} categories={touchpoints.map((t) => t.name)} cancelHref="/briefing" clientTargets={clientTargets}
          defaults={campaign ? { campaign_id: campaign, client: campaigns.find((c) => c.id === campaign)?.client ?? null } : undefined} />
      </div>
    </>
  );
}
