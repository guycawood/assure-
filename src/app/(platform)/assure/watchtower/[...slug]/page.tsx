import type { Metadata } from "next";
import { WatchtowerRoute } from "@/components/watchtower/watchtower-route";
import type { LibrarySearch } from "@/components/watchtower/library-view";

export const metadata: Metadata = { title: "Assure+ Watchtower" };

// Assure+ Watchtower sections (the overview with the scoring methodology is ../page.tsx).
export default async function AssureWatchtowerSection({ params, searchParams }: { params: Promise<{ slug: string[] }>; searchParams: Promise<LibrarySearch> }) {
  const { slug } = await params;
  return <WatchtowerRoute module="assure" base="/assure/watchtower" slug={slug} sp={await searchParams} />;
}
