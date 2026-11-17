import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About Impact Grade" };

export default function AboutImpactGrade() {
  return <ModuleAboutPage moduleKey="impact-grade" />;
}
