import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About Sourcing+" };

export default function About() {
  return <ModuleAboutPage moduleKey="sourcing" />;
}
