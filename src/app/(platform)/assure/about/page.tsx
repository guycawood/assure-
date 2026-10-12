import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About SRM" };

export default function AboutAssure() {
  return <ModuleAboutPage moduleKey="assure" />;
}
