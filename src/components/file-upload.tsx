"use client";

import { useRef, useState, useTransition } from "react";
import { uploadFile, type UploadResult } from "@/app/files-actions";
import { MSymbol } from "@/components/symbol";

/** Drop or pick a file; it is attached to the given record. Use <FileList> to show what's attached. */
export function FileUpload({ module, entityType, entityId, supplierId, label, accept, compact }: {
  module: string; entityType: string; entityId: string; supplierId?: string | null; label?: string; accept?: string; compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<UploadResult | null>(null);
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();

  const send = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("module", module);
    fd.set("entity_type", entityType);
    fd.set("entity_id", entityId);
    if (supplierId) fd.set("supplier_id", supplierId);
    if (label) fd.set("label", label);
    start(async () => setMsg(await uploadFile(fd)));
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) send(f); }}
        disabled={pending}
        className={`flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 text-left text-sm transition ${compact ? "py-2" : "py-4"} ${over ? "border-accent bg-accent-soft" : "border-line hover:border-accent/50 hover:bg-surface-2"}`}
      >
        <MSymbol name={pending ? "progress_activity" : "upload_file"} size={22} className={pending ? "animate-spin text-accent" : "text-muted"} />
        <span>
          <span className="block font-semibold">{pending ? "Uploading…" : label ? `Upload ${label.toLowerCase()}` : "Upload a file"}</span>
          {!compact && <span className="block text-xs text-muted">Drag a file here or click to choose. PDF, images, Office or CSV, up to 15 MB.</span>}
        </span>
      </button>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ""; }} />
      {msg && <p className={`mt-1.5 text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.message}</p>}
    </div>
  );
}
