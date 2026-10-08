import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { moduleByKey } from "@/modules/registry";
import { ModuleAboutPage } from "../../module-about";

// About pages for modules without their own folder (the planned ones). Assure+ and Watchtower have their own.
type Props = { params: Promise<{ module: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = moduleByKey((await params).module);
  return { title: m ? `About ${m.name}` : "Not found" };
}

export default async function AboutModule({ params }: Props) {
  const m = moduleByKey((await params).module);
  if (!m) notFound();
  return <ModuleAboutPage moduleKey={m.key} standalone />;
}
