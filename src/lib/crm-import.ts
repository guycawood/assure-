// HubSpot import and CSV export helpers (pure, no I/O; used in the browser and on the server).

export type ImportKind = "companies" | "contacts" | "deals" | "performance";

/** CRM fields each import fills, with the HubSpot export headers that map to them by default. */
export const IMPORT_FIELDS: Record<ImportKind, { key: string; label: string; required?: boolean; hubspot: string[] }[]> = {
  companies: [
    { key: "hubspot_id", label: "HubSpot record ID", hubspot: ["Record ID", "Company ID", "hs_object_id"] },
    { key: "name", label: "Company name", required: true, hubspot: ["Company name", "Name", "name"] },
    { key: "domain", label: "Website / domain", hubspot: ["Company Domain Name", "Website URL", "domain", "website"] },
    { key: "market", label: "Country", hubspot: ["Country/Region", "Country", "country"] },
    { key: "sector", label: "Industry", hubspot: ["Industry", "industry"] },
    { key: "currency", label: "Currency", hubspot: ["Currency"] },
  ],
  contacts: [
    { key: "hubspot_id", label: "HubSpot record ID", hubspot: ["Record ID", "Contact ID", "hs_object_id"] },
    { key: "first_name", label: "First name", hubspot: ["First Name", "firstname"] },
    { key: "last_name", label: "Last name", hubspot: ["Last Name", "lastname"] },
    { key: "full_name", label: "Full name", hubspot: ["Full Name", "Name"] },
    { key: "email", label: "Email", hubspot: ["Email", "email"] },
    { key: "phone", label: "Phone", hubspot: ["Phone Number", "phone"] },
    { key: "job_title", label: "Job title", hubspot: ["Job Title", "jobtitle"] },
    { key: "company", label: "Company name", required: true, hubspot: ["Associated Company", "Company Name", "company"] },
    { key: "company_hubspot_id", label: "Company record ID", hubspot: ["Associated Company IDs", "Associated Company ID"] },
    { key: "market", label: "Country", hubspot: ["Country/Region", "Country"] },
    { key: "owner_email", label: "Contact owner (email)", hubspot: ["Contact owner", "HubSpot Owner Email", "Contact Owner Email"] },
    { key: "department", label: "Department", hubspot: ["Department"] },
    { key: "legal_basis", label: "Legal basis", hubspot: ["Legal basis for processing contact's data", "Legal basis"] },
    { key: "email_opt_out", label: "Opted out of email", hubspot: ["Unsubscribed from all email", "Opted out of all email", "Email opt-out"] },
    { key: "receive_survey", label: "Receive survey", hubspot: ["Receive survey"] },
  ],
  deals: [
    { key: "hubspot_id", label: "HubSpot record ID", hubspot: ["Record ID", "Deal ID", "hs_object_id"] },
    { key: "title", label: "Deal name", required: true, hubspot: ["Deal Name", "dealname"] },
    { key: "amount", label: "Amount", hubspot: ["Amount", "amount"] },
    { key: "currency", label: "Currency", hubspot: ["Currency", "deal_currency_code"] },
    { key: "stage", label: "Deal stage", hubspot: ["Deal Stage", "dealstage"] },
    { key: "close_date", label: "Close date", hubspot: ["Close Date", "closedate"] },
    { key: "company", label: "Company name", required: true, hubspot: ["Associated Company", "Company name"] },
    { key: "company_hubspot_id", label: "Company record ID", hubspot: ["Associated Company IDs"] },
    { key: "owner_email", label: "Deal owner (email)", hubspot: ["Deal owner", "HubSpot Owner Email"] },
    { key: "probability", label: "Probability", hubspot: ["Deal probability", "hs_deal_stage_probability"] },
  ],
  performance: [
    { key: "hubspot_id", label: "HubSpot record ID", hubspot: ["Record ID", "hs_object_id"] },
    { key: "title", label: "Name", required: true, hubspot: ["Name", "Client Stakeholder Performance Name", "Opportunity"] },
    { key: "company", label: "Company", hubspot: ["Company", "Associated Company"] },
    { key: "contact_email", label: "Contact email", required: true, hubspot: ["Contact", "Contact email", "Associated Contact Email"] },
    { key: "service", label: "Service", hubspot: ["Service"] },
    { key: "stage", label: "Stage", hubspot: ["Stage"] },
    { key: "next_steps", label: "Next steps", hubspot: ["Next steps", "Next Steps"] },
    { key: "cs_lead_email", label: "CS lead (email)", hubspot: ["CS Lead", "CS lead"] },
    { key: "sme_email", label: "SME (email)", hubspot: ["SME"] },
    { key: "amount", label: "Total budget", hubspot: ["Total budget", "Total Budget"] },
    { key: "probability", label: "Probability", hubspot: ["Probability"] },
    { key: "currency", label: "Currency", hubspot: ["Currency"] },
  ],
};

/** RFC 4180-ish CSV parser (quotes, doubled quotes, CR/LF). Returns rows of cells; strips a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** Header -> CRM field, using the HubSpot defaults (case-insensitive). Unknown headers map to "". */
export function defaultMapping(kind: ImportKind, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const hit = IMPORT_FIELDS[kind].find((f) => f.hubspot.some((x) => x.toLowerCase() === h.trim().toLowerCase()) || f.key === h.trim().toLowerCase());
    out[h] = hit?.key ?? "";
  }
  return out;
}

/** Rows of cells -> objects keyed by CRM field, using the mapping. Empty cells are dropped. */
export function mapRows(rows: string[][], headers: string[], mapping: Record<string, string>): Record<string, string>[] {
  return rows.map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      const k = mapping[h];
      const v = (r[i] ?? "").trim();
      if (k && v !== "") o[k] = v;
    });
    // HubSpot exports owners as "Name (email)" or just an email: keep the email.
    for (const k of ["owner_email", "cs_lead_email", "sme_email", "contact_email"]) {
      const m = o[k]?.match(/[^\s<>()]+@[^\s<>()]+/);
      if (m) o[k] = m[0];
    }
    return o;
  });
}

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Objects -> CSV text with the given columns (BOM so Excel reads UTF-8). */
export function toCsv(rows: Record<string, unknown>[], cols: { key: string; label: string }[]): string {
  return "﻿" + [cols.map((c) => cell(c.label)).join(","), ...rows.map((r) => cols.map((c) => cell(r[c.key])).join(","))].join("\r\n");
}
