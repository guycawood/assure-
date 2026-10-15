import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClients, getContracts } from "@/lib/crm-data";
import { CONTRACT_STATUS, CONTRACT_TYPE, money, type ContractRow } from "@/lib/crm";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionForm } from "@/components/sourcing/action-form";
import { Facts, StatusPill, Td, Th, fmtDate } from "@/components/sourcing/bits";
import { ApprovalRequests } from "@/components/approvals/requests";
import { ClientLink, Disclosure, Input, Select, TextArea, clientOptions } from "@/components/crm/bits";
import { renewContract, saveContract, signContract } from "../actions";

export const metadata: Metadata = { title: "Contracts & renewals · CRM" };

export default async function CrmContracts({ searchParams }: { searchParams: Promise<{ contract?: string; due?: string }> }) {
  const me = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [contracts, clients] = await Promise.all([getContracts(supabase), getClients(supabase)]);
  const due = contracts.filter((k) => k.status === "signed" && k.days_to_renewal != null && k.days_to_renewal <= 90);
  const rows = sp.due === "1" ? due : contracts;
  const sel = contracts.find((k) => k.id === sp.contract) ?? null;
  const signed = contracts.filter((k) => k.status === "signed");

  return (
    <>
      <PageHead title="Contracts & renewals" sub="Client MSAs and SOWs with their commercial terms. Signing or renewing above the policy value needs an admin's approval."
        crumbs={[{ label: "CRM", href: "/crm" }, { label: "Contracts & renewals" }]}>
        <Link href={sp.due === "1" ? "/crm/contracts" : "/crm/contracts?due=1"} className="text-sm font-semibold text-accent underline">{sp.due === "1" ? "All contracts" : "Renewals due only"}</Link>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Signed contracts" value={signed.length} icon={<MSymbol name="contract" />} />
        <Stat label="Renewals in 90 days" value={due.length} tone={due.length ? "warn" : "ok"} icon={<MSymbol name="event_repeat" />} />
        <Stat label="Drafts" value={contracts.filter((k) => k.status === "draft").length} icon={<MSymbol name="edit_note" />} />
      </div>

      {sel && <Selected k={sel} meId={me.id} />}

      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No contracts" /> : (
          <table className="w-full text-sm">
            <thead><tr><Th>Contract</Th><Th>Client</Th><Th>Type</Th><Th>Term</Th><Th>Renews</Th><Th className="text-right">Value</Th><Th>Status</Th></tr></thead>
            <tbody>{rows.map((k) => (
              <tr key={k.id} className="align-top">
                <Td><Link className="font-semibold hover:underline" href={`/crm/contracts?contract=${k.id}`}>{k.title}</Link><div className="text-xs text-muted">{k.contract_code}{k.parent_code ? ` · under ${k.parent_code}` : ""}</div></Td>
                <Td><ClientLink id={k.client_id} name={k.client_name} /></Td>
                <Td>{CONTRACT_TYPE[k.contract_type]}</Td>
                <Td>{fmtDate(k.start_date)} to {fmtDate(k.end_date)}</Td>
                <Td className={k.days_to_renewal != null && k.days_to_renewal <= 30 ? "text-bad" : k.days_to_renewal != null && k.days_to_renewal <= 90 ? "text-warn" : ""}>
                  {fmtDate(k.next_renewal)}{k.status === "signed" && k.days_to_renewal != null && <div className="text-xs text-muted">{k.days_to_renewal < 0 ? `${-k.days_to_renewal} days ago` : `in ${k.days_to_renewal} days`}</div>}</Td>
                <Td className="text-right tabular-nums">{money(k.value, k.currency)}</Td>
                <Td><StatusPill meta={CONTRACT_STATUS} value={k.status} />{k.approval_pending && <div className="mt-1"><Pill tone="warn">Approval pending</Pill></div>}</Td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>

      <Disclosure summary="Add a contract (draft)">
        <ActionForm action={saveContract} submit="Save draft" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="client_id" label="Client" options={clientOptions(clients)} empty="Choose…" required />
          <Input name="title" label="Title" required />
          <Select name="contract_type" label="Type" options={[{ value: "msa", label: "MSA" }, { value: "sow", label: "SOW" }, { value: "other", label: "Other" }]} value="msa" />
          <Select name="parent_id" label="Under MSA (for a SOW)" options={contracts.filter((k) => k.contract_type === "msa").map((k) => ({ value: k.id, label: `${k.contract_code} · ${k.client_name}` }))} empty="—" />
          <Input name="start_date" label="Start" type="date" />
          <Input name="end_date" label="End" type="date" />
          <Input name="renewal_date" label="Renewal date" type="date" />
          <Input name="notice_days" label="Notice (days)" type="number" />
          <Input name="value" label="Value" type="number" step="1000" />
          <Input name="currency" label="Currency" placeholder="Client default" />
          <Input name="payment_terms_days" label="Payment terms (days)" type="number" />
          <Input name="markup" label="Markup %" type="number" step="0.1" />
          <Input name="min_margin" label="Minimum margin %" type="number" step="0.1" />
          <Input name="commission" label="GSC commission %" type="number" step="0.1" />
          <Input name="rebate" label="Rebate %" type="number" step="0.1" />
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="auto_renew" /> Renews automatically</label>
          <TextArea name="sustainability" label="Sustainability commitments" className="sm:col-span-2" />
          <TextArea name="notes" label="Notes" className="sm:col-span-2" />
        </ActionForm>
        <p className="mt-2 text-xs text-muted">Contract terms are recorded here; the terms in force change only through Request change on the client&apos;s Contract &amp; terms tab.</p>
      </Disclosure>
    </>
  );
}

function Selected({ k, meId }: { k: ContractRow; meId: string }) {
  return (
    <>
      <ApprovalRequests entityIds={k.id} types={["CRM_CONTRACT"]} meId={meId} title="Waiting for approval" />
      <Panel title={k.title} sub={`${k.contract_code} · ${CONTRACT_TYPE[k.contract_type]} · ${k.client_name}`} actions={<><StatusPill meta={CONTRACT_STATUS} value={k.status} /><Link href="/crm/contracts" className="text-xs text-muted underline">Close</Link></>}>
        <Facts items={[
          ["Term", `${fmtDate(k.start_date)} to ${fmtDate(k.end_date)}`], ["Renewal date", fmtDate(k.next_renewal)],
          ["Notice", k.notice_days != null ? `${k.notice_days} days` : "—"], ["Renews automatically", k.auto_renew ? "Yes" : "No"],
          ["Value", money(k.value, k.currency)], ["Payment terms", k.payment_terms_days != null ? `${k.payment_terms_days} days` : "—"],
          ["Markup / minimum margin", `${k.markup_percent ?? "—"}% / ${k.min_margin_percent ?? "—"}%`],
          ["GSC commission / rebate", `${k.gsc_commission_percent ?? "—"}% / ${k.rebate_percent ?? "—"}%`],
          ["Sustainability", k.sustainability_commitments ?? "—"],
          ["Signed", k.signed_at ? `${fmtDate(k.signed_at)}${k.signed_by_name ? ` by ${k.signed_by_name}` : ""}` : "Not yet"],
          ["Renewals", String(k.renewal_count)], ["Notes", k.notes ?? "—"],
        ]} />
        {!k.approval_pending && (
          <div className="border-t border-line px-5 py-4">
            {k.status === "draft" && (
              <ActionForm action={signContract} hidden={{ id: k.id }} submit="Mark signed" inline>
                <input name="note" className="input w-72" placeholder="Note (optional)" aria-label="Signature note" />
              </ActionForm>
            )}
            {k.status === "signed" && (
              <ActionForm action={renewContract} hidden={{ id: k.id }} submit="Renew" inline>
                <input name="end_date" type="date" className="input w-40" aria-label="New end date" required />
                <input name="renewal_date" type="date" className="input w-40" aria-label="Next renewal date (optional)" />
                <input name="value" type="number" step="1000" className="input w-36" placeholder="New value" aria-label="New value" defaultValue={k.value ?? ""} />
                <input name="note" className="input w-56" placeholder="Note (optional)" aria-label="Renewal note" />
              </ActionForm>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
