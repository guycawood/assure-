import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getContacts, getCrmActions, getPeople, getReview, getReviewResponses } from "@/lib/crm-data";
import { CRM_ACTION_STATUS, REVIEW_STATUS, REVIEW_TYPE, money } from "@/lib/crm";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { Facts, StatusPill, Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { ClientLink, Input, RagPill, TextArea, peopleOptions, Select } from "@/components/crm/bits";
import { generatePack, saveCrmAction, setCrmActionStatus, setReviewStatus } from "../../actions";

export const metadata: Metadata = { title: "Business review · CRM" };

export default async function CrmReview({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const r = await getReview(supabase, id);
  if (!r) notFound();
  const [actions, responses, people, contacts] = await Promise.all([getCrmActions(supabase, { review_id: id }), getReviewResponses(supabase, id), getPeople(supabase), getContacts(supabase, { client_id: r.client_id })]);
  const p = r.pack;
  const name = new Map(people.map((x) => [x.id, x.name]));
  const open = r.status === "planned" || r.status === "held";

  return (
    <>
      <PageHead title={r.title} sub={`${REVIEW_TYPE[r.review_type]} · ${fmtDate(r.scheduled_on)}${r.account_market ? ` · ${r.account_market}` : ""}`}
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Business reviews", href: "/crm/reviews" }, { label: r.title }]}>
        <ClientLink id={r.client_id} name={r.client_name} /><StatusPill meta={REVIEW_STATUS} value={r.status} />
      </PageHead>

      <Panel title="Details">
        <Facts items={[
          ["adm Indicia", (r.internal_attendee_names ?? []).join(", ") || "—"], ["Client", (r.contact_attendee_names ?? []).join(", ") || "—"],
          ["Shown in the Client Portal", r.client_visible ? "Yes" : "No"],
          ["Confirmed in the portal", responses.length ? responses.map((x) => `${name.get(x.user_id) ?? "Client user"}: ${x.response}`).join("; ") : "No replies yet"],
          ["Agenda", <ol key="a" className="list-decimal pl-4">{r.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol>],
          ...(r.cancelled_reason ? [["Cancelled because", r.cancelled_reason] as [string, string]] : []),
        ]} />
      </Panel>

      <Panel title="Review pack" sub={r.pack_generated_at ? `Built from CRM data on ${fmtDateTime(r.pack_generated_at)}` : "Not generated yet"}
        actions={open ? <ActionForm action={generatePack} hidden={{ id }} submit={p ? "Refresh pack" : "Generate pack"} variant="secondary" inline /> : undefined}>
        {!p ? <p className="px-5 py-4 text-sm text-muted">Generate the pack to pull spend, pipeline, health, survey results, delivery and quality, and open actions for this client.</p> : (
          <div className="grid gap-4 px-5 py-4 text-sm md:grid-cols-2 xl:grid-cols-3">
            <div><p className="eyebrow">Health</p>{p.health?.rag && <RagPill rag={p.health.rag} />}<p className="mt-1 text-xs text-muted">{(p.health?.reasons ?? []).join(" · ") || "Nothing to flag"}</p></div>
            <div><p className="eyebrow">Spend this year</p><p className="font-display text-lg font-bold">{money(p.health?.spend_ytd, p.health?.currency)}</p>
              <p className="text-xs text-muted">Billed {money(p.health?.billed_ytd, p.health?.currency)} · {p.health?.overdue_bills ?? 0} overdue bills</p></div>
            <div><p className="eyebrow">Pipeline</p><p className="font-display text-lg font-bold">{p.pipeline?.open ?? 0} open</p>
              <p className="text-xs text-muted">{Object.entries(p.pipeline?.by_currency ?? {}).map(([c, v]) => `${money(v.value, c)} (weighted ${money(v.weighted, c)})`).join(" · ") || "—"} · {p.won_last_12_months ?? 0} won in 12 months</p></div>
            <div><p className="eyebrow">Satisfaction</p><p className="font-display text-lg font-bold">NPS {p.survey?.nps ?? "—"}</p>
              <p className="text-xs text-muted">{p.survey?.responses ?? 0} survey responses · overall {p.survey?.overall ?? "—"}/5</p>
              {p.section_scores && Object.keys(p.section_scores).length > 0 && <p className="text-xs text-muted">{Object.entries(p.section_scores).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}</div>
            <div><p className="eyebrow">Delivery (OTIF)</p><p className="font-display text-lg font-bold">{p.delivery?.otif_percent != null ? `${p.delivery.otif_percent}%` : "—"}</p>
              <p className="text-xs text-muted">{p.delivery?.on_time ?? 0} of {p.delivery?.delivered ?? 0} deliveries on time (12 months)</p></div>
            <div><p className="eyebrow">Install quality</p><p className="font-display text-lg font-bold">{p.quality?.pass_percent != null ? `${p.quality.pass_percent}%` : "—"}</p>
              <p className="text-xs text-muted">{p.quality?.passed ?? 0} of {p.quality?.audited ?? 0} audits passed · {p.jobs?.closed ?? 0} jobs closed, {p.jobs?.in_progress ?? 0} in production</p></div>
            <div className="md:col-span-2 xl:col-span-3"><p className="eyebrow">Open actions at the time</p>
              {(p.open_actions ?? []).length === 0 ? <p className="text-xs text-muted">None.</p> : <ul className="text-xs">{p.open_actions!.map((a, i) => <li key={i}>{a.title} · due {fmtDate(a.due_date)} · {a.status}</li>)}</ul>}</div>
          </div>
        )}
      </Panel>

      <Panel title="Outcomes and notes" sub="Closing the review needs the outcomes recorded">
        {r.status === "planned" ? (
          <div className="flex flex-wrap gap-3 px-5 py-4">
            <ActionForm action={setReviewStatus} hidden={{ id, status: "held" }} submit="Mark as held" className="w-full max-w-xl">
              <TextArea name="outcomes" label="Outcomes (optional now)" rows={3} />
              <TextArea name="notes" label="Notes" rows={2} />
            </ActionForm>
            <ActionForm action={setReviewStatus} hidden={{ id, status: "cancelled" }} submit="Cancel review" variant="danger" inline>
              <input name="notes" className="input w-64" placeholder="Why (required)" aria-label="Cancellation reason" />
            </ActionForm>
          </div>
        ) : r.status === "held" ? (
          <div className="space-y-3 px-5 py-4">
            <ActionForm action={setReviewStatus} hidden={{ id, status: "outcomes" }} submit="Save outcomes" variant="secondary" className="max-w-xl">
              <TextArea name="outcomes" label="Outcomes" value={r.outcomes} rows={4} required />
              <TextArea name="notes" label="Notes" value={r.notes} rows={2} />
            </ActionForm>
            <ActionForm action={setReviewStatus} hidden={{ id, status: "closed" }} submit="Close review" confirm="Close the review? Outcomes and actions are kept." inline />
          </div>
        ) : (
          <div className="space-y-2 px-5 py-4 text-sm"><p className="whitespace-pre-line">{r.outcomes ?? "—"}</p>{r.notes && <p className="text-muted">{r.notes}</p>}
            {r.closed_at && <p className="text-xs text-muted">Closed {fmtDateTime(r.closed_at)}</p>}</div>
        )}
      </Panel>

      <Panel title="Actions from this review">
        {actions.length === 0 ? <Empty title="No actions yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>Action</Th><Th>Owner</Th><Th>Due</Th><Th>Client sees it</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>{actions.map((a) => (
              <tr key={a.id}><Td className="font-semibold">{a.title}{a.detail && <div className="text-xs font-normal text-muted">{a.detail}</div>}</Td><Td>{a.owner_name ?? "—"}</Td>
                <Td className={a.overdue ? "text-bad" : ""}>{fmtDate(a.due_date)}</Td><Td>{a.client_visible ? <Pill tone="info">Yes</Pill> : "No"}</Td>
                <Td><StatusPill meta={CRM_ACTION_STATUS} value={a.status} /></Td>
                <Td>{(a.status === "open" || a.status === "in_progress") && <ActionForm action={setCrmActionStatus} hidden={{ id: a.id, status: "done" }} submit="Done" variant="secondary" inline />}</Td></tr>))}</tbody>
          </table></div>
        )}
        {r.status !== "cancelled" && (
          <div className="border-t border-line px-5 py-3">
            <ActionForm action={saveCrmAction} hidden={{ review_id: id }} submit="Add action" variant="secondary" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input name="title" label="Action" required className="sm:col-span-2" />
              <Select name="owner" label="Owner" options={peopleOptions(people)} empty="Me" />
              <Input name="due_date" label="Due" type="date" />
              <Input name="detail" label="Detail" className="sm:col-span-2 lg:col-span-3" />
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="client_visible" /> Show to the client</label>
            </ActionForm>
          </div>
        )}
      </Panel>
      <Card className="px-5 py-3 text-xs text-muted">{contacts.length} contacts at {r.client_name}. All actions for every client are on <Link className="underline" href="/crm/actions">Actions</Link>.</Card>
    </>
  );
}
