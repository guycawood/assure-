import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About Briefing+" };

export default function AboutBriefing() {
  return <ModuleAboutPage moduleKey="briefing" />;
}
