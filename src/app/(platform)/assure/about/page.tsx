import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About Assure+" };

export default function AboutAssure() {
  return <ModuleAboutPage moduleKey="assure" />;
}
