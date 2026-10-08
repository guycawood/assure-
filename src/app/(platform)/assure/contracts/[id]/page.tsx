import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { getSupplier, rows } from "@/lib/assure-data";
import { CONTRACT_STATUS, DOCUMENT_TYPES, isContractExpiring, NEGOTIATION_ACTION, optLabel, type Contract, type ContractParty } from "@/lib/assure";
import { formatDate, personName, timeAgo } from "@/lib/srt";
import { Empty, PageHead, Panel, Pill } from "@/components/ui";
import { Date_, Facts, OptPill, SupplierLink } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { addNegotiation, addParty, commentContract, contractAction, removeParty, signParty, updateContract } from "../../srm-actions";

export const metadata: Metadata = { title: "Contract" };

type Neg = { id: string; clause: string; complexity: string; risk: string; action: string; rationale: string | null; logged_by: string | null; created_at: string };
type Act = { id: number; event_type: string; description: string | null; actor: string | null; created_at: string };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("contracts").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Contract;
  const [supplier, parties, activity, negs, people] = await Promise.all([
    c.supplier_id ? getSupplier(supabase, c.supplier_id) : Promise.resolve(null),
    rows<ContractParty>(supabase, "contract_parties", { eq: ["contract_id", id], order: "signing_order", asc: true }),
    rows<Act>(supabase, "contract_activity", { eq: ["contract_id", id], order: "created_at" }),
    rows<Neg>(supabase, "contract_negotiations", { eq: ["contract_id", id], order: "created_at" }),
    getInternalPeople(supabase),
  ]);
  const pMap = byId(people);
  const draft = c.status === "draft";
  const waiting = ["sent", "viewed", "in_review"].includes(c.status);
  const nextOrder = Math.min(...parties.filter((p) => p.role === "signer" && p.status !== "signed").map((p) => p.signing_order), Infinity);
  const act = (action: string, label: string, opts?: { note?: string; required?: boolean; variant?: "primary" | "secondary" | "danger"; confirm?: string }) => (
    <ActionForm key={action} action={contractAction} submit={label} hidden={{ id: c.id, action }} inline variant={opts?.variant ?? "secondary"} confirm={opts?.confirm}>
      {opts?.note && <input name="note" required={opts.required} className="input w-56 py-1.5" placeholder={opts.note} aria-label={opts.note} />}
    </ActionForm>
  );

  return (
    <>
      <PageHead title={c.title} sub={`${c.contract_ref} · v${c.version} · ${optLabel(DOCUMENT_TYPES, c.document_type)}`}
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Contracts", href: "/assure/contracts" }, { label: c.contract_ref }]}>
        <OptPill list={CONTRACT_STATUS} value={c.status} />
        {isContractExpiring(c) && <Pill tone="warn">Renewal due</Pill>}
      </PageHead>

      <Panel title="Actions">
        <div className="flex flex-wrap gap-2 p-4">
          {draft && act("send", "Send for signature", { variant: "primary", confirm: "Send this contract to the recipients? Terms can't be edited after this." })}
          {waiting && act("mark_viewed", "Mark viewed")}
          {waiting && act("mark_in_review", "Vendor is reviewing")}
          {waiting && act("remind", "Log reminder", { note: "Reminder note (optional)" })}
          {waiting && act("expire", "Expire", { variant: "danger", confirm: "Mark this contract expired?" })}
          {waiting && act("decline", "Declined by vendor", { note: "Why they declined", required: true, variant: "danger" })}
          {!["cancelled", "signed", "counter_signed", "expired", "amended"].includes(c.status) && act("cancel", "Cancel", { note: "Why it's cancelled", required: true, variant: "danger", confirm: "Cancel this contract?" })}
          {!["draft", "amended", "cancelled"].includes(c.status) && act("amend", "Create amendment", { note: "What's changing", confirm: "Create a new draft version? This one will be marked amended." })}
          {c.parent_contract_id && <Link href={`/assure/contracts/${c.parent_contract_id}`} className="self-center text-sm text-accent underline">Previous version</Link>}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel title="Contract">
            <div className="space-y-4 p-5">
              <Facts cols={3} items={[
                ["Supplier", c.supplier_id ? <SupplierLink key="s" id={c.supplier_id} name={supplier?.name} tab="contracts" /> : null],
                ["Value", c.value != null ? `${c.currency} ${Number(c.value).toLocaleString("en-GB")}` : null], ["Signature due", <Date_ key="d" d={c.due_date} />],
                ["Starts", <Date_ key="s2" d={c.start_date} />], ["Ends", <Date_ key="e" d={c.end_date} />], ["Finalised", c.finalized_at ? formatDate(c.finalized_at) : null],
                ["Document", c.document_path],
              ]} />
              {c.content_summary && <div className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{c.content_summary}</div>}
              <details open={draft}>
                <summary className="cursor-pointer text-sm font-semibold text-accent">{draft ? "Edit draft" : "Edit notes and due date"}</summary>
                <ActionForm action={updateContract} submit="Save" hidden={{ id: c.id, draft: draft ? "1" : "0" }} className="mt-3">
                  {draft && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Title" className="sm:col-span-2"><input name="title" required defaultValue={c.title} className="input" /></Field>
                      <Field label="Type"><Select name="document_type" options={DOCUMENT_TYPES} defaultValue={c.document_type} /></Field>
                      <Field label="Value"><input name="value" type="number" min={0} step="0.01" defaultValue={c.value ?? ""} className="input" /></Field>
                      <Field label="Currency"><input name="currency" maxLength={3} defaultValue={c.currency} className="input uppercase" /></Field>
                      <Field label="Document location"><input name="document_path" defaultValue={c.document_path ?? ""} className="input" /></Field>
                      <Field label="Starts"><input name="start_date" type="date" defaultValue={c.start_date ?? ""} className="input" /></Field>
                      <Field label="Ends"><input name="end_date" type="date" defaultValue={c.end_date ?? ""} className="input" /></Field>
                      <Field label="Content" className="sm:col-span-3"><textarea name="content_summary" rows={4} defaultValue={c.content_summary ?? ""} className="input" /></Field>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Signature due"><input name="due_date" type="date" defaultValue={c.due_date ?? ""} className="input" /></Field>
                    <Field label="Internal notes (not shown to the vendor)" className="sm:col-span-2"><input name="internal_notes" defaultValue={c.internal_notes ?? ""} className="input" /></Field>
                  </div>
                </ActionForm>
              </details>
            </div>
          </Panel>

          <Panel title="Recipients and signing" sub="Signers sign in order. Record each signature with its evidence (e-signature reference or signed copy).">
            {parties.length === 0 ? <Empty title="No recipients yet" /> : (
              <table className="w-full text-sm">
                <thead><tr>{["Order", "Name", "Role", "Status", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {parties.map((p) => (
                    <tr key={p.id} className="align-top">
                      <td className="td tabular-nums">{p.signing_order}</td>
                      <td className="td"><b>{p.name}</b><div className="text-xs text-muted">{p.email}{p.is_internal ? " · adm Indicia" : ""}</div></td>
                      <td className="td capitalize">{p.role}</td>
                      <td className="td"><Pill tone={p.status === "signed" ? "ok" : p.status === "declined" ? "bad" : "info"}>{p.status}</Pill>
                        {p.signed_at && <div className="text-xs text-muted">{formatDate(p.signed_at)}{p.signature_evidence ? ` · ${p.signature_evidence}` : ""}</div>}</td>
                      <td className="td">
                        {draft && <ActionForm action={removeParty} submit="Remove" hidden={{ id: p.id, contract_id: c.id }} inline variant="danger" />}
                        {waiting && p.role === "signer" && p.status !== "signed" && (p.signing_order === nextOrder ? (
                          <ActionForm action={signParty} submit="Record signature" hidden={{ id: p.id }} inline>
                            <input name="evidence" required className="input w-52 py-1.5" placeholder="Evidence reference" aria-label="Signature evidence" />
                          </ActionForm>
                        ) : <span className="text-xs text-muted">Waiting for earlier signers</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {draft && (
              <div className="border-t border-line p-5">
                <ActionForm action={addParty} submit="Add recipient" hidden={{ contract_id: c.id }} inline resetOnOk>
                  <Field label="Name" className="min-w-[160px] flex-1"><input name="name" required className="input" /></Field>
                  <Field label="Email" className="min-w-[200px] flex-1"><input name="email" type="email" required defaultValue={!parties.length ? supplier?.primary_contact_email ?? "" : ""} className="input" /></Field>
                  <Field label="Role" className="w-32"><Select name="role" options={[{ value: "signer", label: "Signer" }, { value: "reviewer", label: "Reviewer" }, { value: "cc", label: "Copy" }]} /></Field>
                  <Field label="Order" className="w-20"><input name="signing_order" type="number" min={1} defaultValue={parties.length + 1} className="input" /></Field>
                  <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="is_internal" /> adm Indicia</label>
                </ActionForm>
              </div>
            )}
          </Panel>

          <Panel title="Negotiation log" sub="The action comes from the matrix: low/low accept or fix; low complexity/high risk use the query matrix; high/low query matrix with conditions; high/high hold position or escalate.">
            {negs.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No clauses logged.</p> : (
              <ul className="divide-y divide-line">
                {negs.map((n) => (
                  <li key={n.id} className="px-5 py-2.5 text-sm"><b>{n.clause}</b> <Pill tone={n.action === "hold_escalate" ? "bad" : n.action === "accept_fix" ? "ok" : "warn"}>{NEGOTIATION_ACTION[n.action]}</Pill>
                    <div className="text-xs text-muted">Complexity {n.complexity} · risk {n.risk}{n.rationale ? ` · ${n.rationale}` : ""} · {n.logged_by ? personName(pMap.get(n.logged_by)) : ""} {timeAgo(n.created_at)}</div></li>
                ))}
              </ul>
            )}
            <div className="border-t border-line p-5">
              <ActionForm action={addNegotiation} submit="Log clause" hidden={{ contract_id: c.id }} inline resetOnOk>
                <Field label="Clause" className="min-w-[200px] flex-1"><input name="clause" required className="input" /></Field>
                <Field label="Complexity" className="w-28"><Select name="complexity" options={[{ value: "low", label: "Low" }, { value: "high", label: "High" }]} /></Field>
                <Field label="Risk" className="w-28"><Select name="risk" options={[{ value: "low", label: "Low" }, { value: "high", label: "High" }]} /></Field>
                <Field label="Rationale" className="min-w-[200px] flex-1"><input name="rationale" className="input" /></Field>
              </ActionForm>
            </div>
          </Panel>
        </div>

        <Panel title="Activity">
          <div className="border-b border-line p-4">
            <ActionForm action={commentContract} submit="Comment" hidden={{ contract_id: c.id }} resetOnOk variant="secondary">
              <textarea name="body" rows={2} required className="input" placeholder="Add a comment" aria-label="Comment" />
            </ActionForm>
          </div>
          {activity.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing yet.</p> : (
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-xs"><p className="font-semibold capitalize">{a.event_type}</p>{a.description && <p>{a.description}</p>}
                  <p className="text-muted">{a.actor ? personName(pMap.get(a.actor)) : "System"} · {timeAgo(a.created_at)}</p></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
