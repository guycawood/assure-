// The sampling job in an RFP (Global Business Transformation: RFP process, r10 to r24).
export type SamplingStatus = "requested" | "quoted" | "awaiting_client" | "approved" | "po_issued" | "launched" | "shipped" | "received"
  | "accepted" | "rejected" | "with_client" | "client_approved" | "rework" | "cancelled";

type Tone = "ok" | "warn" | "bad" | "info" | "neutral";
export const SAMPLING_STATUS: Record<SamplingStatus, { label: string; tone: Tone }> = {
  requested: { label: "Sample quote requested", tone: "warn" },
  quoted: { label: "Sample quote received", tone: "info" },
  awaiting_client: { label: "Quote with the client", tone: "warn" },
  approved: { label: "Quote approved, PO to issue", tone: "info" },
  po_issued: { label: "Sample PO issued", tone: "info" },
  launched: { label: "Sample launched", tone: "info" },
  shipped: { label: "Sample on its way", tone: "info" },
  received: { label: "Arrived, to check", tone: "warn" },
  accepted: { label: "Passed the internal check", tone: "ok" },
  rejected: { label: "Rejected, PO invalidated", tone: "bad" },
  with_client: { label: "Sample with the client", tone: "warn" },
  client_approved: { label: "Approved by the client", tone: "ok" },
  rework: { label: "Rework asked for", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export type SamplingFile = { id: string; file_name: string };

/** One sampling job as the team sees it on the RFQ. */
export type SamplingJob = {
  id: string; job_number: string; supplier_id: string; supplier_name: string; description: string; quantity: number; status: SamplingStatus; round: number;
  quote_amount: number | null; quote_currency: string | null; quote_lead_days: number | null; quote_note: string | null;
  client_approval_required: boolean | null; client_po_number: string | null; client_reject_reason: string | null;
  sample_po_number: string | null; po_valid: boolean; drawing_sent_at: string | null; drawing_approved: boolean | null; drawing_comment: string | null;
  carrier: string | null; tracking_number: string | null; invoice_ref: string | null; review_note: string | null; reception_notice: string | null;
  client_sample_comment: string | null; cancelled_reason: string | null;
  drawing_files: SamplingFile[]; files: SamplingFile[]; events: { event: string; detail: string | null; at: string }[];
};

/** What a supplier sees: its own jobs only, nothing about the client. */
export type VendorSamplingJob = {
  id: string; job_number: string; description: string; quantity: number; status: SamplingStatus; round: number;
  quote_amount: number | null; quote_currency: string | null; quote_lead_days: number | null; client_reject_reason: string | null;
  sample_po_number: string | null; po_valid: boolean; drawing_sent_at: string | null; drawing_approved: boolean | null;
  carrier: string | null; tracking_number: string | null; invoice_ref: string | null; review_note: string | null; client_sample_comment: string | null;
  drawing_files: SamplingFile[]; files: SamplingFile[];
};

/** What the client sees, from the quote approval on. */
export type ClientSamplingJob = {
  id: string; job_number: string; description: string; quantity: number; status: SamplingStatus; round: number; job_title: string;
  quote_amount: number | null; quote_currency: string | null; quote_lead_days: number | null; quote_note: string | null;
  client_approval_required: boolean | null; client_po_number: string | null; client_reject_reason: string | null;
  drawing_sent_at: string | null; drawing_approved: boolean | null; drawing_comment: string | null;
  sent_to_client_at: string | null; client_sample_comment: string | null; role: "approver" | "viewer" | null;
  drawing_files: SamplingFile[]; sample_files: SamplingFile[];
};
