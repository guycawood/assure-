import { redirect } from "next/navigation";

// execution is part of the orders section: its Watchtower is the section's Watchtower.
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  redirect(["/orders/watchtower", ...slug].join("/"));
}