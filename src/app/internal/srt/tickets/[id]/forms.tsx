"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { addComment, createSupplierFromTicket, updateTicket, type ActionResult } from "@/app/internal/actions";
import { PRIORITIES, TICKET_STATUS } from "@/lib/srt";
import { btn } from "@/components/ui";

type Opt = { id: string; name: string };

export function TicketUpdateForm({
  ticket, people, canChangeDue, gateLabel,
}: {
  ticket: { id: string; status: string; priority: string; assignee: string | null; owner: string | null; due_date: string | null; resolution: string | null };
  people: Opt[];
  canChangeDue: boolean;
  gateLabel: string | null;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateTicket.bind(null, ticket.id), {});
  const [status, setStatus] = useState(ticket.status);

  return (
    <form action={action} className="space-y-3 text-sm">
      <div>
        <label className="label" htmlFor="status">Status</label>
        <select id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="input">
          {TICKET_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {status === "resolved" && (
        <div>
          <label className="label" htmlFor="resolution">Resolution</label>
          <select id="resolution" name="resolution" defaultValue={ticket.resolution ?? "completed"} className="input">
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
            <option value="duplicate">Duplicate</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
      )}
      {status === "resolved" && gateLabel && (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="verify_gate" defaultChecked className="mt-1" />
          <span>Also mark <b>{gateLabel}</b> as verified</span>
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="priority">Priority</label>
          <select id="priority" name="priority" defaultValue={ticket.priority} className="input">
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="due_date">Due</label>
          <input id="due_date" name="due_date" type="date" defaultValue={ticket.due_date ?? ""} readOnly={!canChangeDue} className="input" title={canChangeDue ? undefined : "Only an SRT lead can change the due date"} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="assignee">SRT assignee</label>
        <select id="assignee" name="assignee" defaultValue={ticket.assignee ?? ""} className="input">
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="owner">Procurement owner</label>
        <select id="owner" name="owner" defaultValue={ticket.owner ?? ""} className="input">
          <option value="">None</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {state.error && <p className="text-bad" role="alert">{state.error}</p>}
      {state.ok && state.message && <p className="text-ok" role="status">{state.message}</p>}
      <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}

export function CommentForm({ ticketId }: { ticketId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, fd) => {
    const r = await addComment(ticketId, prev, fd);
    if (r.ok) ref.current?.reset();
    return r;
  }, {});
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <textarea name="body" rows={2} className="input" placeholder="Add an update: chased vendor, document received, escalated…" aria-label="Update" />
      <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Posting…" : "Post"}</button>
      {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
    </form>
  );
}

export function CreateSupplierButton({ ticketId }: { ticketId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>({});
  return (
    <div className="space-y-1">
      <button type="button" disabled={pending} className={btn.secondary} onClick={() => start(async () => setResult(await createSupplierFromTicket(ticketId)))}>
        {pending ? "Creating…" : "Create supplier record"}
      </button>
      {result.error && <p className="text-bad">{result.error}</p>}
    </div>
  );
}
