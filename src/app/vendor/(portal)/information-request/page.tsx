import { requireVendorCompany } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate, RFI_COLUMNS, type VendorRfi } from "@/lib/srt";
import { Card, PageHead } from "@/components/ui";
import { RfiForm } from "./rfi-form";

export const metadata = { title: "Your vendor information" };

// The onboarding information request (RFI) sent by adm Indicia. Vendors never see internal SRT data here.
export default async function InformationRequestPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const { data } = await supabase.from("vendor_rfis").select(RFI_COLUMNS).order("sent_at", { ascending: false }).limit(1);
  const rfi = ((data ?? []) as VendorRfi[])[0];

  return (
    <>
      <PageHead title="Your vendor information" crumbs={[{ label: "Dashboard", href: "/vendor" }, { label: "Information request" }]}
        sub={rfi && (rfi.status === "sent" || rfi.status === "returned") ? `adm Indicia needs these details to onboard ${ctx.company.name}. Please complete by ${formatDate(rfi.expires_at)}.` : undefined} />
      {!rfi || rfi.status === "cancelled" ? (
        <Card className="p-5 text-sm text-muted">There&apos;s no information request for you to complete right now.</Card>
      ) : rfi.status === "sent" || rfi.status === "returned" ? (
        <>
          {rfi.status === "returned" && rfi.review_note && (
            <div className="rounded-lg border border-line bg-warn-soft p-3 text-sm"><p className="font-semibold">adm Indicia asked for changes</p><p>{rfi.review_note}</p></div>
          )}
          {ctx.permission === "viewer" ? <Card className="p-5 text-sm text-muted">Your account is view-only. Ask your portal admin to complete this request.</Card>
            : <RfiForm rfiId={rfi.id} initial={rfi.data} email={ctx.profile.email} />}
        </>
      ) : (
        <Card className="p-5 text-sm">
          <h2 className="mb-1 font-display text-lg font-bold">
            {rfi.status === "submitted" ? "Thank you, your information is with adm Indicia" : rfi.status === "approved" ? "Your vendor information has been approved" : "Information request closed"}
          </h2>
          <p className="text-muted">
            {rfi.status === "submitted" ? `Submitted ${formatDate(rfi.submitted_at)}. Our procurement team is reviewing it and will contact you if anything else is needed.`
              : rfi.status === "approved" ? "We'll be in touch about the remaining onboarding steps, such as contracts and certifications." : "Contact your adm Indicia representative if you have questions."}
          </p>
        </Card>
      )}
    </>
  );
}
