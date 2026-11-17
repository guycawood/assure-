import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPefIndex } from "@/lib/pef-data";
import { PageHead } from "@/components/ui";
import { GradeCalculator } from "./grade-calculator";
import { pefOptions } from "../calculator/pef-options";

export const metadata: Metadata = { title: "Impact Grade calculator" };

// One calculator: section 1 works out the PEF score (the Anthesis PEF model), section 2 the Impact Grade, with the
// PEF score as half of it. Nothing is saved.
export default async function GradePage() {
  await requireInternal();
  const supabase = await createClient();
  const { libs } = await getPefIndex(supabase);
  const pick = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, (libs[k] ?? []).map((r) => ({ code: r.code, name: r.name, data: r.data }))]));
  return (
    <>
      <PageHead crumbs={[{ label: "Impact Grade", href: "/impact-grade" }, { label: "Watchtower", href: "/impact-grade/watchtower" }, { label: "Impact Grade calculator" }]}
        title="Impact Grade calculator" sub="One specification, two calculations: the Impact Grade at the top, the PEF score (half the grade) at the bottom, both from the specification in between. Nothing is saved." />
      <GradeCalculator libs={pick("ig_subscores", "ig_impact_levels", "ig_option_scores", "ig_substrates", "ig_parameters", "pef_grade_bands", "pef_eol_materials")} pef={pefOptions(libs)} />
    </>
  );
}
