import { fmtIntensity } from "@/lib/carbon-intensity";

/** Economic Carbon Intensity (kg CO2e per € of purchase spend), shown beside the Impact Grade. */
export function IntensityChip({ economic, physical, title }: { economic: number | null | undefined; physical?: number | null; title?: string }) {
  const t = title ?? `Economic Carbon Intensity: kg CO2e per € of purchase spend${physical != null ? ` · physical ${fmtIntensity(physical, "kg")}` : ""}. Material CO2e only until PEF climate figures are stored per spec.`;
  return (
    <span title={t} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line px-1.5 py-0.5 text-[0.7rem] font-semibold leading-none text-muted">
      <span aria-hidden>CO2e</span>{economic != null ? fmtIntensity(economic).replace(" kg CO2e", " kg") : "–/€"}
    </span>
  );
}
