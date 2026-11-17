import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDesignModel } from "@/lib/design-data";
import type { DeInput } from "@/lib/design-effectiveness";
import { PageHead } from "@/components/ui";
import { DesignCalculator } from "./calculator";

export const metadata: Metadata = { title: "Design calculator" };

export default async function DesignCalculatorPage() {
  await requireInternal();
  const supabase = await createClient();
  const [{ libs, criteria, settings }, { data: specs }, { data: bands }] = await Promise.all([
    getDesignModel(supabase),
    supabase.from("job_specs").select("id, title, impact_grade").order("title").limit(2000),
    supabase.from("library_records").select("code, data").eq("library_key", "pef_grade_bands").eq("status", "active"),
  ]);
  const graded = ((specs ?? []) as { id: string; title: string; impact_grade: number | null }[])
    .filter((s) => s.impact_grade !== null).slice(0, 300).map((s) => ({ id: s.id, title: s.title, impactGrade: Number(s.impact_grade) }));
  const letters = ((bands ?? []) as { code: string; data: Record<string, unknown> }[])
    .map((b) => ({ letter: String(b.data.letter ?? b.code), minScore: Number(b.data.min_score ?? 0), label: String(b.data.label ?? ""), confirmed: b.data.confirmed === true }));
  const presets = [...(libs.siq_de_examples ?? [])].map((e) => ({ code: String(e.code), label: `${e.code}: ${e.name}`, input: e.data.input as DeInput }));
  return (
    <>
      <PageHead crumbs={[{ label: "Shopper IQ", href: "/shopper-iq" }, { label: "Watchtower", href: "/shopper-iq/watchtower" }, { label: "Design calculator" }]}
        title="Design calculator" sub="Score an asset's design effectiveness against the governed criteria. Results update as you answer. Nothing is saved." />
      <DesignCalculator criteria={criteria} settings={settings} specs={graded} letters={letters} presets={presets} />
    </>
  );
}
