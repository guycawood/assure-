import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { optLabel, PA_ACTION_LABEL, PA_STATUS, paActions, PAYMENT_TERMS, SUPPLIER_TIER, type PreAssessment, type PreAssessmentReview } from "@/lib/assure";
import { formatDate, formatEur, personName } from "@/lib/srt";
import { PageHead, Panel, Pill } from "@/components/ui";
import { Facts, OptPill, SupplierLink } from "@/components/assure/bits";
import { Pipeline } from "@/components/assure/pipeline";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { paTransition } from "../../srm-actions";

export const metadata: Metadata = { title: "Pre-assessment" };

type Cert = { type?: string; cert_number?: string; audit_date?: string };
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : Array.isArray(v) ? v.join(", ") : String(v));

export default async function PreAssessmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("vendor_pre_assessments").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const a = data as PreAssessment;
  const [{ data: rv }, people] = await Promise.all([
    supabase.from("vendor_pre_assessment_reviews").select("*").eq("assessment_id", id).maybeSingle(),
    getInternalPeople(supabase),
  ]);
  const r = (rv ?? null) as PreAssessmentReview | null;
  const pMap = byId(people);
  const d = a.data ?? {};
  const acts = paActions(a.status);
  const isVm = me.is_admin || me.srt_role === "agent" || me.srt_role === "lead";
  const isProc = me.is_admin || me.srt_role === "procurement" || me.srt_role === "head";
  const certGroups = ["quality_certs", "environmental_certs", "health_safety_certs", "esg_certs", "ethical_audits", "product_transport_certs"]
    .map((k) => [k, ((d[k] as Cert[] | undefined) ?? []).filter((c) => c.cert_number || c.audit_date)] as const).filter(([, list]) => list.length);
  const needsFeedback = (act: string) => ["request_info", "vm_reject", "reject"].includes(act);

  return (
    <>
      <PageHead title={a.company_name} sub={[a.major_category, a.head_office_country, a.region].filter(Boolean).join(" · ")}
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Pre-assessments", href: "/assure/pre-assessments" }, { label: a.company_name }]}>
        <OptPill list={PA_STATUS} value={a.status} />
      </PageHead>
      <Pipeline status={a.status} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Company" className="xl:col-span-2">
          <div className="space-y-4 p-5">
            <Facts cols={4} items={[
              ["Supplier record", <SupplierLink key="s" id={a.supplier_id} name="Open supplier" />], ["Contact", [a.contact_name, a.contact_email].filter(Boolean).join(" · ")],
              ["Ownership", str(d.type_of_ownership)], ["Employees", str(d.total_employees)], ["Annual turnover", str(d.annual_turnover)],
              ["English speaking", str(d.english_speaking)], ["Company size (m²)", str(d.company_size_m2)], ["Factories", str(d.num_factories)],
              ["Factory country", str(d.factory_country)], ["Factory area", str(d.total_factory_area)], ["Clients", str(d.clients)], ["Major products", str(d.major_products)],
            ]} />
            {certGroups.map(([k, list]) => (
              <div key={k}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">{k.replace(/_/g, " ")}</p>
                <table className="w-full text-sm"><thead><tr><th className="th">Type</th><th className="th">Number</th><th className="th">Audit date</th></tr></thead>
                  <tbody>{list.map((c, i) => <tr key={i}><td className="td">{c.type}</td><td className="td">{c.cert_number}</td><td className="td">{c.audit_date ? formatDate(c.audit_date) : ""}</td></tr>)}</tbody></table>
              </div>
            ))}
            {a.feedback_to_vendor && <p className="rounded-lg bg-surface-2 p-3 text-sm"><b>Last message to the vendor:</b> {a.feedback_to_vendor}</p>}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Vendor-manager review" sub="SRT agents and leads">
            <div className="space-y-3 p-5 text-sm">
              {r?.vm_reviewed_by && <p className="text-muted">Last reviewed by {personName(pMap.get(r.vm_reviewed_by))}{r.vm_reviewed_at ? ` on ${formatDate(r.vm_reviewed_at)}` : ""}.</p>}
              {r?.vm_notes && <p><b>Notes:</b> {r.vm_notes}</p>}
              {acts.vm.length === 0 ? <p className="text-muted">Nothing to do at this stage.</p> : !isVm ? <p className="text-muted">A vendor manager acts at this stage.</p> : acts.vm.map((act) => (
                <ActionForm key={act} action={paTransition} submit={PA_ACTION_LABEL[act]} hidden={{ id: a.id, action: act }} variant={act === "vm_reject" ? "danger" : act === "vm_approve" ? "primary" : "secondary"}
                  confirm={act === "vm_reject" ? "Decline this vendor?" : undefined}>
                  {act !== "start_review" && <Field label="Internal notes"><textarea name="notes" rows={2} className="input" /></Field>}
                  {needsFeedback(act) && <Field label="Message to the vendor"><textarea name="feedback" rows={2} required className="input" /></Field>}
                </ActionForm>
              ))}
            </div>
          </Panel>

          <Panel title="Procurement" sub="In-market procurement and the Procurement head">
            <div className="space-y-3 p-5 text-sm">
              {r?.nti_proposed != null || r?.payment_terms_proposed ? (
                <Facts items={[
                  ["Proposed NTI", r?.nti_proposed != null ? `${r.nti_proposed}%` : null], ["Proposed terms", optLabel(PAYMENT_TERMS, r?.payment_terms_proposed)],
                  ["Spend forecast", r?.annual_spend_forecast != null ? formatEur(r.annual_spend_forecast) : null], ["Proposed tier", optLabel(SUPPLIER_TIER, r?.proposed_tier)],
                ]} />
              ) : null}
              {a.status === "onboarded" && r && (
                <p><Pill tone="ok">Onboarded</Pill> NTI {r.nti_agreed ?? "—"}% · {optLabel(PAYMENT_TERMS, r.payment_terms_agreed)} · {optLabel(SUPPLIER_TIER, r.tier_agreed)}
                  {r.onboarded_by && <span className="text-muted"> · confirmed by {personName(pMap.get(r.onboarded_by))}</span>}</p>
              )}
              {r?.procurement_notes && <p><b>Notes:</b> {r.procurement_notes}</p>}
              {acts.proc.length === 0 ? <p className="text-muted">{["submitted", "under_review"].includes(a.status) ? "Waiting for vendor-manager approval." : "Nothing to do at this stage."}</p>
                : !isProc ? <p className="text-muted">Procurement acts at this stage.</p> : acts.proc.map((act) => (
                  <ActionForm key={act} action={paTransition} submit={PA_ACTION_LABEL[act]} hidden={{ id: a.id, action: act }} variant={act === "reject" ? "danger" : "primary"}
                    confirm={act === "confirm_onboarding" ? "Confirm onboarding? The agreed terms are copied to the supplier record." : act === "reject" ? "Reject this vendor?" : undefined}>
                    {(act === "send_terms" || act === "confirm_onboarding") && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="NTI %"><input name="nti" type="number" step="0.1" min={0} max={100} defaultValue={r?.nti_proposed ?? ""} className="input" /></Field>
                        <Field label="Payment terms"><Select name="payment_terms" options={PAYMENT_TERMS} defaultValue={r?.payment_terms_proposed ?? "net_60"} required={act === "send_terms"} /></Field>
                        <Field label="Custom days"><input name="payment_terms_days" type="number" min={0} max={365} className="input" /></Field>
                        <Field label="Tier"><Select name="tier" options={SUPPLIER_TIER.filter((t) => t.value !== "conditional")} defaultValue={r?.proposed_tier ?? "approved"} /></Field>
                        {act === "send_terms" && <Field label="Annual spend forecast (€)" className="sm:col-span-2"><input name="annual_spend_forecast" type="number" min={0} step="1000" className="input" /></Field>}
                      </div>
                    )}
                    {act === "confirm_onboarding" && <p className="text-xs text-muted">Leave as proposed unless terms were renegotiated. Whoever approved at the vendor-manager stage can&apos;t confirm.</p>}
                    {act !== "start_procurement" && <Field label="Internal notes"><textarea name="notes" rows={2} className="input" /></Field>}
                    {(act === "send_terms" || act === "reject") && <Field label="Message to the vendor"><textarea name="feedback" rows={2} required={act === "reject"} className="input" /></Field>}
                  </ActionForm>
                ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
