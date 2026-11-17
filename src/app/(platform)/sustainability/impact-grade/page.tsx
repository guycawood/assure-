import { redirect } from "next/navigation";

// Impact Grade now lives at /impact-grade, inside Sustainability.
export default function ImpactGradeMoved() {
  redirect("/impact-grade");
}
