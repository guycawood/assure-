import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getJob } from "@/lib/sourcing-data";
import { getCloseCheck, getDeployments, getGates } from "@/lib/execution-data";
import { getDeliveries } from "@/lib/logistics-data";
import { AUDIT_STATUS, GATE_STATUS, STAGE } from "@/lib/execution";
import { DELIVERY_STATUS } from "@/lib/logistics";
import { FileList } from "@/components/file-list";
import { FileUpload } from "@/components/file-upload";
import { PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { JobStatusPill, StatusPill, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { closeJob, signOffGate } from "../../actions";

export const metadata: Metadata = { title: "Job quality gates" };

export default async function JobGatesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const job = await getJob(supabase, id);
  if (!job) notFound();
  const [gates, check, dels, deps] = await Promise.all([getGates(supabase, id), getCloseCheck(supabase, id), getDeliveries(supabase, { job_id: id }), getDeployments(supabase, { job_id: id })]);
  const live = !["closed", "cancelled"].includes(job.status);
  const firstOpen = gates.find((g) => g.status !== "passed")?.gate_key;
  const hardBlocked = check?.checks.some((c) => !c.ok && !c.overridable);
  const softBlocked = check?.checks.some((c) => !c.ok && c.overridable);

  return (
    <>
      <PageHead crumbs={[{ label: "Execution+", href: "/execution" }, { label: "Quality gates", href: "/execution/jobs" }, { label: job.job_number }]}
        title={`${job.job_number} · ${job.title}`} sub={`${job.client_name} · ${job.market} (${job.region})`}>
        <JobStatusPill status={job.status} />
        <Link className="text-sm font-semibold text-accent hover:underline" href={`/sourcing/jobs/${id}`}>Open in Sourcing+</Link>
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel title="Quality gates" sub="In order. Each needs its check sheet in the job bag and an internal sign-off.">
            <ol className="divide-y divide-line">
              <li className="flex items-start gap-3 px-5 py-4">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold">0</span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">Vendor onboarded</p>
                  <p className="text-muted">Checked in Assure+ for every supplier on the job&apos;s POs.</p>
                </div>
                {check && (check.checks.find((c) => c.key === "vendor")?.ok ? <Pill tone="ok">Passed</Pill> : <Pill tone="bad">Not met</Pill>)}
              </li>
              {gates.map((g) => (
                <li key={g.gate_key} className="space-y-3 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${g.status === "passed" ? "bg-ok text-white" : "bg-surface-2"}`}>{g.status === "passed" ? <MSymbol name="check" size={16} /> : g.seq}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold">{g.label}</p>
                      <p className="text-xs text-muted">{g.signed_off_at ? `Signed off by ${g.signed_off_by_name ?? "—"} ${fmtDateTime(g.signed_off_at)}` : `${g.document_count} document(s)`}{g.notes ? ` · ${g.notes}` : ""}</p>
                    </div>
                    <StatusPill meta={GATE_STATUS} value={g.status} />
                  </div>
                  <div className="grid gap-3 pl-10 lg:grid-cols-2">
                    <div className="space-y-2">
                      <FileList entityType="job_quality_gate" entityId={`${id}:${g.gate_key}`} empty="No check sheet yet." />
                      {live && g.status !== "passed" && <FileUpload module="execution" entityType="job_quality_gate" entityId={`${id}:${g.gate_key}`} label="Check sheet" compact />}
                    </div>
                    {live && g.status !== "passed" && (
                      firstOpen === g.gate_key ? (
                        <ActionForm action={signOffGate} hidden={{ id, gate: g.gate_key }} submit="Sign off" variant="secondary">
                          <Field label="Decision" htmlFor={`dec-${g.gate_key}`}><select id={`dec-${g.gate_key}`} name="decision" className="input"><option value="pass">Pass</option><option value="fail">Fail</option></select></Field>
                          <Field label="Notes (required to fail)" htmlFor={`n-${g.gate_key}`}><input id={`n-${g.gate_key}`} name="notes" className="input" /></Field>
                        </ActionForm>
                      ) : <p className="text-xs text-muted">Signed off after the earlier gates pass.</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Deliveries (Logistics+)">
            {dels.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No deliveries planned.</p> : (
              <table className="w-full text-sm"><thead><tr><Th>Delivery</Th><Th>Destination</Th><Th>Planned</Th><Th>PODs</Th><Th>Status</Th></tr></thead>
                <tbody>{dels.map((d) => (
                  <tr key={d.id}><Td><Link className="font-semibold hover:underline" href={`/logistics/deliveries/${d.id}`}>{d.delivery_number}</Link></Td><Td>{d.outlet_name ?? d.recipient_name ?? d.market}</Td>
                    <Td>{fmtDate(d.planned_delivery_date)}</Td><Td>{d.pods_verified}/{d.shipment_count} verified</Td><Td><StatusPill meta={DELIVERY_STATUS} value={d.status} /></Td></tr>))}</tbody></table>
            )}
          </Panel>
          <Panel title="Installs">
            {deps.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No installations on this job.</p> : (
              <table className="w-full text-sm"><thead><tr><Th>Deployment</Th><Th>Outlet</Th><Th>Stage</Th><Th>Audit</Th></tr></thead>
                <tbody>{deps.map((d) => (
                  <tr key={d.id}><Td><Link className="font-semibold hover:underline" href={`/execution/deployments/${d.id}`}>{d.deployment_code}</Link></Td><Td>{d.outlet_name}</Td>
                    <Td><StatusPill meta={STAGE} value={d.stage} /></Td><Td><StatusPill meta={AUDIT_STATUS} value={d.audit_status} /></Td></tr>))}</tbody></table>
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Close the job" sub="Checked again on the server when you close.">
            <ul className="divide-y divide-line text-sm">
              {(check?.checks ?? []).map((c) => (
                <li key={c.key} className="flex items-start gap-2 px-5 py-2.5">
                  <MSymbol name={c.ok ? "check_circle" : c.overridable ? "error" : "cancel"} size={18} className={c.ok ? "text-ok" : c.overridable ? "text-warn" : "text-bad"} />
                  <span><span className="font-semibold">{c.label}</span><span className="block text-xs text-muted">{c.detail}{!c.ok && c.overridable ? " · can be overridden with a reason" : ""}</span></span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line p-5 text-sm">
              {!live ? <p>This job is {job.status}{(job as { closed_at?: string | null }).closed_at ? ` (${fmtDate((job as { closed_at?: string | null }).closed_at)})` : ""}.</p>
                : hardBlocked ? <p className="text-muted">Clear the red items to close the job.</p>
                : (
                  <ActionForm action={closeJob} hidden={{ id }} submit={softBlocked ? "Close with override" : "Close job"} variant={softBlocked ? "danger" : "primary"} confirm="Close this job? This can't be undone here.">
                    {softBlocked && <Field label="Override reason" htmlFor="override_reason" hint="Recorded in the audit trail"><textarea id="override_reason" name="override_reason" rows={2} className="input" required /></Field>}
                  </ActionForm>
                )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
