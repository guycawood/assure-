import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About Order Management+" };

export default function About() {
  return <ModuleAboutPage moduleKey="orders" />;
}
