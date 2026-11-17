// Creative RFI to panel suppliers (Global Business Transformation: Creative work needed, cr11 to cr12b).
export type RfiInviteStatus = "invited" | "confirmed" | "rejected" | "proposed" | "selected" | "not_selected";

export const RFI_INVITE_STATUS: Record<RfiInviteStatus, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }> = {
  invited: { label: "Waiting for an answer", tone: "warn" },
  confirmed: { label: "Will respond", tone: "info" },
  rejected: { label: "Declined", tone: "bad" },
  proposed: { label: "Proposal received", tone: "ok" },
  selected: { label: "Selected", tone: "ok" },
  not_selected: { label: "Not selected", tone: "neutral" },
};

export type RfiFile = { id: string; file_name: string; content_type?: string };

export type RfiInvite = {
  id: string; supplier_id: string; supplier_name: string; status: RfiInviteStatus; reject_reason: string | null; responded_at: string | null;
  ip_confirmed_at: string | null; proposal_note: string | null; proposed_at: string | null; selected_note: string | null; files: RfiFile[];
};

export type CreativeRfi = {
  id: string; title: string; supplier_brief: string; ip_rule: string; due_at: string; status: "open" | "closed"; created_at: string; invites: RfiInvite[];
};

/** What a supplier sees of its own invitation. Never the other suppliers or the client. */
export type VendorRfi = {
  id: string; status: RfiInviteStatus; reject_reason: string | null; ip_confirmed_at: string | null; proposal_note: string | null; proposed_at: string | null;
  title: string; supplier_brief: string; ip_rule: string; due_at: string; rfi_status: "open" | "closed"; files: { id: string; file_name: string }[];
};

// Samples on a creative brief (cr16 samples needed?, cr18 product sampling process).
export type SampleStatus = "requested" | "shipped" | "received" | "approved" | "changes_requested";

export const SAMPLE_STATUS: Record<SampleStatus, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }> = {
  requested: { label: "Requested", tone: "warn" },
  shipped: { label: "On its way", tone: "info" },
  received: { label: "Arrived, to review", tone: "info" },
  approved: { label: "Approved", tone: "ok" },
  changes_requested: { label: "Changes asked for", tone: "bad" },
};

export type BriefSample = {
  id: string; supplier_id: string; supplier_name: string; description: string; quantity: number; needed_by: string | null; round: number;
  status: SampleStatus; carrier: string | null; tracking_number: string | null; supplier_note: string | null; shipped_at: string | null;
  received_at: string | null; review_note: string | null; reviewed_at: string | null;
};

/** What a supplier sees of its own sample requests. */
export type VendorSample = {
  id: string; description: string; quantity: number; needed_by: string | null; round: number; status: SampleStatus; carrier: string | null;
  tracking_number: string | null; supplier_note: string | null; shipped_at: string | null; review_note: string | null;
};

// Final creative files sent to the client (cr19).
export type DeliveryFile = { id: string; file_name: string; content_type?: string };
export type BriefDelivery = { id: string; round: number; status: "draft" | "sent"; note: string | null; created_at: string; sent_at: string | null; files: DeliveryFile[] };
/** What the client sees: only sent deliveries. */
export type ClientDelivery = { id: string; round: number; note: string | null; sent_at: string; files: DeliveryFile[] };
