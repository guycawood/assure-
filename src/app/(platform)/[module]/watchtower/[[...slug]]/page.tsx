import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { moduleByKey } from "@/modules/registry";
import { WatchtowerRoute } from "@/components/watchtower/watchtower-route";
import type { LibrarySearch } from "@/components/watchtower/library-view";

type Props = { params: Promise<{ module: string; slug?: string[] }>; searchParams: Promise<LibrarySearch> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = moduleByKey((await params).module);
  return { title: m ? `${m.name} Watchtower` : "Not found" };
}

// Module Watchtower for modules without their own folder.
export default async function ModuleWatchtowerPage({ params, searchParams }: Props) {
  const { module, slug = [] } = await params;
  const m = moduleByKey(module);
  if (!m || m.key === "watchtower") notFound();
  return <WatchtowerRoute module={m.key} base={`${m.basePath}/watchtower`} slug={slug} sp={await searchParams} />;
}
