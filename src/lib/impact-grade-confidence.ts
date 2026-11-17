// Level of confidence in an Impact Grade, based on data availability: how much of the grade's weighted inputs actually have data.
// (The record's "coverage" is that share, 0-100.) It does not look at how well each input is evidenced.
export type ConfidenceLevel = { label: "High" | "Medium" | "Low" | "None"; tone: "ok" | "warn" | "bad" | "neutral"; pct: number };

export function confidenceLevel(coverage: number | null | undefined): ConfidenceLevel {
  const pct = Math.max(0, Math.min(100, Math.round(Number(coverage ?? 0))));
  if (coverage === null || coverage === undefined || pct === 0) return { label: "None", tone: "neutral", pct: 0 };
  if (pct >= 80) return { label: "High", tone: "ok", pct };
  if (pct >= 50) return { label: "Medium", tone: "warn", pct };
  return { label: "Low", tone: "bad", pct };
}
