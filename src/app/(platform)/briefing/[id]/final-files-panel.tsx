"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { FileUpload } from "@/components/file-upload";
import type { BriefDelivery } from "@/lib/creative-rfi";
import { sendFinalFiles, startFinalFiles, type ActionResult } from "../actions";

// Final creative files (GBT creative work, cr19): prepare the final files and send them to the client.

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function Files({ files }: { files: BriefDelivery["files"] }) {
  if (!files.length) return <p className="text-xs text-muted">No files yet.</p>;
  return (
    <ul className="space-y-0.5">{files.map((f) => (
      <li key={f.id} className="flex items-center gap-1.5"><MSymbol name="description" size={16} className="text-muted" />
        <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{f.file_name}</a></li>
    ))}</ul>
  );
}

export function FinalFilesPanel({ id, started, open, deliveries }: { id: string; started: boolean; open: boolean; deliveries: BriefDelivery[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [note, setNote] = useState("");
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => start(async () => { const r = await fn(); setRes(r); if (r.ok) { after?.(); router.refresh(); } });
  const draft = deliveries.find((d) => d.status === "draft");
  const sent = deliveries.filter((d) => d.status === "sent");

  return (
    <Panel title="Final files" sub="Prepare the final creative files and send them to the client. A corrected file goes out as a new delivery; earlier ones stay on record."
      actions={sent.length ? <Pill tone="ok">{sent.length} sent</Pill> : <Pill tone="neutral">Nothing sent</Pill>}>
      <div className="space-y-4 p-5 text-sm">
        {sent.map((d) => (
          <div key={d.id} className="space-y-1 rounded-xl border border-line p-3">
            <p className="font-semibold">Delivery {d.round} <Pill tone="ok">Sent {when(d.sent_at)}</Pill></p>
            {d.note && <p className="text-muted">{d.note}</p>}
            <Files files={d.files} />
          </div>
        ))}

        {draft && open && (
          <div className="space-y-3 rounded-xl border border-line p-3">
            <p className="font-semibold">Delivery {draft.round} <Pill tone="warn">Being prepared</Pill></p>
            <FileUpload module="briefing" entityType="brief_delivery" entityId={draft.id} label="final file" compact />
            <Files files={draft.files} />
            <div><label className="label" htmlFor="final-note">Note for the client (optional)</label>
              <input id="final-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <button className={btn.primary} disabled={pending || draft.files.length === 0} onClick={() => run(() => sendFinalFiles(id, draft.id, note), () => setNote(""))}>
              <MSymbol name="send" size={16} /> Send to the client
            </button>
            {draft.files.length === 0 && <p className="text-xs text-muted">Upload at least one file first.</p>}
          </div>
        )}

        {!draft && open && (started ? (
          <button className={btn.secondary} disabled={pending} onClick={() => run(() => startFinalFiles(id))}>
            <MSymbol name="upload_file" size={16} /> {sent.length ? "Send a corrected delivery" : "Prepare the final files"}
          </button>
        ) : <p className="rounded-lg bg-surface-2 p-3 text-muted">Final files can go out once creative work has started: the retainer kick-off, or the approved quote with the client PO confirmed.</p>)}
        {res && <p className={res.ok ? "text-ok" : "text-bad"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
      </div>
    </Panel>
  );
}
