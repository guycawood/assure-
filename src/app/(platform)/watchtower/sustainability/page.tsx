import { redirect } from "next/navigation";

// Sustainability is its own module now; old links land on it.
export default function SustainabilityMoved() {
  redirect("/sustainability");
}
