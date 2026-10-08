import type { Metadata } from "next";
import { WatchtowerRoute } from "@/components/watchtower/watchtower-route";
import type { LibrarySearch } from "@/components/watchtower/library-view";

export const metadata: Metadata = { title: "Watchtower" };

// Master Watchtower sections: libraries (every module), change requests (all), audit trail (all).
export default async function MasterWatchtowerSection({ params, searchParams }: { params: Promise<{ slug: string[] }>; searchParams: Promise<LibrarySearch> }) {
  const { slug } = await params;
  return <WatchtowerRoute base="/watchtower" slug={slug} sp={await searchParams} />;
}
