import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { BRIEF_EVENT, BRIEF_STATUS, fmtDate, fmtMoney, isUuid, type BriefDetail } from "@/lib/client-portal";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Field, PreviewBanner } from "@/components/client/bits";
import { ClientActionForm } from "@/components/client/forms";
import { commentOnBrief, resubmitBrief } from "../../actions";
import { decideConcept, decideCreativeQuote } from "./actions";
import type { ClientDelivery } from "@/lib/creative-rfi";

type CreativeQuote = {
  basis: "fixed" | "hourly" | "daily"; rate: number | null; units: number | null; amount: number; currency: string; scope_note: string | null;
  status: "sent" | "approved" | "rejected"; reject_reason: string | null; client_po_number: string | null; can_decide: boolean;
};
const QUOTE_BASIS = { fixed: "Fixed fee", hourly: "Hourly rate", daily: "Daily rate" } as const;

export const metadata: Metadata = { title: "Brief" };

type ClientConcept = {
  id: string; name: string; creative_direction: string | null; spec_type: string | null; substrate: string | null;
  length: string | null; width: string | null; depth: string | null; unit: string | null; eco_score: string | null; eco_tag: string | null;
  rationale: string | null; approved_at: string | null; client_status: "pending" | "approved" | "changes_requested";
  client_comments: string | null; client_decided_at: string | null; sent_to_sourcing: boolean; role: "approver" | "viewer" | "preview" | null;
};
const CONCEPT_CLIENT: Record<string, { label: string; tone: "warn" | "ok" | "bad" }> = {
  pending: { label: "Waiting for your approval", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  changes_requested: { label: "Changes requested", tone: "bad" },
};

export default async function ClientBrief({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const ctx = await portalContext(sp);
  const b = await rpc<BriefDetail>(ctx.supabase, "client_portal_brief", { p_brief: id, ...scope(ctx) });
  if (!b) notFound();
  const st = BRIEF_STATUS[b.status] ?? { label: b.status, tone: "neutral" as const };
  const concepts = (await rpc<ClientConcept[]>(ctx.supabase, "client_portal_concepts", { p_brief: id, ...scope(ctx) })) ?? [];
  const quote = ctx.preview ? null : await rpc<CreativeQuote>(ctx.supabase, "client_creative_quote", { p_brief: id });
  const deliveries = ctx.preview ? [] : (await rpc<ClientDelivery[]>(ctx.supabase, "client_creative_deliveries", { p_brief: id })) ?? [];

  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title={b.title} crumbs={[{ label: "Briefs", href: ctx.link("/client-portal/briefs") }, { label: b.brief_code }]}>
        <Pill tone={st.tone}>{st.label}</Pill>
      </PageHead>

      {b.status === "with_client" && (
        <Card className="space-y-3 border-warn/40 bg-warn-soft p-5">
          <p className="flex items-center gap-2 font-semibold text-warn"><MSymbol name="reply" size={20} /> We need more from you before this brief can go ahead</p>
          {b.returned_reason && <p className="whitespace-pre-line text-sm">{b.returned_reason}</p>}
          {b.meeting_requested && <p className="text-sm font-semibold">The team would also like to set up a meeting with you. They will be in touch to arrange it.</p>}
          {ctx.preview ? <p className="text-sm text-muted">Resubmitting is turned off in preview.</p> : (
            <ClientActionForm action={resubmitBrief} hidden={{ brief_id: b.id }} submit="Resubmit the brief">
              <label className="label" htmlFor="resubmit-note">What has changed? <span className="font-normal text-muted">(optional)</span></label>
              <textarea id="resubmit-note" name="note" rows={3} maxLength={4000} className="input" placeholder="Answer the points above, or tell us what you added." />
            </ClientActionForm>
          )}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
        <Card className="p-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign">{b.campaign_name}</Field>
            <Field label="Region and market">{[b.region, b.market].filter(Boolean).join(" · ")}</Field>
            <Field label="Brand">{b.brand}</Field>
            <Field label="Product category">{b.product_category}</Field>
            <Field label="Budget">{b.budget_low == null && b.budget_high == null ? null : `${fmtMoney(b.budget_low, b.currency)} – ${fmtMoney(b.budget_high, b.currency)}`}</Field>
            <Field label="Target launch">{fmtDate(b.target_launch)}</Field>
          </dl>
          <dl className="mt-5 space-y-4 border-t border-line pt-5">
            <Field label="Objective">{b.objective}</Field>
            <Field label="Brief">{b.brief_text}</Field>
            <Field label="Target outlets">{b.target_outlets}</Field>
            <Field label="Sustainability">
              {[b.sustainability_targets, b.min_recycled_pct != null ? `At least ${b.min_recycled_pct}% recycled content` : null, b.require_fsc ? "FSC certified materials" : null].filter(Boolean).join(". ") || null}
            </Field>
          </dl>
        </Card>

        {quote && (
          <Panel title="Creative quote" sub="Our quote for the creative work on this brief. Creative work starts once an approver on your team approves it.">
            <div className="space-y-3 p-5 text-sm">
              <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                {fmtMoney(quote.amount, quote.currency)}
                <Pill tone={quote.status === "approved" ? "ok" : quote.status === "rejected" ? "bad" : "warn"}>
                  {{ sent: "Waiting for your approval", approved: "Approved", rejected: "Not accepted" }[quote.status]}
                </Pill>
              </p>
              <p className="text-muted">{QUOTE_BASIS[quote.basis]}{quote.basis !== "fixed" && quote.rate != null ? ` · ${quote.units} ${quote.basis === "hourly" ? "hours" : "days"} at ${fmtMoney(quote.rate, quote.currency)}` : ""}</p>
              {quote.scope_note && <p>{quote.scope_note}</p>}
              {quote.status === "approved" && quote.client_po_number && <p className="text-muted">Your PO: {quote.client_po_number}</p>}
              {quote.status === "rejected" && quote.reject_reason && <p className="text-muted">Your reason: {quote.reject_reason}</p>}
              {quote.status === "sent" && (quote.can_decide ? (
                <div className="space-y-3">
                  <ClientActionForm action={decideCreativeQuote} hidden={{ brief_id: b.id, decision: "approve" }} submit="Approve the quote">
                    <label className="label" htmlFor="quote-po">Your PO number <span className="font-normal text-muted">(if you have one)</span></label>
                    <input id="quote-po" name="po" maxLength={80} className="input" />
                  </ClientActionForm>
                  <ClientActionForm action={decideCreativeQuote} hidden={{ brief_id: b.id, decision: "reject" }} submit="Do not accept" variant="secondary">
                    <label className="label" htmlFor="quote-why">Why is the quote not accepted?</label>
                    <textarea id="quote-why" name="reason" rows={2} maxLength={4000} required className="input" />
                  </ClientActionForm>
                </div>
              ) : <p className="text-muted">Waiting for an approver on your team to decide.</p>)}
            </div>
          </Panel>
        )}

        {deliveries.length > 0 && (
          <Panel title="Final creative files" sub="The final files from us. If a file is corrected, the newest delivery is listed first.">
            <ul className="divide-y divide-line">
              {deliveries.map((d) => (
                <li key={d.id} className="space-y-1 px-5 py-3 text-sm">
                  <p className="font-semibold">Delivery {d.round} <span className="font-normal text-muted">· {fmtDate(d.sent_at)}</span></p>
                  {d.note && <p className="text-muted">{d.note}</p>}
                  <ul className="space-y-0.5">
                    {d.files.map((f) => (
                      <li key={f.id} className="flex items-center gap-1.5"><MSymbol name="description" size={16} className="text-muted" />
                        <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{f.file_name}</a></li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {concepts.length > 0 && (
          <Panel title="Concepts for your approval"
            sub="We have approved these concepts internally. An approver on your team signs them off before production sourcing starts.">
            <ul className="divide-y divide-line">
              {concepts.map((c) => {
                const cs = CONCEPT_CLIENT[c.client_status] ?? { label: c.client_status, tone: "neutral" as const };
                const size = [c.length, c.width, c.depth].filter(Boolean).join(" × ");
                return (
                  <li key={c.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="min-w-0 space-y-1 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">{c.name} <Pill tone={cs.tone}>{cs.label}</Pill>
                        {c.sent_to_sourcing && <Pill tone="info">In production sourcing</Pill>}</p>
                      {c.creative_direction && <p className="text-muted">{c.creative_direction}</p>}
                      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                        {c.substrate && <span><span className="text-muted">Material:</span> {c.substrate}</span>}
                        {size && <span><span className="text-muted">Size:</span> {size} {c.unit ?? ""}</span>}
                        {c.eco_score && <span><span className="text-muted">Indicative eco score:</span> {Math.round(Number(c.eco_score))}/100</span>}
                      </dl>
                      {c.rationale && <p className="text-xs text-muted">{c.rationale}</p>}
                      {c.client_decided_at && <p className="text-xs text-muted">Your decision · {fmtDate(c.client_decided_at)}{c.client_comments ? `: ${c.client_comments}` : ""}</p>}
                    </div>
                    <div>
                      {c.client_status !== "pending" ? null : ctx.preview ? (
                        <p className="text-sm text-muted">Waiting for the client&apos;s approver. Decisions are turned off in preview.</p>
                      ) : c.role !== "approver" ? (
                        <p className="text-sm text-muted">Waiting for an approver on your team to decide.</p>
                      ) : (
                        <div className="space-y-3">
                          <ClientActionForm action={decideConcept} hidden={{ concept_id: c.id, brief_id: b.id, decision: "approve" }} submit="Approve concept">
                            <label className="label" htmlFor={`ok-${c.id}`}>Comment <span className="font-normal text-muted">(optional)</span></label>
                            <input id={`ok-${c.id}`} name="comment" maxLength={4000} className="input" />
                          </ClientActionForm>
                          <ClientActionForm action={decideConcept} hidden={{ concept_id: c.id, brief_id: b.id, decision: "changes" }} submit="Request changes" variant="secondary">
                            <label className="label" htmlFor={`ch-${c.id}`}>What would you like changed?</label>
                            <textarea id={`ch-${c.id}`} name="comment" rows={2} maxLength={4000} required className="input" />
                          </ClientActionForm>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Progress">
            {b.timeline.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No updates yet.</p> : (
              <ol className="space-y-3 px-5 py-4">
                {b.timeline.map((e, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <MSymbol name="check_circle" size={18} className="text-ok" />
                    <span className="min-w-0 flex-1">{BRIEF_EVENT[e.event] ?? e.event.replace(/_/g, " ")}</span>
                    <span className="whitespace-nowrap text-xs text-muted">{fmtDate(e.at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Comments" sub="Your comments go straight to our team working on this brief">
            {b.comments.length > 0 && (
              <ul className="divide-y divide-line">
                {b.comments.map((c) => (
                  <li key={c.id} className="px-5 py-3">
                    <p className="text-xs text-muted"><b className="text-fg">{c.author_name}</b> · {fmtDate(c.created_at)}</p>
                    <p className="mt-0.5 whitespace-pre-line text-sm">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line px-5 py-4">
              {ctx.preview ? (
                <p className="text-sm text-muted">Commenting is turned off in preview.</p>
              ) : (
                <ClientActionForm action={commentOnBrief} hidden={{ brief_id: b.id }} submit="Send comment">
                  <label className="label" htmlFor="body">Add a comment</label>
                  <textarea id="body" name="body" rows={3} maxLength={4000} required className="input" placeholder="Questions, changes or feedback for the team" />
                </ClientActionForm>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
