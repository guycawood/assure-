import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInternalPeople } from "@/lib/data";
import {
  conceptDecisionRights, conceptPolicy, getBrief, getBriefConceptsInApproval, getBriefHistory, getCampaigns, getConceptAudit,
  getLatestSession, getLibrary, getSessionTranscript,
} from "@/lib/briefing-data";
import { getWhatWorked } from "@/lib/shopper-iq-data";
import { isAiConfigured } from "@/lib/ai/claude";
import { budgetRange, canIdeate, marketName, type Brief } from "@/lib/briefing";
import { ROLE_LABEL } from "@/components/approvals/labels";
import { ConceptActions } from "../concept-actions";
import { formatDate, personName } from "@/lib/srt";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { BriefStatusPill } from "@/components/briefing/labels";
import { BriefForm } from "@/components/briefing/brief-form";
import { ProgressTimeline, RevisionHistory } from "@/components/briefing/history";
import { WhatWorkedPanel } from "@/components/shopper-iq/what-worked";
import { ClientComments } from "@/components/client/client-comments";
import { duplicateBrief, updateBrief } from "../actions";
import { DuplicateDialog } from "@/components/repeat/duplicate-dialog";
import { ApprovalPanel, BriefActions } from "./brief-controls";
import { IdeationPanel } from "./ideation-panel";

export const metadata: Metadata = { title: "Brief" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <div className="mt-0.5 text-sm">{children || "—"}</div>
    </div>
  );
}

