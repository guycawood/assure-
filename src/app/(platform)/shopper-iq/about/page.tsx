import type { Metadata } from "next";
import { ModuleAboutPage } from "../../module-about";

export const metadata: Metadata = { title: "About Shopper IQ" };

export default function AboutShopperIq() {
  return <ModuleAboutPage moduleKey="shopper-iq" />;
}
