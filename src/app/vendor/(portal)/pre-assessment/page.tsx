import { requireVendorCompany, canAct, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { getFiles } from "@/components/file-list";
import { human, type PaData } from "@/lib/vendor";
import { Card, PageHead } from "@/components/ui";
import { VendorPaForm } from "@/components/vendor/vendor-pa-form";

export const metadata = { title: "Pre-assessment" };

type Pa = { id: string; company_name: string; contact_name: string | null; contact_email: string; major_category: string | null; head_office_country: string | null;
  data: PaData; status: string; feedback_to_vendor: string | null };

export default async function PreAssessmentPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const pa = (await rows<Pa>(supabase.from("vendor_pre_assessments").select("id, company_name, contact_name, contact_email, major_category, head_office_country, data, status, feedback_to_vendor").order("created_at", { ascending: false }).limit(1)))[0];
  const c = ctx.company;
  const initial: PaData = pa
    ? { ...pa.data, supplier_company_name: pa.data.supplier_company_name ?? pa.company_name, primary_contact_email: pa.data.primary_contact_email ?? pa.contact_email,
        primary_contact_name: pa.data.primary_contact_name ?? pa.contact_name ?? undefined, major_category: pa.data.major_category ?? pa.major_category ?? undefined,
        head_office_country: pa.data.head_office_country ?? pa.head_office_country ?? undefined }
    : { supplier_company_name: c.legal_entity ?? c.name, primary_contact_name: c.primary_contact_name ?? undefined, primary_contact_email: c.primary_contact_email ?? ctx.profile.email,
        head_office_country: c.market ?? undefined };
  const editable = (!pa || ["draft", "under_review"].includes(pa.status)) && canAct(ctx.permission);
  const photos = pa ? await getFiles("pre_assessment", pa.id) : [];

  return (
    <>
      <PageHead title="Pre-assessment" crumbs={[{ label: "Company profile", href: "/vendor/profile" }, { label: "Pre-assessment" }]}
        sub={editable ? "Work through the five sections. Save a draft any time; submit when you're done. You can still edit while adm Indicia's review is open." : `Status: ${human(pa?.status ?? "")}. These answers are with adm Indicia and can't be changed now.`} />
      {pa?.feedback_to_vendor && <Card className="bg-warn-soft p-4 text-sm"><b>adm Indicia asked:</b> {pa.feedback_to_vendor}</Card>}
      {!canAct(ctx.permission) && <p className="text-sm text-muted">Your account is view-only.</p>}
      <Card className="p-5">
        <VendorPaForm id={pa?.id ?? null} initial={initial} readOnly={!editable} supplierId={c.id} photoLabels={photos.map((f) => f.label ?? "")} />
      </Card>
    </>
  );
}
