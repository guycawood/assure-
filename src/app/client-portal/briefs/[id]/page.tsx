import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { portalContext, rpc, scope } from "@/lib/client-portal-data";
import { BRIEF_EVENT, BRIEF_STATUS, fmtDate, fmtMoney, isUuid, type BriefDetail } from "@/lib/client-portal";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Field, PreviewBanner } from "@/components/client/bits";
import { ClientActionForm } from "@/components/client/forms";
import { commentOnBrief } from "../../actions";

export const metadata: Metadata = { title: "Brief" };

export default async function ClientBrief({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const ctx = await portalContext(sp);
  const b = await rpc<BriefDetail>(ctx.supabase, "client_portal_brief", { p_brief: id, ...scope(ctx) });
  if (!b) notFound();
  const st = BRIEF_STATUS[b.status] ?? { label: b.status, tone: "neutral" as const };

  return (
    <>
      {ctx.preview && <PreviewBanner name={ctx.accounts.map((a) => a.name).join(", ")} />}
      <PageHead title={b.title} crumbs={[{ label: "Briefs", href: ctx.link("/client-portal/briefs") }, { label: b.brief_code }]}>
        <Pill tone={st.tone}>{st.label}</Pill>
      </PageHead>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
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

          <Panel title="Comments" sub="Your comments go straight to the adm Indicia team working on this brief">
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
