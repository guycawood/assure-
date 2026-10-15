import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getInteractions, getLibrary } from "@/lib/crm-data";
import { Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { fmtDateTime } from "@/components/sourcing/bits";
import { ClientLink, Disclosure, Input, Select, TextArea, clientOptions, libOptions } from "@/components/crm/bits";
import { logInteraction } from "../actions";

export const metadata: Metadata = { title: "Activity · CRM" };

export default async function CrmActivity({ searchParams }: { searchParams: Promise<{ client?: string; type?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [items, clients, types] = await Promise.all([getInteractions(supabase, { client_id: sp.client }, 300), getClients(supabase), getLibrary(supabase, "crm_interaction_types")]);
  const rows = items.filter((i) => !sp.type || i.type_code === sp.type);

  return (
    <>
      <PageHead title="Activity" sub="Every meeting, call, email, QBR and note with clients, newest first."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Activity" }]} />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <Select name="client" label="Client" options={clientOptions(clients)} value={sp.client} empty="All clients" />
        <Select name="type" label="Type" options={types.map((t) => ({ value: t.code ?? "", label: t.name }))} value={sp.type} empty="Any" />
        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Filter</button>
        {(sp.client || sp.type) && <Link href="/crm/activity" className="pb-2 text-sm text-accent underline">Clear</Link>}
      </form>
      <Disclosure summary="Log an interaction">
        <p className="mb-3 text-sm text-muted">To link an account, contact or opportunity, log it from the client&apos;s page.</p>
        <ActionForm action={logInteraction} submit="Log it" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="client_id" label="Client" options={clientOptions(clients)} empty="Choose…" required value={sp.client} />
          <Select name="type_id" label="Type" options={libOptions(types)} empty="Choose…" required />
          <Input name="subject" label="Subject" required />
          <Input name="occurred_at" label="When" type="datetime-local" />
          <TextArea name="summary" label="What happened" className="sm:col-span-2 lg:col-span-4" />
        </ActionForm>
      </Disclosure>
      <Panel title={`${rows.length} interactions`}>
        {rows.length === 0 ? <Empty title="Nothing logged" /> : (
          <ol className="divide-y divide-line">{rows.map((i) => (
            <li key={i.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
              <span className="text-xs text-muted">{fmtDateTime(i.occurred_at)}<br />{i.owner_name}</span>
              <span><Pill>{i.type_name}</Pill> <ClientLink id={i.client_id} name={i.client_name} /> · <span className="font-semibold">{i.subject}</span>
                {i.summary && <span className="block text-muted">{i.summary}</span>}
                <span className="block text-xs text-muted">{[i.contact_name && `with ${i.contact_name}`, i.market, i.opportunity_title && `re ${i.opportunity_title}`].filter(Boolean).join(" · ")}</span></span>
            </li>))}</ol>
        )}
      </Panel>
    </>
  );
}
