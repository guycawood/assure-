// The Supplier Score inside the Impact Grade comes from the SRM supplier scorecard, never typed in on a spec.
// It is the average of the scorecard's sustainability criteria (CSR audit, EMS audit, FSC, Sedex, small and diverse,
// renewable energy), each scored 0-5 by the active scorecard methodology, scaled to 0-100. Which criteria count is the
// Watchtower parameter `supplier_criteria`; criteria the supplier has no data for are left out (and lower confidence).
import type { CriterionResult, FullMethodology } from "@/lib/scorecard";

export type SupplierPart = { key: string; label: string; score: number; display: string };
export type SupplierGradeScore = { score: number | null; parts: SupplierPart[]; missing: string[] };

/** `result` is scoreSupplier(m, inputs, true) from src/lib/scorecard.ts. */
export function supplierSustainabilityScore(m: Pick<FullMethodology, "criteria">, result: { criteria: CriterionResult[] }, criteria: string[]): SupplierGradeScore {
  const parts: SupplierPart[] = [];
  const missing: string[] = [];
  for (const key of criteria) {
    const c = m.criteria.find((x) => x.key === key);
    if (!c) continue;
    const r = result.criteria.find((x) => x.key === key);
    if (!r || r.score === null) { missing.push(c.label); continue; }
    parts.push({ key, label: c.label, score: Math.max(0, Math.min(100, r.score * 20)), display: r.display });
  }
  const score = parts.length ? Math.round((parts.reduce((a, p) => a + p.score, 0) / parts.length) * 10) / 10 : null;
  return { score, parts, missing };
}

