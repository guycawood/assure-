// Proofs on a purchase order (Global Business Transformation: QA and QC inspection, steps e to i). Pure types and labels.
import type { Tone } from "@/lib/srt";

export type ProofStatus = "draft" | "submitted" | "with_client" | "client_approved" | "changes_requested";
export type ProofFile = { id: string; name: string; type: string };
export type Proof = {
  id: string; po_id: string; round: number; kind: "digital" | "physical"; status: ProofStatus; supplier_note: string | null; tracking_number: string | null;
  submitted_at: string | null; cs_note: string | null; cs_checked_at: string | null; sent_to_client_at: string | null;
  client_comment: string | null; client_decided_at: string | null; files: ProofFile[];
};
export type PoProofs = { proof_waived: boolean; proof_waived_reason?: string | null; production_started_at: string | null; rounds: Proof[] };
export type ClientProof = Proof & { po_number: string; job_id: string; job_number: string; title: string; client_id: string; role: "approver" | "viewer" | "preview" | null };

export const PROOF_STATUS: Record<ProofStatus, { label: string; tone: Tone }> = {
  draft: { label: "Being prepared", tone: "neutral" },
  submitted: { label: "With client services", tone: "info" },
  with_client: { label: "With the client", tone: "warn" },
  client_approved: { label: "Approved", tone: "ok" },
  changes_requested: { label: "Changes requested", tone: "bad" },
};
export const PROOF_KIND = { digital: "Digital proof", physical: "Physical proof or sample" } as const;

/** The round that is still being worked on, if any. */
export const openRound = (p: PoProofs) => p.rounds.find((r) => ["draft", "submitted", "with_client"].includes(r.status)) ?? null;
export const approvedRound = (p: PoProofs) => p.rounds.find((r) => r.status === "client_approved") ?? null;
/** Production can be launched with an approved proof or when staff waived the proof. */
export const mayLaunch = (p: PoProofs) => !p.production_started_at && (p.proof_waived || !!approvedRound(p));
