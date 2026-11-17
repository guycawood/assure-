import type { Metadata } from "next";
import { portalContext, rpc } from "@/lib/client-portal-data";
import { fmtMoney } from "@/lib/client-portal";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { PreviewBanner } from "@/components/client/bits";
import { ClientActionForm } from "@/components/client/forms";
import { SAMPLING_STATUS, type ClientSamplingJob, type SamplingFile } from "@/lib/sampling";
import { decideSample, decideSampleDrawing, decideSampleQuote } from "./actions";

export const metadata: Metadata = { title: "Samples" };

function Files({ files }: { files: SamplingFile[] }) {
  return <ul className="space-y-0.5">{files.map((f) => (
    <li key={f.id} className="flex items-center gap-1.5"><MSymbol name="description" size={16} className="text-muted" />
      <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{f.file_name}</a></li>
  ))}</ul>;
}

// Sample quotes, technical drawings and samples for the client's approval (RFP process). Approvers decide; viewers see.
export default async function ClientSamples({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const ctx = await portalContext(await searchParams);
  const jobs = ctx.preview ? [] : (await rpc<ClientSamplingJob[]>(ctx.supabase, "client_sampling_jobs", {})) ?? [];

  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title="Samples" sub="Sample quotes, technical drawings and samples for your approval, before an order is placed." />
      {ctx.preview ? <Card className="p-5"><Empty title="Turned off in preview" /></Card> : jobs.length === 0 ? (
        <Card className="p-5"><Empty title="Nothing here yet">When we send you a sample quote, a drawing to sign off or a sample to approve, it shows here.</Empty></Card>
      ) : (
        <ul className="space-y-3">
          {jobs.map((j) => {
            const st = SAMPLING_STATUS[j.status];
            const approver = j.role === "approver";
            return (
              <Card key={j.id} className="space-y-3 p-5 text-sm">
                <p className="flex flex-wrap items-center gap-2"><b>{j.job_title}</b> <span className="text-muted">{j.job_number} · {j.quantity} piece{j.quantity === 1 ? "" : "s"}</span> <Pill tone={st.tone}>{st.label}</Pill></p>
                <p>{j.description}</p>

                {j.status === "awaiting_client" && (
                  <div className="space-y-3 rounded-lg border border-line p-3">
                    <p className="font-semibold">Sample quote: {fmtMoney(j.quote_amount ?? 0, j.quote_currency ?? "EUR", 2)} · {j.quote_lead_days} days</p>
                    {j.quote_note && <p className="text-muted">{j.quote_note}</p>}
                    {approver ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <ClientActionForm action={decideSampleQuote} hidden={{ job_id: j.id, decision: "approve" }} submit="Approve the quote">
                          <label className="label" htmlFor={`po-${j.id}`}>Your purchase order number for the sample</label>
                          <input id={`po-${j.id}`} name="po" maxLength={80} className="input" />
                        </ClientActionForm>
                        <ClientActionForm action={decideSampleQuote} hidden={{ job_id: j.id, decision: "decline" }} submit="Do not accept" variant="secondary">
                          <label className="label" htmlFor={`why-${j.id}`}>Why is the quote not accepted?</label>
                          <textarea id={`why-${j.id}`} name="comment" rows={2} maxLength={4000} required className="input" />
                        </ClientActionForm>
                      </div>
                    ) : <p className="text-muted">Waiting for an approver on your team to decide.</p>}
                  </div>
                )}

                {j.drawing_sent_at && j.drawing_files.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-line p-3">
                    <p className="font-semibold">Technical drawing {j.drawing_approved === true ? <Pill tone="ok">Signed off</Pill> : j.drawing_approved === false ? <Pill tone="bad">Changes asked for</Pill> : <Pill tone="warn">Waiting for your sign-off</Pill>}</p>
                    <Files files={j.drawing_files} />
                    {j.drawing_approved === null && (approver ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <ClientActionForm action={decideSampleDrawing} hidden={{ job_id: j.id, decision: "approve" }} submit="Sign off the drawing">
                          <label className="label" htmlFor={`dok-${j.id}`}>Comment <span className="font-normal text-muted">(optional)</span></label>
                          <input id={`dok-${j.id}`} name="comment" maxLength={4000} className="input" />
                        </ClientActionForm>
                        <ClientActionForm action={decideSampleDrawing} hidden={{ job_id: j.id, decision: "decline" }} submit="Ask for changes" variant="secondary">
                          <label className="label" htmlFor={`dch-${j.id}`}>What should change?</label>
                          <textarea id={`dch-${j.id}`} name="comment" rows={2} maxLength={4000} required className="input" />
                        </ClientActionForm>
                      </div>
                    ) : <p className="text-muted">Waiting for an approver on your team to decide.</p>)}
                  </div>
                )}

                {j.status === "with_client" && (
                  <div className="space-y-2 rounded-lg border border-line p-3">
                    <p className="font-semibold">The sample is with you for approval</p>
                    {j.sample_files.length > 0 && <Files files={j.sample_files} />}
                    {approver ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <ClientActionForm action={decideSample} hidden={{ job_id: j.id, decision: "approve" }} submit="Approve the sample">
                          <label className="label" htmlFor={`sok-${j.id}`}>Comment <span className="font-normal text-muted">(optional)</span></label>
                          <input id={`sok-${j.id}`} name="comment" maxLength={4000} className="input" />
                        </ClientActionForm>
                        <ClientActionForm action={decideSample} hidden={{ job_id: j.id, decision: "decline" }} submit="Ask for rework" variant="secondary">
                          <label className="label" htmlFor={`srw-${j.id}`}>What should be reworked?</label>
                          <textarea id={`srw-${j.id}`} name="comment" rows={2} maxLength={4000} required className="input" />
                        </ClientActionForm>
                      </div>
                    ) : <p className="text-muted">Waiting for an approver on your team to decide.</p>}
                  </div>
                )}
                {j.status === "client_approved" && <p className="text-ok">You approved this sample{j.client_sample_comment ? `: ${j.client_sample_comment}` : "."}</p>}
                {j.status === "rework" && <p className="text-muted">You asked for rework{j.client_sample_comment ? `: ${j.client_sample_comment}` : ""}. The supplier will send a new sample.</p>}
                {j.client_po_number && <p className="text-xs text-muted">Your PO for the sample: {j.client_po_number}</p>}
              </Card>
            );
          })}
        </ul>
      )}
    </>
  );
}
