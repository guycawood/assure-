// Shared by the feedback case queue and the case page.
export type CaseRow = {
  id: string; client_id: string; client_name: string; contact_name: string | null; owner: string | null; owner_name: string | null; source: "feedback" | "job_survey";
  score: number; scale: number; comment: string | null; severity: "high" | "medium"; status: "new" | "acknowledged" | "investigating" | "resolved" | "closed";
  ack_due: string; resolve_due: string; ack_overdue: boolean; resolve_overdue: boolean; age_days: number; escalated_at: string | null; cause: string | null; created_at: string;
};
export const STATUS_LABEL = { new: "New", acknowledged: "Acknowledged", investigating: "Investigating", resolved: "Resolved", closed: "Closed" } as const;
export const STATUS_TONE = { new: "warn", acknowledged: "info", investigating: "info", resolved: "ok", closed: "neutral" } as const;
