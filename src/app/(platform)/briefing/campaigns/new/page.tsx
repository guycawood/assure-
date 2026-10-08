import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { CampaignForm } from "@/components/briefing/campaign-form";
import { saveCampaign } from "../../actions";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaign() {
  await requireInternal();
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "Campaigns", href: "/briefing/campaigns" }, { label: "New" }]} title="New campaign"
        sub="The Shopper IQ performance taxonomy starts here: everything briefed, bought and measured links back to this campaign." />
      <div className="max-w-4xl"><CampaignForm action={saveCampaign.bind(null, null)} cancelHref="/briefing/campaigns" /></div>
    </>
  );
}
