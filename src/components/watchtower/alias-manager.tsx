"use client";

import { useState, useTransition } from "react";
import { addAlias, toggleAlias } from "@/app/(platform)/watchtower/library-actions";
import { btn } from "@/components/ui";

export function AliasManager({ recordId, aliases, canGovern }: { recordId: string; aliases: { id: string; alias: string; source_system: string | null; active: boolean }[]; canGovern: boolean }) {
  const [alias, setAlias] = useState("");
  const [source, setSource] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 px-5 py-4 text-sm">
      {aliases.length === 0 ? <p className="text-muted">No aliases.</p> : (
        <ul className="space-y-1">
          {aliases.map((a) => (
            <li key={a.id} className={`flex items-center justify-between gap-2 ${a.active ? "" : "opacity-50"}`}>
              <span><b>{a.alias}</b>{a.source_system ? <span className="text-muted"> · {a.source_system}</span> : null}</span>
              {canGovern && <button disabled={pending} onClick={() => start(async () => { const r = await toggleAlias(a.id); if (!r.ok) setErr(r.message); })} className="text-xs font-semibold text-accent hover:underline">{a.active ? "Disable" : "Enable"}</button>}
            </li>
          ))}
        </ul>
      )}
      {canGovern && (
        <form className="flex flex-wrap gap-2" action={() => start(async () => { const r = await addAlias(recordId, alias, source); if (r.ok) { setAlias(""); setSource(""); setErr(""); } else setErr(r.message); })}>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Alias" className="input min-w-0 flex-1" />
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source system" className="input w-36" />
          <button disabled={pending} className={btn.secondary}>Add</button>
        </form>
      )}
      {err && <p className="text-bad">{err}</p>}
    </div>
  );
}
