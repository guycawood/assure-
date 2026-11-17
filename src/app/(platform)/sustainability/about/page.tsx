import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About Sustainability" };

export default function AboutSustainability() {
  return <ModuleAboutPage moduleKey="sustainability" />;
}
