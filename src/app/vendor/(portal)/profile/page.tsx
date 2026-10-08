import { requireVendorCompany, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, PERMISSION_LABEL, statusTone, tierName } from "@/lib/vendor";
import { ButtonLink, Card, PageHead, Panel, Pill } from "@/components/ui";

export const metadata = { title: "Company profile" };

type Pa = { id: string; status: string; feedback_to_vendor: string | null; submitted_at: string | null; updated_at: string };

const PA_LABEL: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", under_review: "Being reviewed", vm_approved: "Approved by vendor management", vm_rejected: "Not approved",
  procurement_review: "With procurement", negotiation: "Terms being agreed", onboarded: "Onboarded", rejected: "Not approved",
};

export default async function ProfilePage() {
  const ctx = await requireVendorCompany();
  const c = ctx.company;
  const supabase = await createClient();
  const pas = await rows<Pa>(supabase.from("vendor_pre_assessments").select("id, status, feedback_to_vendor, submitted_at, updated_at").order("created_at", { ascending: false }).limit(1));
  const pa = pas[0];
  const field = (label: string, value: React.ReactNode) => (
    <div><p className="eyebrow">{label}</p><p className="mt-0.5 font-semibold">{value || <span className="font-normal text-muted">Not recorded</span>}</p></div>
  );

  return (
    <>
      <PageHead title="Company profile" sub="The details adm Indicia holds for your company. To change your registered details, send us a message and our team will update them." />
      <Panel title={c.name} sub={[c.supplier_code, c.category].filter(Boolean).join(" · ")} actions={<ButtonLink href="/vendor/messages">Ask for a change</ButtonLink>}>
        <div className="grid gap-5 p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {field("Legal entity", c.legal_entity)}
          {field("Trading name", c.trading_name)}
          {field("Status", <Pill tone={statusTone(c.status)}>{human(c.status)}</Pill>)}
          {field("Market", c.market)}
          {field("Region", c.region)}
          {field("Plan", tierName(c.subscription_tier))}
          {field("Primary contact", c.primary_contact_name)}
          {field("Primary contact email", c.primary_contact_email)}
          {field("Phone", c.contact_phone)}
          {field("Website", c.website && <a href={c.website} target="_blank" rel="noreferrer" className="text-accent hover:underline">{c.website}</a>)}
          {field("Address", c.address)}
          {field("Your access", ctx.permission ? PERMISSION_LABEL[ctx.permission] : "")}
        </div>
      </Panel>
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold">Pre-assessment questionnaire</p>
          <p className="text-sm text-muted">Five sections: supplier details, certifications, capabilities, factory and site photos. adm Indicia uses it to assess and onboard you.</p>
          {pa && <p className="mt-2 text-sm"><Pill tone={pa.status === "draft" ? "warn" : statusTone(pa.status === "onboarded" ? "completed" : pa.status)}>{PA_LABEL[pa.status] ?? human(pa.status)}</Pill>
            {pa.submitted_at && <span className="ml-2 text-xs text-muted">Submitted {formatDate(pa.submitted_at)}</span>}</p>}
          {pa?.feedback_to_vendor && <p className="mt-2 rounded-lg bg-warn-soft p-3 text-sm"><b>From adm Indicia:</b> {pa.feedback_to_vendor}</p>}
        </div>
        <ButtonLink href="/vendor/pre-assessment" variant="primary">{!pa ? "Start" : ["draft", "under_review"].includes(pa.status) ? "Continue" : "View answers"}</ButtonLink>
      </Card>
    </>
  );
}
