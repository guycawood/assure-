// Carbon intensity KPIs (Impact Grade.xlsx, Outputs sheet): reported beside the Impact Grade, not scored.
//   Economic Carbon Intensity = kg CO2e per EUR spent (purchase spend)
//   Physical Carbon Intensity = kg CO2e per kg of material
// Pure: no I/O, no imports. Roll-ups are total CO2e ÷ total spend (or weight), never an average of ratios.

export type IntensityRow = {
  spec_id: string; supplier_id?: string | null; co2e_kg: number | null; weight_kg: number | null; spend_eur: number | null;
  economic_intensity: number | null; physical_intensity: number | null;
};
export type IntensityRollup = { economic: number | null; physical: number | null; co2eKg: number; spendEur: number; weightKg: number; specs: number; measured: number };

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function rollupIntensity(rows: IntensityRow[]): IntensityRollup {
  let co2e = 0; let spend = 0; let co2eW = 0; let weight = 0; let measured = 0;
  for (const r of rows) {
    const c = num(r.co2e_kg); const s = num(r.spend_eur); const w = num(r.weight_kg);
    if (c !== null && s !== null && s > 0) { co2e += c; spend += s; measured++; }
    if (c !== null && w !== null && w > 0) { co2eW += c; weight += w; }
  }
  return {
    economic: spend > 0 ? co2e / spend : null, physical: weight > 0 ? co2eW / weight : null,
    co2eKg: co2e, spendEur: spend, weightKg: weight, specs: rows.length, measured,
  };
}

export function fmtIntensity(v: number | null | undefined, unit: "eur" | "kg" = "eur") {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const s = v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
  return `${s} kg CO2e/${unit === "eur" ? "€" : "kg"}`;
}
