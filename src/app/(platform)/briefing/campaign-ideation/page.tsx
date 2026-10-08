import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { CreativeSuggestionLabel } from "@/components/briefing/labels";
import { CampaignIdeation } from "./campaign-ideation";

export const metadata: Metadata = { title: "Campaign ideation" };

export default async function CampaignIdeationPage() {
  await requireInternal();
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "Campaign ideation" }]} title="Campaign ideation"
        sub="Describe a campaign objective and get a shortlist of product types that could serve it, drawn from the touchpoint taxonomy and this client's history in Shopper IQ. Picking one creates a draft brief for you to check and submit." />
      <div><CreativeSuggestionLabel /></div>
      <CampaignIdeation />
    </>
  );
}
