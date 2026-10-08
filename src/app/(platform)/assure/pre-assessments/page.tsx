import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rows } from "@/lib/assure-data";
import { PA_STATUS, type PreAssessment } from "@/lib/assure";
import { Pipeline } from "@/components/assure/pipeline";
import { formatDate } from "@/lib/srt";
import { Card, Empty, PageHead, Stat } from "@/components/ui";
import { Chips, OptPill } from "@/components/assure/bits";

export const metadata: Metadata = { title: "Pre-assessments" };

export default async function PreAssessments({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const all = (await rows<PreAssessment>(supabase, "vendor_pre_assessments", { order: "created_at" })).filter((a) => a.status !== "draft");
  const list = all.filter((a) => !sp.status || a.status === sp.status);
  const n = (...st: string[]) => all.filter((a) => st.includes(a.status)).length;
  return (
    <>
      <PageHead title="Vendor pre-assessments" sub="Two-stage review: a vendor manager checks capability, then procurement agrees terms. The same person can't approve both stages."
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Pre-assessments" }]} />
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Waiting for vendor manager" value={n("submitted", "under_review")} tone={n("submitted") ? "warn" : undefined} />
        <Stat label="With procurement" value={n("vm_approved", "procurement_review", "negotiation")} />
        <Stat label="Onboarded" value={n("onboarded")} tone="ok" />
        <Stat label="Declined or rejected" value={n("vm_rejected", "rejected")} />
      </section>
      <Chips param="status" options={PA_STATUS.filter((o) => o.value !== "draft").map((o) => ({ value: o.value, label: o.label, count: n(o.value) }))} active={sp.status} keep={{ status: sp.status }} />
      <Card>
        {list.length === 0 ? <Empty title="No pre-assessments here" /> : (
          <ul className="divide-y divide-line">
            {list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <Link href={`/assure/pre-assessments/${a.id}`} className="font-semibold hover:text-accent">{a.company_name}</Link>
                  <p className="text-xs text-muted">{[a.major_category, a.head_office_country, a.region].filter(Boolean).join(" · ")} · {a.contact_name ? `${a.contact_name}, ` : ""}{a.contact_email}</p>
                  <div className="mt-1.5"><Pipeline status={a.status} /></div>
                </div>
                <div className="text-right text-xs text-muted"><OptPill list={PA_STATUS} value={a.status} /><div className="mt-1">Submitted {formatDate(a.submitted_at ?? a.created_at)}</div></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
