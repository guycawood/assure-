// Number display for footprint values, which run from 1e-10 (toxicity) to thousands (land use).
export function fmt(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 0.001 && a < 1e6) return Number(v.toPrecision(digits)).toLocaleString("en-GB", { maximumFractionDigits: 8 });
  return v.toExponential(digits - 1);
}

/** Same result as Excel: within one part in a million. */
export const matches = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-6, 1e-12);
