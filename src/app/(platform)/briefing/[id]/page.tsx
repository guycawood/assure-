import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInternalPeople } from "@/lib/data";
import { getBrief, getBriefHistory, getCampaigns, getLatestSession, getLibrary, getSessionTranscript } from "@/lib/briefing-data";
import { getWhatWorked } from "@/lib/shopper-iq-data";
import { isAiConfigured } from "@/lib/ai/claude";
import { budgetRange, canIdeate, marketName } from "@/lib/briefing";
import { formatDate, personName } from "@/lib/srt";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { BriefStatusPill } from "@/components/briefing/labels";
import { BriefForm } from "@/components/briefing/brief-form";
import { ProgressTimeline, RevisionHistory } from "@/components/briefing/history";
import { WhatWorkedPanel } from "@/components/shopper-iq/what-worked";
import { updateBrief } from "../actions";
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
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: brief.brief_code }]} title={brief.title}
        sub={[brief.client, brief.brand, brief.market ? `${marketName(brief.market)} · ${brief.region ?? ""}` : null].filter(Boolean).join(" · ")}>
        <BriefActions id={id} status={brief.status} canEdit={editable} canSubmit={mayChange} canArchive={mayChange && !["archived", "spec_created"].includes(brief.status)} />
      </PageHead>
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
            ? <span>Sourcing+ has taken this brief on as a job{brief.resulting_job_id ? ` (job ${brief.resulting_job_id.slice(0, 8)})` : ""}. The brief is now closed for edits.</span>
            : <span>{pendingHandoffs.length} concept{pendingHandoffs.length === 1 ? "" : "s"} sent to Sourcing+, waiting to be opened as a job.</span>}
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
            sentConceptIds={history.handoffs.map((h) => h.concept_id)} initialParams={session?.creative_params} />

          {history.handoffs.length > 0 && (
            <Panel title="Hand-offs to Sourcing+">
              <ul className="divide-y divide-line">
                {history.handoffs.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>{String((h.payload.concept as { name?: string })?.name ?? "Concept")} <span className="text-xs text-muted">· sent by {name(h.created_by)} · {formatDate(h.created_at)}</span></span>
                    <Pill tone={h.status === "accepted" ? "ok" : "warn"}>{h.status === "accepted" ? "Opened as a job" : "Waiting for Sourcing+"}</Pill>
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
        </div>
      </div>
    </>
  );
}
