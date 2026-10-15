import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFormSubmissions, getForms, getPerformance, getStakeholders } from "@/lib/crm-data";
import { toCsv } from "@/lib/crm-import";

// CSV exports of CRM data (internal staff only; rows come through the same RLS-protected views as the pages).
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const me = await getProfile();
  if (!me || !(me.is_admin || me.user_type === "internal")) return new Response("Not allowed", { status: 403 });
  const { kind } = await params;
  const supabase = await createClient();
  const day = new Date().toISOString().slice(0, 10);
  let csv: string, name: string;
  if (kind === "contacts") {
    const rows = await getStakeholders(supabase);
    csv = toCsv(rows as unknown as Record<string, unknown>[], [
      { key: "hubspot_id", label: "HubSpot record ID" }, { key: "client_name", label: "Client" }, { key: "account_market", label: "Account market" },
      { key: "full_name", label: "Name" }, { key: "job_title", label: "Job title" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
      { key: "owner_name", label: "Contact owner" }, { key: "owner_role", label: "Owner role" }, { key: "department", label: "Department" },
      { key: "relationship_rag", label: "Relationship RAG" }, { key: "last_contacted_on", label: "Last contacted" }, { key: "contact_frequency", label: "Frequency" },
      { key: "influence_level", label: "Influence" }, { key: "decision_level", label: "Decision maker" }, { key: "quadrant_name", label: "Stakeholder matrix" },
      { key: "services_offered_names", label: "Services offered" }, { key: "services_declined_names", label: "Services declined" },
      { key: "induction_required", label: "Induction required" }, { key: "receive_survey", label: "Receive survey" }, { key: "legal_basis", label: "Legal basis" },
      { key: "email_opt_out", label: "Opted out of email" }, { key: "left_at", label: "Left" }, { key: "last_reviewed_at", label: "Last reviewed" }, { key: "latest_nps", label: "Latest NPS" },
    ]);
    name = `crm-contacts-${day}.csv`;
  } else if (kind === "opportunities") {
    const rows = await getPerformance(supabase);
    csv = toCsv(rows as unknown as Record<string, unknown>[], [
      { key: "hubspot_id", label: "HubSpot record ID" }, { key: "opp_code", label: "Code" }, { key: "client_name", label: "Company" }, { key: "contact_name", label: "Contact" },
      { key: "title", label: "Name" }, { key: "service_name", label: "Service" }, { key: "stage", label: "Stage" }, { key: "next_step_name", label: "Next step" },
      { key: "next_steps", label: "Next steps detail" }, { key: "cs_lead_name", label: "CS lead" }, { key: "sme_name", label: "SME" }, { key: "total_budget", label: "Total budget" },
      { key: "currency", label: "Currency" }, { key: "probability", label: "Probability" }, { key: "weighted_budget", label: "Weighted budget" },
      { key: "expected_close", label: "Expected close" }, { key: "created_at", label: "Created" }, { key: "updated_at", label: "Last updated" }, { key: "needs_updating", label: "Needs updating" },
    ]);
    name = `crm-opportunities-${day}.csv`;
  } else if (kind === "form") {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const form = (await getForms(supabase)).find((f) => f.id === id);
    if (!form) return new Response("Form not found", { status: 404 });
    const subs = await getFormSubmissions(supabase, id);
    csv = toCsv(subs.map((s) => ({ ...s.data, created_at: s.created_at, consent: s.consent ? "yes" : "no", contact: s.contact_id ? (s.contact_created ? "created" : "matched") : "" })),
      [{ key: "created_at", label: "Submitted" }, ...form.fields.map((f) => ({ key: f.key, label: f.label })), { key: "consent", label: "Consent" }, { key: "contact", label: "Contact" }]);
    name = `form-${form.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${day}.csv`;
  } else {
    return new Response("Unknown export", { status: 404 });
  }
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}
