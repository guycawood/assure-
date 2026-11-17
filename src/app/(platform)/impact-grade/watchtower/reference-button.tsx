"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { proposePefReference } from "./actions";

export function ProposeReferenceButton() {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn.secondary} disabled={pending} onClick={() => start(async () => setMsg(await proposePefReference()))}>
        {pending ? "Calculating…" : "Propose from our results"}
      </button>
      {msg && <span className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.message}</span>}
    </div>
  );
}
