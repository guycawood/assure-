import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm, Field } from "@/components/assure/action-form";
import { proposeEsgDecision, raiseEsgConcern, requestOnboardingApproval, setJointOnboarding, rejectApproval, signApproval, withdrawApproval } from "./actions";

export const metadata: Metadata = { title: "ESG and joint approvals" };

type Approval = {
  id: string; subject_type: string; supplier_id: string | null; supplier_name: string | null; summary: string; status: "pending" | "approved" | "rejected" | "withdrawn";
  requested_at: string; requested_by: string | null; proc_by: string | null; proc_at: string | null; proc_note: string | null; sust_by: string | null; sust_at: string | null; sust_note: string | null;
  rejected_side: string | null; reject_reason: string | null; decided_at: string | null; my_side: "procurement" | "sustainability" | null; can_sign: boolean;
};
type Flag = {
  id: string; supplier_id: string; supplier_name: string; job_number: string | null; document_title: string | null; severity: "low" | "medium" | "high"; summary: string; detail: string | null;
  status: "open" | "decision_pending" | "cleared" | "accepted" | "escalated"; raised_by: string | null; raised_at: string; proposed_decision: string | null; decision_note: string | null; decided_at: string | null;
};
const KIND: Record<string, string> = { onboarding: "Onboarding", esg_decision: "ESG decision", form_change: "Form change" };
const SIDE = { procurement: "Procurement director", sustainability: "Sustainability team" } as const;
const FLAG_TONE = { open: "warn", decision_pending: "info", cleared: "ok", accepted: "neutral", escalated: "bad" } as const;
const FLAG_LABEL = { open: "Open", decision_pending: "Decision waiting for sign-off", cleared: "Cleared", accepted: "Accepted with conditions", escalated: "Escalated" } as const;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