export default async function BriefDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string; from?: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const brief = await getBrief(supabase, id);
  if (!brief) notFound();

  const [history, people, session, whatWorked] = await Promise.all([
    getBriefHistory(supabase, id), getInternalPeople(supabase), getLatestSession(supabase, id),
    getWhatWorked(supabase, { client: brief.client, brand: brief.brand, market: brief.market }),
  ]);
  const transcript = session ? await getSessionTranscript(supabase, session.id) : { messages: [], concepts: [], allConcepts: [] };
  const [inApproval, policy] = await Promise.all([
    getBriefConceptsInApproval(supabase, id),
    conceptPolicy(supabase, { client_id: (brief as Brief & { client_id?: string | null }).client_id ?? null, market: brief.market, budget_high: brief.budget_high }),
  ]);
  const [decide, audit] = await Promise.all([
    conceptDecisionRights(supabase, [...inApproval, ...transcript.concepts]),
    getConceptAudit(supabase, inApproval.map((c) => c.id)),
  ]);
  const names = Object.fromEntries(people.map((p) => [p.id, personName(p)]));
  const name = (uid: string | null) => (uid ? names[uid] ?? "Someone" : "Demo data");
  const isAuthor = brief.created_by === me.id;
  const mayChange = isAuthor || me.is_admin;
  const editable = ["draft", "submitted", "in_ideation"].includes(brief.status) && mayChange;

  if (sp.edit && editable) {
    const [campaigns, touchpoints] = await Promise.all([getCampaigns(supabase), getLibrary(supabase, "touchpoint_types")]);
    return (
      <>
        <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: brief.brief_code, href: `/briefing/${id}` }, { label: "Edit" }]} title={`Edit: ${brief.title}`} />
        <div className="max-w-4xl">
          <BriefForm action={updateBrief.bind(null, id)} brief={brief} campaigns={campaigns} categories={touchpoints.map((t) => t.name)} cancelHref={`/briefing/${id}`} />
        </div>
      </>
    );
  }

  const pendingHandoffs = history.handoffs.filter((h) => h.status === "pending");
  // briefs_v predates the repeat link, so read it from the table.
  const { data: link } = await supabase.from("briefs").select("repeat_of_brief_id").eq("id", id).maybeSingle();
  const repeatOfId = (link as { repeat_of_brief_id: string | null } | null)?.repeat_of_brief_id ?? null;
  const [{ data: marketRows }, { data: repeatRow }] = await Promise.all([
    supabase.from("markets").select("code, name").order("name"),
    repeatOfId ? supabase.from("briefs").select("id, brief_code, title").eq("id", repeatOfId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const markets = (marketRows ?? []) as { code: string; name: string }[];
  const repeatOf = repeatRow as { id: string; brief_code: string; title: string } | null;
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: brief.brief_code }]} title={brief.title}
        sub={[brief.client, brief.brand, brief.market ? `${marketName(brief.market)} · ${brief.region ?? ""}` : null].filter(Boolean).join(" · ")}>
        <BriefActions id={id} status={brief.status} canEdit={editable} canSubmit={mayChange} canArchive={mayChange && !["archived", "spec_created"].includes(brief.status)} />
        <DuplicateDialog label="Duplicate for repeat order" title={`Duplicate ${brief.brief_code}`} submit="Create the repeat brief" action={duplicateBrief} hidden={{ id }}
          sub="A new draft with the same content, linked to this brief, for you to adjust and submit. The launch date, approval and ideation are not copied.">
          <div><label className="label" htmlFor="dup-title">Title</label><input id="dup-title" name="title" className="input" defaultValue={brief.title} maxLength={200} /></div>
          <div><label className="label" htmlFor="dup-market">Market</label>
            <select id="dup-market" name="market" className="input" defaultValue={brief.market ?? ""}>
              {markets.map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}
            </select>
          </div>
        </DuplicateDialog>
      </PageHead>
      {repeatOf && (
        <p className="text-sm text-muted"><MSymbol name="repeat" size={15} className="align-middle text-accent" /> Repeat of <Link href={`/briefing/${repeatOf.id}`} className="font-semibold text-accent hover:underline">{repeatOf.brief_code} · {repeatOf.title}</Link></p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <BriefStatusPill status={brief.status} />
        {brief.revision_count > 0 && <Pill tone="warn"><MSymbol name="edit" size={13} /> Revised · v{brief.revision_count}</Pill>}
        {brief.campaign_id && <Link href={`/briefing/campaigns/${brief.campaign_id}`} className="text-xs font-semibold text-accent hover:underline">Campaign: {brief.campaign_name}</Link>}
        {sp.saved && Number(sp.saved) > 0 && <span className="text-xs text-ok">Saved as revision v{sp.saved}</span>}
        {sp.from === "ideation" && <span className="text-xs text-ok">Draft created from Campaign ideation. Check it, then submit for approval.</span>}
      </div>

      {(brief.status === "spec_created" || pendingHandoffs.length > 0) && (
        <Card className="flex items-center gap-3 p-4 text-sm">
          <MSymbol name="conversion_path" size={20} className="text-ok" />
          {brief.status === "spec_created"
            ? <span>Sourcing has taken this brief on as a job{brief.resulting_job_id ? ` (job ${brief.resulting_job_id.slice(0, 8)})` : ""}. The brief is now closed for edits.</span>
            : <span>{pendingHandoffs.length} concept{pendingHandoffs.length === 1 ? "" : "s"} sent to Sourcing, waiting to be opened as a job.</span>}
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="grid gap-4 p-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Client">{brief.client}</Field>
              <Field label="Brand">{brief.brand}</Field>
              <Field label="Division">{brief.division}</Field>
              <Field label="Target launch">{formatDate(brief.target_launch)}</Field>
            </div>
            <Field label="Objective">{brief.objective}</Field>
            <div><p className="eyebrow">Brief</p><p className="mt-0.5 whitespace-pre-wrap text-sm">{brief.brief_text || "—"}</p></div>
            <Field label="Target outlets">{brief.target_outlets}</Field>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Budget">{budgetRange(brief)}</Field>
              <Field label="Product category">{brief.product_category}</Field>
              <Field label="Logged by">{name(brief.created_by)}</Field>
              <Field label="Reference">{brief.brief_code}</Field>
            </div>
            <div className="rounded-lg border border-[#78C7AE66] bg-[#78C7AE14] p-3">
              <p className="eyebrow" style={{ color: "#3f8f76" }}>Sustainability targets</p>
              <p className="mt-0.5 text-sm">{brief.sustainability_targets || "None given."}</p>
              <p className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                {brief.min_recycled_pct != null && <span>Minimum recycled content {brief.min_recycled_pct}%</span>}
                {brief.require_fsc && <span>FSC certified material required</span>}
              </p>
            </div>
          </Card>

          <IdeationPanel briefId={id} open={canIdeate(brief)} demo={!isAiConfigured()} messages={transcript.messages} concepts={transcript.concepts}
            sentConceptIds={history.handoffs.map((h) => h.concept_id)} initialParams={session?.creative_params}
            decide={decide} approvalRequired={Boolean(policy)} />

          {(canIdeate(brief) || inApproval.length > 0) && <div id="concepts" className="scroll-mt-20">
            <Panel title="Concept approvals"
              sub={policy
                ? `Policy ${policy.code}: a concept is approved by ${policy.approver_role ? (ROLE_LABEL[policy.approver_role] ?? policy.approver_role).toLowerCase() : "a colleague"} (never the submitter)${policy.client_approval_required ? ", then by the client in the Client Portal," : ""} before it goes to Sourcing.`
                : "No approval policy applies to this brief, so concepts can go straight to Sourcing. You can still ask a colleague to approve one first."}
              actions={<Link href="/watchtower/approvals" className="text-sm font-semibold text-accent hover:underline">All approvals</Link>}>
              {inApproval.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No concept has been submitted for approval yet.</p> : (
                <ul className="divide-y divide-line">
                  {inApproval.map((c) => (
                    <li key={c.id} className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_300px]">
                      <div className="min-w-0 text-sm">
                        <p className="font-semibold">{c.name}</p>
                        {c.data?.creative_direction && <p className="text-xs text-muted">{c.data.creative_direction}</p>}
                        <ol className="mt-1.5 space-y-0.5 text-xs text-muted">
                          {audit.filter((a) => a.concept_id === c.id).map((a) => (
                            <li key={a.id}>{formatDate(a.at)} · {a.stage === "client" ? "Client " : ""}{a.action.replace(/_/g, " ")}{a.actor_name ? ` by ${a.actor_name}` : ""}{a.comments ? `: ${a.comments}` : ""}</li>
                          ))}
                          {c.submitted_by && !audit.some((a) => a.concept_id === c.id) && <li>Submitted by {name(c.submitted_by)}</li>}
                        </ol>
                      </div>
                      <ConceptActions c={c} canDecide={Boolean(decide[c.id])} approvalRequired={Boolean(policy)} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>}

          {history.handoffs.length > 0 && (
            <Panel title="Hand-offs to Sourcing">
              <ul className="divide-y divide-line">
                {history.handoffs.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>{String((h.payload.concept as { name?: string })?.name ?? "Concept")} <span className="text-xs text-muted">· sent by {name(h.created_by)} · {formatDate(h.created_at)}</span></span>
                    <Pill tone={h.status === "accepted" ? "ok" : "warn"}>{h.status === "accepted" ? "Opened as a job" : "Waiting for Sourcing"}</Pill>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <RevisionHistory revisions={history.revisions} name={name} />
        </div>

        <div className="flex flex-col gap-4">
          {(brief.status === "submitted" || history.approvals.length > 0) && (
            <ApprovalPanel id={id} approvalStatus={brief.approval_status} isAuthor={isAuthor} showDecision={brief.status === "submitted"}
              history={history.approvals} names={names} reviewer={brief.reviewed_by ? name(brief.reviewed_by) : null} reviewedAt={brief.reviewed_at} />
          )}
          <ProgressTimeline brief={brief} events={history.events} name={name} />
          <WhatWorkedPanel items={whatWorked} brand={brief.brand} client={brief.client} />
          <ClientComments briefId={brief.id} />
        </div>
      </div>
    </>
  );
}
