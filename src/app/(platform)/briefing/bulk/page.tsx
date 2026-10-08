import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBriefs, getLatestBulkRun, getSessionsForBulk, getSessionTranscript } from "@/lib/briefing-data";
import { canIdeate, type ConceptRow } from "@/lib/briefing";
import { PageHead } from "@/components/ui";
import { BulkIdeation } from "./bulk-ideation";

export const metadata: Metadata = { title: "Bulk ideation" };

export default async function BulkIdeationPage() {
  await requireInternal();
  const supabase = await createClient();
  const [briefs, run] = await Promise.all([getBriefs(supabase), getLatestBulkRun(supabase)]);
  const eligible = briefs.filter(canIdeate).map((b) => ({ id: b.id, title: b.title, brief_code: b.brief_code, client: b.client, brand: b.brand, market: b.market }));
  const saved: Record<string, ConceptRow[]> = {};
  if (run) {
    const sessions = await getSessionsForBulk(supabase, run.id);
    const transcripts = await Promise.all(sessions.map((s) => getSessionTranscript(supabase, s.id)));
    sessions.forEach((s, i) => { if (s.brief_id) saved[s.brief_id] = transcripts[i].concepts; });
  }
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "Bulk ideation" }]} title="Bulk ideation"
        sub="Run ideation across several approved briefs at once (three at a time) and compare the concepts side by side. Every run is saved." />
      <BulkIdeation eligible={eligible} saved={saved} savedRunAt={run?.created_at ?? null} />
    </>
  );
}
