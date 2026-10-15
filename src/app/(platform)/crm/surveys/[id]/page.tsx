import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getSurveyRecipients, getSurveyResults, getSurveyWaves, getTemplate } from "@/lib/crm-data";
import { NPS_TONE, avg, nps } from "@/lib/crm";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { Td, Th, fmtDate, fmtDateTime } from "@/components/sourcing/bits";
import { ApprovalRequests } from "@/components/approvals/requests";
import { ClientLink, ScorePill, Select, clientOptions } from "@/components/crm/bits";
import { addToWave, closeWave, sendWave } from "../../actions";

export const metadata: Metadata = { title: "Survey · CRM" };

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = { queued: "neutral", excluded: "bad", sent: "info", opened: "warn", responded: "ok" };

export default async function CrmSurveyWave({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ response?: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const wave = (await getSurveyWaves(supabase)).find((w) => w.id === id);
  if (!wave) notFound();
  const [recipients, results, clients, tpl] = await Promise.all([getSurveyRecipients(supabase, id), getSurveyResults(supabase, { wave_id: id }), getClients(supabase), getTemplate(supabase, wave.template_id)]);
  const questions = (tpl?.data.sections ?? []).flatMap((s) => s.questions.map((q) => ({ ...q, section: s.label })));
  const selected = results.find((r) => r.id === sp.response) ?? null;

  return (
    <>
      <PageHead title={wave.name} sub={`${wave.period_label ?? ""}${wave.period_label ? " · " : ""}${tpl?.name ?? ""} · ${wave.status}${wave.closes_on ? ` · closes ${fmtDate(wave.closes_on)}` : ""}`}
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Surveys", href: "/crm/surveys" }, { label: wave.name }]} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sent" value={wave.sent} hint={`${wave.excluded_count} excluded`} icon={<MSymbol name="send" />} />
        <Stat label="Opened" value={wave.opened} icon={<MSymbol name="drafts" />} />
        <Stat label="Responded" value={wave.responded} hint={wave.sent ? `${Math.round((100 * wave.responded) / wave.sent)}% response` : undefined} icon={<MSymbol name="mark_email_read" />} />
        <Stat label="NPS" value={nps(results.map((r) => r.nps)) ?? "—"} hint={`Overall ${avg(results.map((r) => Number(r.overall)).filter((n) => n > 0)) ?? "—"}/5`} icon={<MSymbol name="reviews" />} />
      </div>

      <ApprovalRequests entityIds={id} types={["CRM_SEND"]} meId={me.id} title="Send waiting for approval" />

      {wave.status === "draft" && !wave.approval_pending && (
        <Card className="flex flex-wrap items-end gap-4 px-5 py-4">
          <ActionForm action={addToWave} hidden={{ id }} submit="Add contacts" variant="secondary" inline>
            <Select name="client_id" label="Add the client's contacts flagged “receive survey”" options={clientOptions(clients.filter((c) => c.active))} empty="Choose a client…" required />
          </ActionForm>
          <ActionForm action={sendWave} hidden={{ id }} submit="Send survey" confirm="Send the survey emails now? Each contact gets one email signed by their owner." inline />
        </Card>
      )}
      {wave.status === "sent" && <ActionForm action={closeWave} hidden={{ id }} submit="Close survey" variant="secondary" inline confirm="Close the survey? Links stop working." />}

      {selected && (
        <Panel title={`Response: ${selected.contact_name ?? "contact"}`} sub={`${selected.client_name} · ${fmtDateTime(selected.created_at)}`} actions={<Link href={`/crm/surveys/${id}`} className="text-xs underline">Close</Link>}>
          <div className="flex flex-wrap gap-2 px-5 pt-4"><ScorePill score={selected.nps} /><Pill tone={NPS_TONE[selected.nps_category]}>{selected.nps_category}</Pill>
            {selected.overall != null && <Pill>Overall {selected.overall}/5</Pill>}{selected.testimonial_opt_in && <Pill tone="accent">Happy to give a testimonial</Pill>}</div>
          <table className="m-5 w-[calc(100%-2.5rem)] text-sm"><tbody>{questions.map((q) => (
            <tr key={q.code} className="align-top"><Td className="w-14 text-muted">{q.code}</Td><Td>{q.text}<div className="text-xs text-muted">{q.section}</div>
              {selected.comments?.[q.code] && <div className="mt-1 text-sm text-bad">{selected.comments[q.code]}</div>}</Td>
              <Td className="w-12 text-right font-semibold">{selected.scores?.[q.code] ?? "—"}</Td></tr>))}</tbody></table>
          <div className="space-y-1 px-5 pb-4 text-sm">
            {selected.start_doing && <p><span className="font-semibold">Start:</span> {selected.start_doing}</p>}
            {selected.continue_doing && <p><span className="font-semibold">Continue:</span> {selected.continue_doing}</p>}
            {selected.stop_doing && <p><span className="font-semibold">Stop:</span> {selected.stop_doing}</p>}
            {selected.valuable_tools.length > 0 && <p><span className="font-semibold">Most valuable tools:</span> {selected.valuable_tools.join(", ")}</p>}
          </div>
        </Panel>
      )}

      <Panel title="Recipients" sub="One link per contact; it works once">
        {recipients.length === 0 ? <Empty title="Nobody added yet">Add a client&apos;s contacts flagged to receive the survey.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><Th>Contact</Th><Th>Client</Th><Th>Signed by</Th><Th>Status</Th><Th>Sent</Th><Th>Responded</Th><Th>Result</Th></tr></thead>
            <tbody>{recipients.map((r) => (
              <tr key={r.id}><Td className="font-semibold">{r.contact_name}<div className="text-xs font-normal text-muted">{r.contact_email}</div></Td>
                <Td><ClientLink id={r.client_id} name={r.client_name} /></Td><Td>{r.owner_name ?? "—"}</Td>
                <Td><Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Pill>{r.excluded_reason && <div className="text-xs text-bad">{r.excluded_reason}</div>}</Td>
                <Td>{fmtDate(r.sent_at)}</Td><Td>{fmtDate(r.responded_at)}</Td>
                <Td>{r.response_id ? <Link className="font-semibold text-accent hover:underline" href={`/crm/surveys/${id}?response=${r.response_id}`}>View</Link> : "—"}</Td></tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
