import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getFeedback } from "@/lib/crm-data";
import { nps } from "@/lib/crm";
import { Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { fmtDate } from "@/components/sourcing/bits";
import { ClientLink, Disclosure, Input, Select, TextArea, ScorePill, clientOptions } from "@/components/crm/bits";
import { captureFeedback, followUpFeedback } from "../actions";

export const metadata: Metadata = { title: "Feedback · CRM" };

export default async function CrmFeedback({ searchParams }: { searchParams: Promise<{ client?: string; open?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, clients] = await Promise.all([getFeedback(supabase, { client_id: sp.client }), getClients(supabase)]);
  const rows = sp.open === "1" ? all.filter((f) => f.score <= 6 && !f.followed_up_at) : all;
  const year = all.filter((f) => new Date(f.created_at).getTime() >= Date.now() - 365 * 86_400_000);
  const score = nps(year.map((f) => f.score));
  const avg = year.length ? (year.reduce((n, f) => n + f.score, 0) / year.length).toFixed(1) : "—";
  const openCount = all.filter((f) => f.score <= 6 && !f.followed_up_at).length;

  return (
    <>
      <PageHead title="Feedback" sub="How clients rate adm Indicia (0 to 10), from the team and from the Client Portal. Scores of 6 or less are followed up."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Feedback" }]} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="NPS (12 months)" value={score ?? "—"} tone={score == null ? undefined : score >= 30 ? "ok" : score >= 0 ? "warn" : "bad"} hint={`${year.length} scores`} icon={<MSymbol name="reviews" />} />
        <Stat label="Average score" value={avg} icon={<MSymbol name="star" />} />
        <Stat label="To follow up" value={openCount} tone={openCount ? "warn" : "ok"} hint={<Link className="underline" href="/crm/feedback?open=1">Show them</Link>} icon={<MSymbol name="support_agent" />} />
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="open" value="1" defaultChecked={sp.open === "1"} /> Only to follow up</label>
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter</button>
      </form>
      <Disclosure summary="Capture feedback from a client">
        <ActionForm action={captureFeedback} submit="Record" className="grid gap-3 sm:grid-cols-3">
          <Select name="client_id" label="Client" options={clientOptions(clients)} empty="Choose…" required value={sp.client} />
          <Input name="score" label="Score (0-10)" type="number" required />
          <TextArea name="comment" label="Comment" className="sm:col-span-3" />
        </ActionForm>
      </Disclosure>
      <Panel title={`${rows.length} responses`}>
        {rows.length === 0 ? <Empty title="No feedback" /> : (
          <ul className="divide-y divide-line">{rows.map((f) => (
            <li key={f.id} className="space-y-1 px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><ScorePill score={f.score} /><ClientLink id={f.client_id} name={f.client_name} />
                <Pill>{f.source === "client_portal" ? "Client Portal" : "Captured by the team"}</Pill>
                <span className="text-xs text-muted">{fmtDate(f.created_at)} · {f.contact_name ?? f.submitted_by_name}{f.market ? ` · ${f.market}` : ""}</span></div>
              {f.comment && <p>{f.comment}</p>}
              {f.followed_up_at ? <p className="text-xs text-ok">Followed up {fmtDate(f.followed_up_at)}: {f.follow_up_note}</p> : f.score <= 6 && (
                <ActionForm action={followUpFeedback} hidden={{ id: f.id }} submit="Record follow-up" variant="secondary" inline>
                  <input name="note" className="input w-80" placeholder="What was done about it" aria-label="Follow-up note" />
                </ActionForm>
              )}
            </li>))}</ul>
        )}
      </Panel>
    </>
  );
}