// Joint approvals (a procurement director and the Sustainability team both sign) and ESG concerns raised against vendors.
export default async function EsgPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireInternal();
  const { tab: t } = await searchParams;
  const tab = t === "flags" ? "flags" : t === "settings" ? "settings" : "approvals";
  const supabase = await createClient();
  const [appr, flagsRes, suppliers, jobs, canEsg, setting, canSet] = await Promise.all([
    supabase.rpc("joint_approvals_list", { p_status: null, p_supplier: null }),
    supabase.rpc("esg_flags_list", { p_supplier: null, p_status: null }),
    supabase.from("suppliers").select("id, name, onboarding_released").order("name").limit(1000),
    supabase.from("jobs").select("id, job_number, title").order("created_at", { ascending: false }).limit(100),
    supabase.rpc("division_can", { p_module: "assure", p_capability: "esg_review" }),
    supabase.rpc("division_setting", { p_module: "assure", p_key: "joint_onboarding_required", p_default: false }),
    supabase.rpc("division_can", { p_module: "assure", p_capability: "manage_libraries" }),
  ]);
  const approvals = (appr.data as Approval[] | null) ?? [];
  const flags = (flagsRes.data as Flag[] | null) ?? [];
  const S = (suppliers.data ?? []) as { id: string; name: string; onboarding_released: boolean }[];
  const J = (jobs.data ?? []) as { id: string; job_number: string; title: string }[];
  const pending = approvals.filter((a) => a.status === "pending");
  const tabLink = (key: string, label: string) => (
    <Link href={key === "approvals" ? "/assure/esg" : `/assure/esg?tab=${key}`} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>{label}</Link>
  );

  return (
    <>
      <PageHead crumbs={[{ label: "SRM", href: "/assure" }, { label: "ESG and joint approvals" }]} title="ESG and joint approvals"
        sub="Onboarding, ESG decisions and form changes need two signatures: a procurement director and the Sustainability team. Both approvers and the time are kept." />
      <nav className="flex gap-1 border-b border-line">{tabLink("approvals", `Joint approvals (${pending.length} waiting)`)}{tabLink("flags", `ESG concerns (${flags.filter((f) => f.status === "open" || f.status === "decision_pending").length} open)`)}{tabLink("settings", "Settings")}</nav>

      {tab === "approvals" && (
        <>
          <Panel title="Approvals" sub="Waiting first. A side can sign once; either side can reject with a reason.">
            {approvals.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing has been sent for joint approval yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {approvals.map((a) => (
                  <li key={a.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{KIND[a.subject_type] ?? a.subject_type}</b>{a.supplier_name && <Link className="hover:text-accent" href={`/assure/suppliers/${a.supplier_id}`}>{a.supplier_name}</Link>}
                      <Pill tone={a.status === "approved" ? "ok" : a.status === "pending" ? "warn" : a.status === "rejected" ? "bad" : "neutral"}>{a.status}</Pill>
                    </div>
                    <p>{a.summary}</p>
                    <div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
                      <p><b className="text-fg">Procurement director:</b> {a.proc_by ? `${a.proc_by}, ${day(a.proc_at)}${a.proc_note ? `: ${a.proc_note}` : ""}` : "not signed"}</p>
                      <p><b className="text-fg">Sustainability team:</b> {a.sust_by ? `${a.sust_by}, ${day(a.sust_at)}${a.sust_note ? `: ${a.sust_note}` : ""}` : "not signed"}</p>
                    </div>
                    {a.status === "rejected" && <p className="text-xs text-bad">Rejected by the {a.rejected_side === "sustainability" ? "Sustainability team" : "procurement director"}: {a.reject_reason}</p>}
                    <p className="text-xs text-muted">Asked by {a.requested_by ?? "someone"} on {day(a.requested_at)}</p>
                    {a.can_sign && (
                      <div className="flex flex-wrap items-start gap-4">
                        <ActionForm action={signApproval} hidden={{ id: a.id }} submit={`Approve as ${a.my_side ? SIDE[a.my_side] : ""}`} inline>
                          <input name="note" aria-label="Approval note" placeholder="Note (optional)" className="input min-w-[220px] py-1.5" />
                        </ActionForm>
                        <ActionForm action={rejectApproval} hidden={{ id: a.id }} submit="Reject" variant="secondary" inline>
                          <input name="note" required aria-label="Reason for rejecting" placeholder="Reason (needed to reject)" className="input min-w-[220px] py-1.5" />
                        </ActionForm>
                      </div>
                    )}
                    {a.status === "pending" && !a.can_sign && a.my_side && <p className="text-xs text-muted">You have signed. It waits for the other side.</p>}
                    {a.status === "pending" && (
                      <ActionForm action={withdrawApproval} hidden={{ id: a.id }} submit="Withdraw" variant="secondary" inline />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Card className="space-y-3 p-5">
            <h2 className="font-display text-lg font-semibold">Ask for an onboarding approval</h2>
            <p className="text-sm text-muted">A procurement director and the Sustainability team both approve before a vendor enters the pool. {setting.data === true ? "Release is blocked until this is approved." : "Release does not require it yet. Turn that on in Settings."}</p>
            <ActionForm action={requestOnboardingApproval} submit="Request approval" variant="secondary">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Vendor"><select id="supplier" name="supplier" required className="input"><option value="">Choose a vendor</option>{S.filter((x) => !x.onboarding_released).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                <Field label="What is being approved"><input id="summary" name="summary" placeholder="Onboard the vendor for packaging work" className="input" /></Field>
              </div>
            </ActionForm>
          </Card>
        </>
      )}

      {tab === "flags" && (
        <>
          {canEsg.data === true && (
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-lg font-semibold">Raise an ESG or compliance concern</h2>
              <ActionForm action={raiseEsgConcern} submit="Raise the concern" variant="secondary" resetOnOk>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Vendor"><select id="f-supplier" name="supplier" required className="input"><option value="">Choose a vendor</option>{S.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                  <Field label="Severity"><select id="f-sev" name="severity" defaultValue="medium" className="input"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
                  <Field label="Related job" hint="Optional."><select id="f-job" name="job" className="input"><option value="">None</option>{J.map((x) => <option key={x.id} value={x.id}>{x.job_number} · {x.title}</option>)}</select></Field>
                  <Field label="What is the concern?"><input id="f-sum" name="summary" required className="input" /></Field>
                </div>
                <Field label="Detail" hint="Evidence and what you saw."><textarea id="f-detail" name="detail" rows={2} className="input" /></Field>
              </ActionForm>
            </Card>
          )}
          <Panel title="Concerns" sub="Open first. Deciding one (clear, accept with conditions, escalate) needs a joint approval.">
            {flags.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No ESG concerns have been raised.</p> : (
              <ul className="divide-y divide-line text-sm">
                {flags.map((f) => (
                  <li key={f.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-semibold hover:text-accent" href={`/assure/suppliers/${f.supplier_id}`}>{f.supplier_name}</Link>
                      <Pill tone={f.severity === "high" ? "bad" : f.severity === "medium" ? "warn" : "neutral"}>{f.severity}</Pill>
                      <Pill tone={FLAG_TONE[f.status]}>{FLAG_LABEL[f.status]}</Pill>
                      {f.job_number && <span className="text-xs text-muted">Job {f.job_number}</span>}
                      {f.document_title && <span className="text-xs text-muted">Document: {f.document_title}</span>}
                    </div>
                    <p>{f.summary}</p>
                    {f.detail && <p className="text-muted">{f.detail}</p>}
                    {f.proposed_decision && <p className="text-xs text-muted">Proposed: <b>{f.proposed_decision}</b>. {f.decision_note}</p>}
                    <p className="text-xs text-muted">Raised by {f.raised_by ?? "someone"} on {day(f.raised_at)}{f.decided_at ? ` · decided ${day(f.decided_at)}` : ""}</p>
                    {f.status === "open" && canEsg.data === true && (
                      <ActionForm action={proposeEsgDecision} hidden={{ id: f.id }} submit="Propose this decision" variant="secondary" inline>
                        <select name="decision" aria-label="Decision" className="input py-1.5"><option value="clear">Clear it</option><option value="accept">Accept with conditions</option><option value="escalate">Escalate</option></select>
                        <input name="note" required aria-label="Why" placeholder="Why" className="input min-w-[260px] py-1.5" />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {tab === "settings" && (
        <Card className="space-y-3 p-5">
          <h2 className="font-display text-lg font-semibold">Onboarding release</h2>
          <p className="text-sm text-muted">When this is on, a vendor can only be released for use after a procurement director and the Sustainability team have both approved its onboarding. It is {setting.data === true ? "on" : "off"} now. Leave it off until the Sustainability team has people assigned in Roles and access.</p>
          {canSet.data === true ? (
            <ActionForm action={setJointOnboarding} hidden={{ value: setting.data === true ? "off" : "on" }} submit={setting.data === true ? "Turn it off" : "Turn it on"} variant="secondary">
              <Field label="Why"><input id="why" name="reason" required className="input" /></Field>
            </ActionForm>
          ) : <p className="text-sm text-muted">Only the SRM owners can change this.</p>}
        </Card>
      )}
    </>
  );
}
