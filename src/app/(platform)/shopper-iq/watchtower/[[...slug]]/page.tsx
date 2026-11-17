import type { Metadata } from "next";
import { WatchtowerRoute } from "@/components/watchtower/watchtower-route";
import type { LibrarySearch } from "@/components/watchtower/library-view";
import { ShopperIqWatchtower } from "../overview";

export const metadata: Metadata = { title: "Shopper IQ Watchtower" };

// Shopper IQ Watchtower: its own overview (design effectiveness model health and the worked-example check), then the
// standard libraries, change requests and audit trail. Methodology, calculator and open items have their own pages.
export default async function Page({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<LibrarySearch> }) {
  const { slug = [] } = await params;
  if (slug.length === 0) return <ShopperIqWatchtower />;
  return <WatchtowerRoute module="shopper-iq" base="/shopper-iq/watchtower" slug={slug} sp={await searchParams} />;
}
