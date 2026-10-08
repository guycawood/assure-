import type { Metadata } from "next";
import { WatchtowerRoute } from "@/components/watchtower/watchtower-route";
import type { LibrarySearch } from "@/components/watchtower/library-view";

export const metadata: Metadata = { title: "Shopper IQ Watchtower" };

// Shopper IQ module Watchtower: libraries, change requests and audit trail for this module.
export default async function Page({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<LibrarySearch> }) {
  const { slug = [] } = await params;
  return <WatchtowerRoute module="shopper-iq" base="/shopper-iq/watchtower" slug={slug} sp={await searchParams} />;
}