import { redirect } from "next/navigation";

// Impact Grade is part of Sustainability; its About is the Sustainability About.
export default function ImpactGradeAbout() {
  redirect("/sustainability/about");
}
