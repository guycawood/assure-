import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getClients, getPeople, getPlanActions, getPlans } from "@/lib/crm-data";
import { ACTION_STATUS, PLAN_STATUS, money } from "@/lib/crm";
import { Empty, PageHead, Panel } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { StatusPill, fmtDate } from "@/components/sourcing/bits";
import { ClientLink, Disclosure, Input, Select, TextArea, clientOptions, peopleOptions } from "@/components/crm/bits";
import { addPlanAction, savePlan, setPlanAction } from "../actions";

export const metadata: Metadata = { title: "Account plans · CRM" };

const statusOpts = Object.entries(PLAN_STATUS).map(([v, s]) => ({ value: v, label: s.label }));

export default async function CrmPlans() {
  await requireInternal();
  const supabase = await createClient();
  const [plans, actions, clients, accounts, people] = await Promise.all([getPlans(supabase), getPlanActions(supabase), getClients(supabase), getAccounts(supabase), getPeople(supabase)]);
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();

  return (
    <>
      <PageHead title="Account plans" sub="Objectives, growth targets and the actions that get us there, with owners and dates. Active plans' growth targets are the pipeline target in the CRM Watchtower."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Account plans" }]} />
      <Disclosure summary="Add an account plan">
        <ActionForm action={savePlan} submit="Add plan" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="client_id" label="Client" options={clientOptions(clients)} empty="Choose…" required />
          <Select name="account_id" label="Account (market)" options={accounts.map((a) => ({ value: a.id, label: `${a.client_name} · ${a.market_name ?? a.market}` }))} empty="Whole client" />
          <Input name="title" label="Title" required className="sm:col-span-2" />
          <Input name="period_start" label="From" type="date" value={`${year}-01-01`} required />
          <Input name="period_end" label="To" type="date" value={`${year}-12-31`} required />
          <Input name="growth_target" label="Growth target" type="number" step="1000" />
          <Input name="currency" label="Currency" placeholder="Client default" />
          <Select name="owner" label="Owner" options={peopleOptions(people)} empty="Me" />
          <Select name="status" label="Status" options={statusOpts} value="draft" />
          <TextArea name="objectives" label="Objectives" className="sm:col-span-2 lg:col-span-4" />
        </ActionForm>
      </Disclosure>
      {plans.length === 0 ? <Empty title="No account plans yet" /> : plans.map((p) => {
        const acts = actions.filter((a) => a.plan_id === p.id);
        return (
          <Panel key={p.id} title={p.title} sub={`${fmtDate(p.period_start)} to ${fmtDate(p.period_end)} · owner ${p.owner_name ?? "not set"}${p.account_market ? ` · ${p.account_market}` : ""}`}
            actions={<><ClientLink id={p.client_id} name={p.client_name} /><StatusPill meta={PLAN_STATUS} value={p.status} /></>}>
            <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <p className="whitespace-pre-line text-sm">{p.objectives ?? "No objectives written yet."}</p>
              <div className="text-sm"><p className="eyebrow">Growth target</p><p className="font-display text-xl font-bold">{money(p.growth_target, p.currency)}</p>
                <p className="text-xs text-muted">{p.actions_done}/{p.actions_total} actions done{p.actions_overdue ? ` · ${p.actions_overdue} overdue` : ""}</p></div>
            </div>
            <ul className="divide-y divide-line border-t border-line">
              {acts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
                  <span className="min-w-0 flex-1">{a.action}<span className="block text-xs text-muted">{a.owner_name ?? "No owner"} · due {fmtDate(a.due_date)}</span></span>
                  <span className={a.status === "open" && a.due_date && a.due_date < today ? "text-xs font-semibold text-bad" : "hidden"}>Overdue</span>
                  <StatusPill meta={ACTION_STATUS} value={a.status} />
                  {a.status === "open" && <ActionForm action={setPlanAction} hidden={{ id: a.id, status: "done" }} submit="Done" variant="secondary" inline />}
                  {a.status !== "open" && <ActionForm action={setPlanAction} hidden={{ id: a.id, status: "open" }} submit="Reopen" variant="secondary" inline />}
                </li>
              ))}
            </ul>
            <div className="space-y-3 border-t border-line px-5 py-3">
              {p.status !== "closed" && (
                <ActionForm action={addPlanAction} hidden={{ plan_id: p.id }} submit="Add action" variant="secondary" inline>
                  <input name="action" className="input w-72" placeholder="Action" aria-label="Action" required />
                  <select name="owner" className="input w-44" aria-label="Owner" defaultValue=""><option value="">Me</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  <input name="due_date" type="date" className="input w-40" aria-label="Due date" />
                </ActionForm>
              )}
              <details><summary className="cursor-pointer text-xs font-semibold text-accent">Edit plan</summary>
                <ActionForm action={savePlan} hidden={{ id: p.id, client_id: p.client_id, account_id: p.account_id }} submit="Save" className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Input name="title" label="Title" value={p.title} required className="sm:col-span-2" />
                  <Input name="period_start" label="From" type="date" value={p.period_start} required />
                  <Input name="period_end" label="To" type="date" value={p.period_end} required />
                  <Input name="growth_target" label="Growth target" type="number" step="1000" value={p.growth_target} />
                  <Input name="currency" label="Currency" value={p.currency} />
                  <Select name="status" label="Status" options={statusOpts} value={p.status} />
                  <TextArea name="objectives" label="Objectives" value={p.objectives} className="sm:col-span-2 lg:col-span-4" />
                </ActionForm>
              </details>
            </div>
          </Panel>
        );
      })}
    </>
  );
}
