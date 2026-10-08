import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/config";
import { formatDate, RFI_COLUMNS, type VendorRfi } from "@/lib/srt";
import { RfiForm } from "./rfi-form";
import { Stepper, type Step } from "@/components/stepper";
import { BadgeCheck, FileText, Search, UserPlus } from "lucide-react";

const VENDOR_STEPS: Step[] = [
  { label: "Registered", icon: UserPlus },
  { label: "Your information", icon: FileText },
  { label: "adm Indicia review", icon: Search },
  { label: "Approved", icon: BadgeCheck },
];

export const metadata: Metadata = { title: "Vendor portal" };
export const dynamic = "force-dynamic";

// Vendor-facing copy always says "vendor". Vendors never see internal SRT data.
export default async function VendorHome() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.is_admin || profile.user_type === "internal") redirect("/home");

  const supabase = await createClient();
  const [{ data: supplier }, { data: rfis }] = await Promise.all([
    profile.supplier_id ? supabase.from("suppliers").select("id, name").eq("id", profile.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("vendor_rfis").select(RFI_COLUMNS).order("sent_at", { ascending: false }).limit(1),
  ]);
  const rfi = ((rfis ?? []) as VendorRfi[])[0];
  const company = (supplier as { name: string } | null)?.name;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <div className="grid h-8 w-8 place-items-center rounded bg-accent font-display font-bold text-accent-fg">A+</div>
          <div className="font-display text-lg font-bold leading-none">
            Assure+ Vendor Portal
            {company && <span className="mt-0.5 block font-sans text-xs font-medium text-muted">{company}</span>}
          </div>
          <form action="/auth/signout" method="post" className="ml-auto">
            <button className="text-sm font-semibold text-accent underline underline-offset-2">{isDemoMode() ? "Switch user" : "Sign out"}</button>
          </form>
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6">
        {isDemoMode() && (
          <p className="rounded border border-line bg-warn-soft px-3 py-2 text-sm"><b>Demo mode.</b> You are seeing the vendor&apos;s view.</p>
        )}
        {rfi && rfi.status !== "cancelled" && (
          <div className="rounded-md border border-line bg-surface px-4 py-4">
            <Stepper
              steps={VENDOR_STEPS}
              current={rfi.status === "submitted" ? 2 : rfi.status === "approved" ? 3 : 1}
              failedAt={rfi.status === "rejected" ? 2 : undefined}
            />
          </div>
        )}
        {!profile.supplier_id ? (
          <section className="rounded-md border border-line bg-surface p-5 text-sm">
            <h1 className="mb-1 font-display text-xl font-bold">Your account isn&apos;t linked to a vendor yet</h1>
            <p className="text-muted">We couldn&apos;t match {profile.email} to a vendor. Ask your adm Indicia contact to send you an information request.</p>
          </section>
        ) : !rfi ? (
          <section className="rounded-md border border-line bg-surface p-5 text-sm">
            <h1 className="mb-1 font-display text-xl font-bold">Welcome</h1>
            <p className="text-muted">There&apos;s nothing for you to complete right now.</p>
          </section>
        ) : rfi.status === "sent" || rfi.status === "returned" ? (
          <>
            <div>
              <h1 className="font-display text-[1.6rem] font-bold leading-tight">Complete your vendor information</h1>
              <p className="text-muted">adm Indicia needs these details to onboard {company}. Please complete by {formatDate(rfi.expires_at)}.</p>
            </div>
            {rfi.status === "returned" && rfi.review_note && (
              <div className="rounded border border-line bg-warn-soft p-3 text-sm">
                <p className="font-semibold">adm Indicia asked for changes</p>
                <p>{rfi.review_note}</p>
              </div>
            )}
            <RfiForm rfiId={rfi.id} initial={rfi.data} email={profile.email} />
          </>
        ) : (
          <section className="rounded-md border border-line bg-surface p-5 text-sm">
            <h1 className="mb-1 font-display text-xl font-bold">
              {rfi.status === "submitted" ? "Thank you, your information is with adm Indicia" : rfi.status === "approved" ? "Your vendor information has been approved" : "Information request closed"}
            </h1>
            <p className="text-muted">
              {rfi.status === "submitted"
                ? `Submitted ${formatDate(rfi.submitted_at)}. Our procurement team is reviewing it and will contact you if anything else is needed.`
                : rfi.status === "approved"
                ? "We'll be in touch about the remaining onboarding steps, such as contracts and certifications."
                : "Contact your adm Indicia representative if you have questions."}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
