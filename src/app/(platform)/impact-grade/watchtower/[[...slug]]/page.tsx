import type { Metadata } from "next";
import { WatchtowerRoute } from "@/components/watchtower/watchtower-route";
import type { LibrarySearch } from "@/components/watchtower/library-view";
import { ImpactGradeWatchtower } from "../overview";

export const metadata: Metadata = { title: "Impact Grade Watchtower" };

// Impact Grade Watchtower: its own overview (methodology health, the worked-example check), then the standard
// libraries, change requests and audit trail. Methodology, calculator and open issues have their own pages.
export default async function Page({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<LibrarySearch> }) {
  const { slug = [] } = await params;
  if (slug.length === 0) return <ImpactGradeWatchtower />;
  return <WatchtowerRoute module="impact-grade" base="/impact-grade/watchtower" slug={slug} sp={await searchParams} />;
}
