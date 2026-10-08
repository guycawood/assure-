import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInternalPeople } from "@/lib/data";
import { getBriefs } from "@/lib/briefing-data";
import { personName } from "@/lib/srt";
import { ButtonLink, Card, PageHead, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { BriefTable } from "./brief-table";

export const metadata: Metadata = { title: "Briefing+" };

export default async function BriefingHome() {
  const me = await requireInternal();
  const supabase = await createClient();
  const [briefs, people] = await Promise.all([getBriefs(supabase), getInternalPeople(supabase)]);
  const toReview = briefs.filter((b) => b.status === "submitted" && b.approval_status === "pending" && b.created_by !== me.id).length;
  const n = (s: string) => briefs.filter((b) => b.status === s).length;

  return (
    <>
      <PageHead title="Briefing+" sub="Capture what the client needs as a brief per market, get it approved by a colleague, explore ideas with AI, then hand the chosen concept to Sourcing+.">
        <ButtonLink href="/briefing/campaign-ideation" variant="primary"><MSymbol name="lightbulb" size={18} /> Campaign ideation</ButtonLink>
        <ButtonLink href="/briefing/bulk"><MSymbol name="stacks" size={18} /> Bulk ideation</ButtonLink>
        <ButtonLink href="/briefing/new"><MSymbol name="add" size={18} /> New brief</ButtonLink>
      </PageHead>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Drafts" value={n("draft")} />
        <Stat label="Waiting for approval" value={n("submitted")} hint={toReview ? `${toReview} you can review` : "None for you"} tone={toReview ? "warn" : undefined} />
        <Stat label="In ideation" value={n("in_ideation")} />
        <Stat label="Spec created" value={n("spec_created")} tone="ok" />
        <Stat label="Archived" value={n("archived")} />
      </section>

      <Card className="flex flex-col gap-3 p-5 md:flex-row md:items-center">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#B776BC26] text-[#8a4f8f]"><MSymbol name="lightbulb" size={24} /></span>
        <div className="flex-1">
          <h2 className="font-bold">Start with a campaign objective</h2>
          <p className="text-sm text-muted">Not sure which product type fits? Describe the campaign goal and get a creative shortlist (displays, premiums, sampling units…), then turn your picks into a draft brief. Creative suggestion, not a data-verified prediction.</p>
        </div>
        <Link href="/briefing/campaigns" className="text-sm font-semibold text-accent hover:underline">See campaigns →</Link>
      </Card>

      <BriefTable briefs={briefs} people={Object.fromEntries(people.map((p) => [p.id, personName(p)]))} />
    </>
  );
}
