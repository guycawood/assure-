import { redirect } from "next/navigation";

// rfq is part of the sourcing section: its Watchtower is the section's Watchtower.
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  redirect(["/sourcing/watchtower", ...slug].join("/"));
}