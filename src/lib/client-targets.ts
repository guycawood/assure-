// Client sustainability targets (CRM) applied to a brief for ideation. Pure: no I/O, no imports.
// The client's standing targets and the brief's own targets are merged so the stricter always wins:
// higher minimum recycled content, FSC if either asks, both statements kept, the client's excluded materials removed
// from the substrates ideation may suggest.

export type ClientTargets = {
  client_id: string; client_code?: string; client_name?: string;
  statement: string | null; min_recycled_pct: number | null; require_fsc: boolean; excluded_materials: string[];
  recyclable_required: boolean; reuse_expected: boolean; impact_grade_floor: number | null; reporting_obligations: string | null;
  source_contract_id?: string | null; source_contract_code?: string | null; updated_at?: string;
};

type BriefTargets = { sustainability_targets: string | null; min_recycled_pct: number | null; require_fsc: boolean };

export function parseClientTargets(raw: unknown): ClientTargets | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    client_id: String(r.client_id ?? ""), client_code: r.client_code as string | undefined, client_name: r.client_name as string | undefined,
    statement: (r.statement as string) || null, min_recycled_pct: num(r.min_recycled_pct), require_fsc: r.require_fsc === true,
    excluded_materials: Array.isArray(r.excluded_materials) ? r.excluded_materials.map(String).filter(Boolean) : [],
    recyclable_required: r.recyclable_required === true, reuse_expected: r.reuse_expected === true,
    impact_grade_floor: num(r.impact_grade_floor), reporting_obligations: (r.reporting_obligations as string) || null,
    source_contract_id: (r.source_contract_id as string) ?? null, source_contract_code: (r.source_contract_code as string) ?? null, updated_at: r.updated_at as string | undefined,
  };
}

/** Plain-English lines for the client's targets (brief page, ideation prompt, Client Portal). */
export function targetLines(t: ClientTargets): string[] {
  return [
    t.statement,
    t.min_recycled_pct !== null ? `At least ${t.min_recycled_pct}% recycled content` : null,
    t.require_fsc ? "FSC certified materials" : null,
    t.excluded_materials.length ? `Never use: ${t.excluded_materials.join(", ")}` : null,
    t.recyclable_required ? "Recyclable at end of life" : null,
    t.reuse_expected ? "Designed for reuse" : null,
    t.impact_grade_floor !== null ? `Impact Grade at least ${t.impact_grade_floor} of 100` : null,
  ].filter((x): x is string => !!x);
}

/** The brief as ideation should see it: the client's targets folded in, stricter wins. */
export function withClientTargets<B extends BriefTargets>(brief: B, t: ClientTargets | null): B {
  if (!t) return brief;
  const lines = targetLines(t);
  const statement = [lines.length ? `Client commitments (CRM): ${lines.join("; ")}.` : null, brief.sustainability_targets].filter(Boolean).join("\n");
  const pcts = [brief.min_recycled_pct, t.min_recycled_pct].filter((x): x is number => x !== null && x !== undefined);
  return {
    ...brief,
    sustainability_targets: statement || null,
    min_recycled_pct: pcts.length ? Math.max(...pcts) : null,
    require_fsc: brief.require_fsc || t.require_fsc,
  };
}

/** Where the brief is weaker than the client's standing targets (shown on the brief so the team can correct it). */
export function briefGaps(brief: BriefTargets, t: ClientTargets | null): string[] {
  if (!t) return [];
  const gaps: string[] = [];
  if (t.min_recycled_pct !== null && (brief.min_recycled_pct === null || brief.min_recycled_pct < t.min_recycled_pct)) {
    gaps.push(`The client asks for at least ${t.min_recycled_pct}% recycled content; the brief says ${brief.min_recycled_pct ?? "nothing"}.`);
  }
  if (t.require_fsc && !brief.require_fsc) gaps.push("The client requires FSC certified materials; the brief does not.");
  return gaps;
}

/** Substrates ideation may suggest: drop any whose name or type matches an excluded material (case-insensitive). */
export function allowedSubstrates<S extends { name: string; data?: Record<string, unknown> | null }>(subs: S[], t: ClientTargets | null): S[] {
  const ex = (t?.excluded_materials ?? []).map((m) => m.trim().toLowerCase()).filter(Boolean);
  if (!ex.length) return subs;
  return subs.filter((s) => {
    const hay = `${s.name} ${String(s.data?.substrate_type ?? "")}`.toLowerCase().replace(/_/g, " ");
    return !ex.some((m) => hay.includes(m));
  });
}
