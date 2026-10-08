import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { moduleByKey } from "@/modules/registry";
import { ModuleLanding } from "../module-landing";

// Catches the planned modules (briefing, sourcing, logistics, execution, shopper-iq). Built modules have their own folders.
type Props = { params: Promise<{ module: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = moduleByKey((await params).module);
  return { title: m?.name ?? "Not found" };
}

export default async function PlannedModule({ params }: Props) {
  const m = moduleByKey((await params).module);
  if (!m || m.status !== "planned") notFound();
  return <ModuleLanding m={m} />;
}
