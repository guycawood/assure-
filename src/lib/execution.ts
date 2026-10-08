// Execution+ pure logic and labels (no I/O). Ported from the Base44 recceCalc.js and retailMetrics.ts; the database
// computes the stored values (units_fit, GPS distance, audit score) with the same formulas.
import type { Tone } from "@/lib/srt";
import { haversineKm } from "@/lib/sourcing-emissions";

export type Meta = Record<string, { label: string; tone: Tone }>;

export const STAGE: Meta = {
  planned: { label: "Planned", tone: "neutral" },
  in_transit: { label: "In transit", tone: "info" },
  delivered: { label: "Delivered, to install", tone: "warn" },
  installed: { label: "Installed", tone: "accent" },
  audited: { label: "Audited", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
};
export const STAGES = ["planned", "in_transit", "delivered", "installed", "audited", "rejected"] as const;

export const AUDIT_STATUS: Meta = {
  pending: { label: "Audit pending", tone: "neutral" },
  passed: { label: "Passed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  needs_review: { label: "Needs review", tone: "warn" },
};

export const RECCE_STATUS: Meta = {
  draft: { label: "Draft", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "info" },
  production_ready: { label: "Production ready", tone: "ok" },
};

export const TICKET_STATUS: Meta = {
  open: { label: "Open", tone: "bad" },
  in_progress: { label: "In progress", tone: "warn" },
  resolved: { label: "Resolved", tone: "info" },
  closed: { label: "Closed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
export const TICKET_NEXT: Record<string, string[]> = { open: ["in_progress", "cancelled"], in_progress: ["resolved", "open", "cancelled"], resolved: ["closed", "in_progress"] };

export const VISIT_STATUS: Meta = {
  scheduled: { label: "Scheduled", tone: "info" },
  in_progress: { label: "In progress", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const GATE_STATUS: Meta = { pending: { label: "Not signed off", tone: "neutral" }, passed: { label: "Passed", tone: "ok" }, failed: { label: "Failed", tone: "bad" } };

export const SURFACE_TYPES = ["glass", "wall", "shelf", "floor", "ceiling", "counter", "gondola_end", "other"] as const;
export const STORE_TYPES = ["supermarket", "convenience", "horeca", "pharmacy", "duty_free", "forecourt", "department_store", "other"] as const;
export const ISSUE_TYPES = ["damage", "defect", "missing_part", "incorrect_install", "wear", "other"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const ROOT_CAUSES = ["installation", "material", "design", "handling", "environmental", "other"] as const;
export const VISIT_TYPES = ["installation", "maintenance", "audit", "recce", "other"] as const;
export const VISIT_OUTCOMES = ["successful", "issues_found", "failed", "pending"] as const;
export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "—");

/* ---------- Units fit (recceCalc.computeUnitsFit) ---------- */
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

export interface Space { available_width_cm?: number | null; available_height_cm?: number | null; available_depth_cm?: number | null; unit_width_cm?: number | null; unit_height_cm?: number | null; unit_depth_cm?: number | null }

export function computeUnitsFit(r: Space, unit?: { width_cm?: number | null; height_cm?: number | null; depth_cm?: number | null }) {
  const aw = pos(r.available_width_cm), ah = pos(r.available_height_cm), ad = pos(r.available_depth_cm);
  const uw = pos(unit ? unit.width_cm : r.unit_width_cm), uh = pos(unit ? unit.height_cm : r.unit_height_cm), ud = pos(unit ? unit.depth_cm : r.unit_depth_cm);
  if (!aw || !ah || !uw || !uh) return { fits: false, total: null as number | null, perW: 0, perH: 0, perD: 0, steps: ["Need the available width and height and the unit width and height."] };
  const perW = Math.floor(aw / uw), perH = Math.floor(ah / uh);
  let perD = 1;
  const steps = [`Width: floor(${aw} ÷ ${uw}) = ${perW}`, `Height: floor(${ah} ÷ ${uh}) = ${perH}`];
  if (ud && ad) { perD = Math.floor(ad / ud); steps.push(`Depth: floor(${ad} ÷ ${ud}) = ${perD}`); }
  const total = perW * perH * perD;
  steps.push(`Capacity = ${perW} × ${perH}${ud && ad ? ` × ${perD}` : ""} = ${total} unit${total === 1 ? "" : "s"}`);
  return { fits: total > 0, total, perW, perH, perD, steps };
}

/** How many surveyed outlets fit a candidate unit size (recceCalc.countFitting). */
export function countFitting(recces: Space[], candidate: { width_cm: number; height_cm: number; depth_cm?: number | null }) {
  const detail = recces.map((r) => ({ r, ...computeUnitsFit(r, candidate) }));
  const fitting = detail.filter((d) => d.fits && (d.total ?? 0) >= 1);
  return { outletsFit: fitting.length, outletsTotal: recces.length, totalUnits: fitting.reduce((s, d) => s + (d.total ?? 0), 0), detail };
}

/* ---------- GPS ---------- */
export function gpsDistanceM(lat?: number | null, lon?: number | null, outletLat?: number | null, outletLon?: number | null): number | null {
  if ([lat, lon, outletLat, outletLon].some((v) => v == null || !Number.isFinite(Number(v)))) return null;
  return Math.round(haversineKm(Number(lat), Number(lon), Number(outletLat), Number(outletLon)) * 10000) / 10;
}

/* ---------- Display score ---------- */
export interface Criterion { code: string; name: string; weight: number; guidance?: string }
/** Σ weight × score / 100 (score 0–100 per criterion). Mirrors execution_display_score; the server's number is the one stored. */
export function displayScore(criteria: Criterion[], scores: Record<string, number | null | undefined>) {
  const weightsTotal = criteria.reduce((s, c) => s + c.weight, 0);
  const complete = criteria.every((c) => scores[c.code] != null && Number.isFinite(Number(scores[c.code])));
  const total = criteria.reduce((s, c) => s + (c.weight * Number(scores[c.code] ?? 0)) / 100, 0);
  return { total: Math.round(total * 10) / 10, weightsTotal, weightsOk: weightsTotal === 100, complete };
}

/* ---------- Retail Grade metrics (folded in from Retail+ retailMetrics.ts) ---------- */
export interface DeploymentLike {
  id: string; outlet_id: string; stage: string; audit_status: string; audit_score: number | null; planned_date: string | null; installation_date: string | null;
  gps_flag: boolean | null; market: string; region: string; campaign_name?: string | null; job_id?: string;
}
export interface TicketLike { deployment_id: string | null; root_cause: string | null; status: string }

const ATTRIBUTABLE = new Set(["installation", "material", "design"]);

export function retailMetrics(deps: DeploymentLike[], tickets: TicketLike[], outletCount: number) {
  const installed = deps.filter((d) => ["installed", "audited", "rejected"].includes(d.stage));
  const withPlan = installed.filter((d) => d.planned_date && d.installation_date);
  const onTimeInstalls = withPlan.filter((d) => d.installation_date! <= d.planned_date!);
  const audited = deps.filter((d) => ["passed", "failed"].includes(d.audit_status));
  const passed = audited.filter((d) => d.audit_status === "passed");
  const scores = deps.map((d) => d.audit_score).filter((x): x is number => x != null).map(Number);
  const covered = new Set(deps.map((d) => d.outlet_id));
  const defective = installed.filter((d) => tickets.some((t) => t.deployment_id === d.id && t.root_cause && ATTRIBUTABLE.has(t.root_cause)));
  const r1 = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
  return {
    installs: installed.length,
    onTimeInstallPercent: r1(onTimeInstalls.length, withPlan.length), onTimeBasis: withPlan.length,
    auditPassRate: r1(passed.length, audited.length), audited: audited.length,
    avgScore: scores.length ? Math.round((10 * scores.reduce((a, b) => a + b, 0)) / scores.length) / 10 : null,
    coveragePercent: r1(covered.size, outletCount), outletsCovered: covered.size,
    defectRate: r1(defective.length, installed.length),
    gpsFlags: installed.filter((d) => d.gps_flag).length,
  };
}

/** Group deployments (by market, region, outlet or campaign) into score rows. */
export function gradeBy<T extends DeploymentLike>(deps: T[], key: (d: T) => string) {
  const m = new Map<string, T[]>();
  for (const d of deps) { const k = key(d) || "—"; m.set(k, [...(m.get(k) ?? []), d]); }
  return [...m.entries()].map(([k, ds]) => {
    const scored = ds.filter((d) => d.audit_score != null);
    const audited = ds.filter((d) => ["passed", "failed"].includes(d.audit_status));
    return {
      key: k, deployments: ds.length, audited: audited.length,
      avgScore: scored.length ? Math.round((10 * scored.reduce((s, d) => s + Number(d.audit_score), 0)) / scored.length) / 10 : null,
      passRate: audited.length ? Math.round((1000 * audited.filter((d) => d.audit_status === "passed").length) / audited.length) / 10 : null,
    };
  }).sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
}

/** Letter grade for a score (display only). */
export function grade(score: number | null | undefined): { letter: string; tone: Tone } {
  if (score == null) return { letter: "—", tone: "neutral" };
  if (score >= 90) return { letter: "A", tone: "ok" };
  if (score >= 80) return { letter: "B", tone: "ok" };
  if (score >= 70) return { letter: "C", tone: "warn" };
  if (score >= 50) return { letter: "D", tone: "bad" };
  return { letter: "E", tone: "bad" };
}

/* ---------- Row types ---------- */
export interface Outlet {
  id: string; client_id: string | null; client_name: string | null; name: string; outlet_code: string; address_line: string | null; city: string | null; postcode: string | null;
  region: string; market: string; market_name: string | null; latitude: number | null; longitude: number | null; store_type: string; status: string;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null;
  deployment_count: number; recce_count: number; open_tickets: number; avg_audit_score: number | null;
}
export interface Recce extends Space {
  id: string; recce_code: string; outlet_id: string; outlet_name: string; outlet_code: string; job_id: string | null; job_number: string | null; supplier_id: string | null; supplier_name: string | null;
  product_name: string | null; location_in_store: string | null; surface_type: string | null; units_fit: number | null; wall_space_available: boolean | null; power_outlet_nearby: boolean | null;
  recommended_width_cm: number | null; recommended_height_cm: number | null; recommended_depth_cm: number | null; recommended_notes: string | null;
  survey_date: string; surveyed_by_name: string | null; captured_by_vendor: boolean; status: string; region: string; market: string; notes: string | null; created_at: string;
}
export interface Deployment extends DeploymentLike {
  deployment_code: string; po_id: string; job_id: string; supplier_id: string; spec_id: string; spec_version_id: string | null; delivery_id: string | null; quantity: number;
  installed_quantity: number | null; installer_name: string | null; installed_by: string | null; installed_by_vendor: boolean | null; install_notes: string | null;
  gps_lat: number | null; gps_lon: number | null; gps_distance_m: number | null; gps_tolerance_m: number | null; audited_by: string | null; audited_at: string | null; notes: string | null;
  outlet_name: string; outlet_code: string; outlet_lat: number | null; outlet_lon: number | null; store_type: string; po_number: string; job_number: string; job_title: string;
  brand: string | null; client_name: string; supplier_name: string; spec_title: string; spec_version_name: string | null; delivery_number: string | null; delivery_status: string | null;
  installed_by_name: string | null; audited_by_name: string | null; created_at: string;
}
export interface Audit {
  id: string; deployment_id: string; scores: { code: string; name: string; weight: number; score: number; version?: number }[]; weights_total: number; total_score: number;
  pass_mark: number; result: string; notes: string | null; audited_by: string | null; audited_by_name: string | null; audited_at: string;
  deployment_code: string; outlet_id: string; outlet_name: string; job_id: string; job_number: string; campaign_name: string | null; brand: string | null; client_name: string;
  supplier_name: string; region: string; market: string;
}
export interface Ticket {
  id: string; ticket_code: string; deployment_id: string | null; deployment_code: string | null; outlet_id: string; outlet_name: string; supplier_id: string | null; supplier_name: string | null;
  issue_type: string; severity: string; status: string; root_cause: string | null; description: string; resolution_notes: string | null; reported_by_name: string | null;
  reported_at: string; resolved_at: string | null; closed_at: string | null; region: string; market: string; job_id: string | null;
}
export interface Visit {
  id: string; visit_code: string; visit_type: string; outlet_id: string; outlet_name: string; deployment_id: string | null; deployment_code: string | null; ticket_id: string | null;
  ticket_code: string | null; recce_id: string | null; recce_code: string | null; supplier_name: string | null; assigned_to: string | null; scheduled_date: string; completed_date: string | null;
  status: string; outcome: string | null; outcome_notes: string | null; region: string; market: string; notes: string | null;
}
export interface Gate { job_id: string; gate_key: string; seq: number; label: string; status: string; notes: string | null; signed_off_by_name: string | null; signed_off_at: string | null; document_count: number }
export interface CloseCheck { job_id: string; status: string; can_close: boolean; checks: { key: string; label: string; ok: boolean; detail: string; overridable: boolean }[] }
