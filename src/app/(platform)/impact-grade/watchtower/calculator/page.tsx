import { redirect } from "next/navigation";

// The PEF calculator now sits inside the Impact Grade calculator (section 1, PEF score).
export default function CalculatorPage() {
  redirect("/impact-grade/watchtower/grade");
}
