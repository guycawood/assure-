import "server-only";
import type { PefInput, PefLibraryRows } from "@/lib/pef";
import type { PefOptions } from "./calculator";

/** Dropdown lists and worked-example presets for the PEF calculator, from the governed libraries. */
export function pefOptions(libs: PefLibraryRows): PefOptions {
  const names = (k: string, f: (d: Record<string, unknown>) => string) =>
    [...new Set((libs[k] ?? []).map((r) => f(r.data)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    substrates: names("pef_virgin_materials", (d) => String(d.substrate_name ?? "")),
    countries: [...(libs.pef_countries ?? [])].map((r) => ({ code: String(r.code), name: r.name })).sort((a, b) => a.name.localeCompare(b.name)),
    coatings: names("pef_coatings", (d) => String(d.coating_label ?? "")),
    printing: names("pef_process_labels", (d) => (d.kind === "printing" ? String(d.sourcing_hub_label) : "")),
    branding: names("pef_process_labels", (d) => (d.kind === "branding" ? String(d.sourcing_hub_label) : "")),
    periods: [...(libs.pef_usage_periods ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq)).map((r) => ({ label: String(r.code), hours: Number(r.data.hours) })),
    presets: [...(libs.pef_worked_examples ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq))
      .map((r) => ({ code: String(r.code), label: `${r.code}: ${r.name}`, input: r.data.input as PefInput, excel: r.data.expected as { totalGwp: number; singleScoreMpt: number } })),
  };
}
