import type { Metadata } from "next";
import { WatchtowerRoute } from "@/components/watchtower/watchtower-route";
import type { LibrarySearch } from "@/components/watchtower/library-view";

export const metadata: Metadata = { title: "Logistics+ Watchtower" };

// Logistics+ module Watchtower: libraries, change requests and audit trail for this module.
export default async function Page({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<LibrarySearch> }) {
  const { slug = [] } = await params;
  return <WatchtowerRoute module="logistics" base="/logistics/watchtower" slug={slug} sp={await searchParams} />;
}