import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About Watchtower" };

export default function AboutWatchtower() {
  return <ModuleAboutPage moduleKey="watchtower" standalone />;
}
