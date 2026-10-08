import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { getLibraryNames, getSupplier, rows } from "@/lib/assure-data";
import { ACK_STATUS, NCR_SEVERITY, type Activity, type CorrectiveAction, type Ncr } from "@/lib/assure";
import { formatDate, personName, timeAgo } from "@/lib/srt";
import { Empty, PageHead, Panel, Pill } from "@/components/ui";
import { Date_, Facts, OptPill, SupplierLink } from "@/components/assure/bits";
import { ActionForm, Field, Select } from "@/components/assure/action-form";
import { addCorrectiveAction, closeNcr, setCorrectiveAction, setNcrNotes } from "../../../srm-actions";

export const metadata: Metadata = { title: "NCR" };

export default async function NcrPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("ncrs").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const n = data as Ncr;
  const [supplier, actions, catNames, people, acts] = await Promise.all([
    getSupplier(supabase, n.supplier_id),
    rows<CorrectiveAction>(supabase, "ncr_corrective_actions", { eq: ["ncr_id", id], order: "created_at", asc: true }),
    getLibraryNames(supabase, "ncr_categories"),
    getInternalPeople(supabase),
    rows<Activity>(supabase, "assure_activity", { eq: ["entity_id", id], order: "created_at" }),
  ]);
  const pMap = byId(people);
  const who = (pid: string | null) => (pid ? pMap.get(pid) ? personName(pMap.get(pid)) : "Vendor" : "System");
  const open = n.status === "open";

  return (
    <>
      <PageHead title={n.title} sub={`${n.ncr_ref} · raised ${formatDate(n.created_at)}${n.raised_by ? ` by ${who(n.raised_by)}` : ""}`}
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Quality", href: "/assure/quality" }, { label: n.ncr_ref }]}>
        <Pill tone={open ? "warn" : "neutral"}>{n.status}</Pill>
      </PageHead>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Details" className="xl:col-span-2">
          <div className="space-y-4 p-5">
            <Facts cols={3} items={[
              ["Supplier", <SupplierLink key="s" id={n.supplier_id} name={supplier?.name} tab="quality" />], ["Category", catNames.get(n.category_id)],
              ["Severity", <OptPill key="v" list={NCR_SEVERITY} value={n.severity} />], ["PO reference", n.po_reference], ["Response due", <Date_ key="d" d={n.due_date} />],
              ["Vendor", <OptPill key="a" list={ACK_STATUS} value={n.acknowledgement_status} />],
            ]} />
            {n.description && <p className="text-sm">{n.description}</p>}
            {(n.supplier_response || n.root_cause) && (
              <div className="rounded-lg bg-surface-2 p-3 text-sm">
                <p className="font-semibold">Vendor response</p>
                {n.root_cause && <p><span className="text-muted">Root cause:</span> {n.root_cause}</p>}
                {n.supplier_response && <p>{n.supplier_response}</p>}
              </div>
            )}
            {!open && <p className="text-sm"><b>{n.status === "closed" ? "Closed" : "Cancelled"}</b> by {who(n.closed_by)}{n.closed_at ? ` on ${formatDate(n.closed_at)}` : ""}: {n.close_note}</p>}
          </div>
        </Panel>
        <Panel title="Internal notes" sub="Never shown to the vendor">
          <div className="p-5">
            <ActionForm action={setNcrNotes} submit="Save notes" hidden={{ id: n.id }} variant="secondary">
              <textarea name="internal_notes" rows={4} defaultValue={n.internal_notes ?? ""} className="input" aria-label="Internal notes" />
            </ActionForm>
          </div>
        </Panel>
      </div>

      <Panel title="Corrective actions" sub="The vendor marks their actions done; staff verify, and never the person who completed it. Every action must be verified before the NCR closes.">
        {actions.length === 0 ? <Empty title="No corrective actions yet" /> : (
          <table className="w-full text-sm">
            <thead><tr>{["Action", "Owner", "Due", "Status", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="td">{a.description}{a.done_note && <div className="text-xs text-muted">{a.done_note}</div>}</td>
                  <td className="td">{a.owner_side === "supplier" ? "Vendor" : "adm Indicia"}</td>
                  <td className="td"><Date_ d={a.due_date} /></td>
                  <td className="td">
                    <Pill tone={a.status === "verified" ? "ok" : a.status === "done" ? "info" : "warn"}>{a.status === "done" ? "Done, to verify" : a.status}</Pill>
                    {a.done_by && <div className="text-xs text-muted">Done by {who(a.done_by)}</div>}
                    {a.verified_by && <div className="text-xs text-muted">Verified by {who(a.verified_by)}</div>}
                  </td>
                  <td className="td">
                    {open && a.status === "open" && a.owner_side === "internal" && <ActionForm action={setCorrectiveAction} submit="Mark done" hidden={{ id: a.id, ncr_id: n.id, status: "done" }} variant="secondary" inline />}
                    {open && a.status === "done" && (a.done_by === me.id ? <span className="text-xs text-muted">Someone else verifies</span>
                      : <ActionForm action={setCorrectiveAction} submit="Verify" hidden={{ id: a.id, ncr_id: n.id, status: "verified" }} inline />)}
                    {open && a.status !== "open" && (
                      <details className="mt-1"><summary className="cursor-pointer text-xs text-accent">Reopen</summary>
                        <ActionForm action={setCorrectiveAction} submit="Reopen" hidden={{ id: a.id, ncr_id: n.id, status: "open" }} variant="danger" className="mt-1 w-56">
                          <input name="note" required className="input" placeholder="Why" aria-label="Reason" />
                        </ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {open && (
          <div className="border-t border-line p-5">
            <ActionForm action={addCorrectiveAction} submit="Add corrective action" hidden={{ ncr_id: n.id }} inline resetOnOk>
              <Field label="Action" className="min-w-[260px] flex-1"><input name="description" required className="input" /></Field>
              <Field label="Owner" className="w-40"><Select name="owner_side" options={[{ value: "supplier", label: "Vendor" }, { value: "internal", label: "adm Indicia" }]} /></Field>
              <Field label="Due" className="w-44"><input name="due_date" type="date" className="input" /></Field>
            </ActionForm>
          </div>
        )}
      </Panel>

      {open && (
        <Panel title="Close or cancel">
          <div className="p-5">
            <ActionForm action={closeNcr} submit="Save" hidden={{ id: n.id }} inline confirm="Close or cancel this NCR? It can't be reopened.">
              <Field label="Outcome" className="w-40"><Select name="outcome" options={[{ value: "closed", label: "Close" }, { value: "cancelled", label: "Cancel" }]} /></Field>
              <Field label="Note" className="min-w-[280px] flex-1"><input name="note" required className="input" placeholder="What was checked" /></Field>
            </ActionForm>
          </div>
        </Panel>
      )}

      <Panel title="History">
        {acts.length === 0 ? <Empty title="No history" /> : (
          <ol className="divide-y divide-line">
            {acts.map((a) => (
              <li key={a.id} className="px-5 py-2.5 text-sm"><b>{a.title ?? a.action}</b>{a.body && <span className="text-muted"> · {a.body}</span>}<div className="text-xs text-muted">{who(a.actor)} · {timeAgo(a.created_at)}</div></li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}
