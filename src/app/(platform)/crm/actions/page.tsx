import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getCrmActions, getPeople } from "@/lib/crm-data";
import { ACTION_SOURCE, CRM_ACTION_STATUS } from "@/lib/crm";
import { Card, Empty, PageHead, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { ClientLink, Disclosure, Input, Select, clientOptions, peopleOptions } from "@/components/crm/bits";
import { saveCrmAction, setCrmActionStatus } from "../actions";

export const metadata: Metadata = { title: "Client actions · CRM" };

// One list of what we owe clients: actions from reviews, survey follow-ups, account plans and ad hoc.
export default async function CrmActions({ searchParams }: { searchParams: Promise<{ mine?: string; source?: string; client?: string; all?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [all, clients, people] = await Promise.all([getCrmActions(supabase, { client_id: sp.client }), getClients(supabase), getPeople(supabase)]);
  const rows = all.filter((a) => (sp.mine !== "1" || a.owner === me.id) && (!sp.source || a.source === sp.source) && (sp.all === "1" || a.status === "open" || a.status === "in_progress"))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const open = all.filter((a) => a.status === "open" || a.status === "in_progress");

  return (
    <>
      <PageHead title="Client actions" sub="Everything we have promised clients, in one list: actions from business reviews, survey follow-ups (detractors and scores of 3 or lower), account plans and ad hoc. Client-visible actions also show in the Client Portal."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Actions" }]} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open" value={open.length} icon={<MSymbol name="task_alt" />} />
        <Stat label="Overdue" value={open.filter((a) => a.overdue).length} tone={open.some((a) => a.overdue) ? "bad" : "ok"} icon={<MSymbol name="alarm" />} />
        <Stat label="Mine" value={open.filter((a) => a.owner === me.id).length} hint={<Link className="underline" href="/crm/actions?mine=1">Show my actions</Link>} icon={<MSymbol name="person" />} />
        <Stat label="Survey follow-ups open" value={open.filter((a) => a.source === "survey").length} icon={<MSymbol name="reviews" />} />
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <Select name="source" label="Source" options={Object.entries(ACTION_SOURCE).map(([v, l]) => ({ value: v, label: l }))} value={sp.source} empty="Any" />
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> My actions</label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> Include done and cancelled</label>
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter</button>
      </form>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No actions match" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Action</Th><Th>Client</Th><Th>Source</Th><Th>Owner</Th><Th>Due</Th><Th>Status</Th><Th>Change</Th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={`${a.source}-${a.id}`} className="align-top">
                <Td className="font-semibold">{a.title}{a.detail && <div className="text-xs font-normal text-muted">{a.detail}</div>}{a.client_visible && <div className="mt-1"><Pill tone="info">Client sees this</Pill></div>}</Td>
                <Td><ClientLink id={a.client_id} name={a.client_name} /></Td>
                <Td className="text-xs">{ACTION_SOURCE[a.source] ?? a.source}
                  {a.review_id && <div><Link className="text-accent hover:underline" href={`/crm/reviews/${a.review_id}`}>{a.review_title}</Link></div>}
                  {a.plan_id && <div><Link className="text-accent hover:underline" href="/crm/plans">{a.plan_title}</Link></div>}</Td>
                <Td>{a.owner_name ?? <span className="text-warn">No owner</span>}</Td>
                <Td className={a.overdue ? "font-semibold text-bad" : ""}>{fmtDate(a.due_date)}{a.overdue && <div className="text-xs">Overdue</div>}</Td>
                <Td><StatusPill meta={CRM_ACTION_STATUS} value={a.status} /></Td>
                <Td>{(a.status === "open" || a.status === "in_progress") && (
                  <ActionForm action={setCrmActionStatus} hidden={{ id: a.id, kind: a.source === "plan" ? "plan" : "action" }} submit="Update" variant="secondary" inline>
                    <select name="status" className="input w-32" aria-label="New status" defaultValue="done">
                      {a.source !== "plan" && a.status === "open" && <option value="in_progress">In progress</option>}
                      <option value="done">Done</option><option value="cancelled">Cancel</option>
                    </select>
                    <input name="note" className="input w-36" placeholder="Note" aria-label="Note" />
                  </ActionForm>
                )}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <Disclosure summary="Add an ad hoc action">
        <ActionForm action={saveCrmAction} submit="Add action" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="client_id" label="Client" options={clientOptions(clients.filter((c) => c.active))} empty="Choose…" required value={sp.client} />
          <Input name="title" label="Action" required className="sm:col-span-2" />
          <Select name="owner" label="Owner" options={peopleOptions(people)} empty="Me" />
          <Input name="due_date" label="Due" type="date" />
          <Input name="detail" label="Detail" className="sm:col-span-2" />
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="client_visible" /> Show to the client in the portal</label>
        </ActionForm>
      </Disclosure>
    </>
  );
}
