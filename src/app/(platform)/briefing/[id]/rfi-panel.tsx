"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { RFI_INVITE_STATUS, type CreativeRfi } from "@/lib/creative-rfi";
import { addCreativeRfiSupplier, createCreativeRfi, selectCreativeProposal, type ActionResult } from "../actions";

// Creative RFI to panel suppliers (GBT creative work): cr11 prepare the supplier brief and send the RFI, cr12 suppliers confirm or reject,
// cr12a they accept the IP rule and send an ideation proposal, cr12b a rejection is logged and another supplier can be added.

type Option = { id: string; name: string; detail: string };
const DEFAULT_IP = "All rights in the proposed work pass to us and its client on payment.";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

export function RfiPanel({ id, briefTitle, started, open, rfis, suppliers }: {
  id: string; briefTitle: string; started: boolean; open: boolean; rfis: CreativeRfi[]; suppliers: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [title, setTitle] = useState(briefTitle);
  const [brief, setBrief] = useState("");
  const [ip, setIp] = useState(DEFAULT_IP);
  const [due, setDue] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [add, setAdd] = useState<Record<string, string>>({});
  const [selNote, setSelNote] = useState("");
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => start(async () => { const r = await fn(); setRes(r); if (r.ok) { after?.(); router.refresh(); } });

  return (
    <Panel title="Creative RFI to panel suppliers" sub="The supplier route: send a supplier brief to panel suppliers from SRM. They confirm or decline, accept the IP rule and send an ideation proposal.">
      <div className="space-y-4 p-5 text-sm">
        {rfis.map((r) => {
          const free = suppliers.filter((s) => !r.invites.some((i) => i.supplier_id === s.id));
          return (
            <div key={r.id} className="space-y-3 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{r.title}</b> <Pill tone={r.status === "open" ? "info" : "neutral"}>{r.status === "open" ? "Open" : "Closed"}</Pill>
                <span className="text-xs text-muted">Due {when(r.due_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-muted">{r.supplier_brief}</p>
              <p className="text-xs text-muted">IP rule: {r.ip_rule}</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {r.invites.map((i) => {
                  const st = RFI_INVITE_STATUS[i.status];
                  return (
                    <li key={i.id} className="space-y-1 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2"><b>{i.supplier_name}</b> <Pill tone={st.tone}>{st.label}</Pill></div>
                      {i.status === "rejected" && <p className="text-bad">{i.reject_reason}</p>}
                      {i.proposal_note && <p className="whitespace-pre-wrap">{i.proposal_note}</p>}
                      {i.files.length > 0 && (
                        <ul className="space-y-0.5">{i.files.map((f) => (
                          <li key={f.id} className="flex items-center gap-1.5"><MSymbol name="description" size={16} className="text-muted" />
                            <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{f.file_name}</a></li>
                        ))}</ul>
                      )}
                      {i.proposed_at && <p className="text-xs text-muted">Proposal sent {when(i.proposed_at)}{i.ip_confirmed_at ? ", IP rule accepted" : ""}.</p>}
                      {i.status === "selected" && i.selected_note && <p className="text-xs text-muted">Why: {i.selected_note}</p>}
                      {r.status === "open" && i.status === "proposed" && open && (
                        <div className="flex flex-wrap items-end gap-2 pt-1">
                          <input aria-label="Why this proposal" className="input min-w-48 flex-1" placeholder="Why this one (optional)" value={selNote} onChange={(e) => setSelNote(e.target.value)} />
                          <button className={btn.primary} disabled={pending} onClick={() => run(() => selectCreativeProposal(id, i.id, selNote), () => setSelNote(""))}>
                            <MSymbol name="check_circle" size={16} /> Select this proposal
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {r.status === "open" && open && free.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-56 flex-1">
                    <label className="label" htmlFor={`add-${r.id}`}>Add another supplier</label>
                    <select id={`add-${r.id}`} className="input" value={add[r.id] ?? ""} onChange={(e) => setAdd((a) => ({ ...a, [r.id]: e.target.value }))}>
                      <option value="">Choose</option>{free.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.detail}</option>)}
                    </select>
                  </div>
                  <button className={btn.secondary} disabled={pending || !add[r.id]} onClick={() => run(() => addCreativeRfiSupplier(id, r.id, add[r.id]))}>
                    <MSymbol name="person_add" size={16} /> Invite
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {!started ? (
          <p className="rounded-lg bg-surface-2 p-3 text-muted">The RFI can go out once creative work has started: the retainer kick-off, or the approved quote with the client PO confirmed.</p>
        ) : open && (
          <details open={rfis.length === 0}>
            <summary className="cursor-pointer font-semibold text-accent">{rfis.length ? "Send another RFI" : "Prepare the supplier brief and send the RFI"}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="rfi-title">Title</label><input id="rfi-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><label className="label" htmlFor="rfi-due">Proposals due</label><input id="rfi-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="rfi-brief">Supplier brief (suppliers see this, not the client&apos;s name)</label>
                <textarea id="rfi-brief" rows={4} className="input" value={brief} onChange={(e) => setBrief(e.target.value)} /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="rfi-ip">IP rule the supplier must accept</label>
                <textarea id="rfi-ip" rows={2} className="input" value={ip} onChange={(e) => setIp(e.target.value)} /></div>
              <fieldset className="sm:col-span-2">
                <legend className="label">Panel suppliers (active and not blocked in SRM)</legend>
                <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
                  {suppliers.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} /> {s.name} <span className="text-xs text-muted">{s.detail}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <button className={`${btn.primary} mt-3`} disabled={pending || picked.length === 0 || !due || brief.trim().length < 10}
              onClick={() => run(() => createCreativeRfi(id, { title, supplier_brief: brief, ip_rule: ip, due_date: due }, picked), () => { setBrief(""); setPicked([]); })}>
              <MSymbol name="send" size={16} /> Send RFI to {picked.length || "the"} supplier{picked.length === 1 ? "" : "s"}
            </button>
          </details>
        )}
        {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
      </div>
    </Panel>
  );
}
