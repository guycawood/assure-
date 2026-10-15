"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { unsubscribe } from "../../actions";

export function UnsubscribeButton({ token }: { token: string }) {
  const [result, setResult] = useState<{ ok: boolean; email?: string | null; internal?: boolean } | null>(null);
  const [pending, start] = useTransition();
  if (result) {
    return result.ok
      ? <p className="text-sm font-semibold text-ok" role="status">{result.internal ? "Noted. Internal messages are part of your work, so they will still come through." : `Done. ${result.email ?? "You"} will no longer get these emails.`}</p>
      : <p className="text-sm text-bad" role="alert">This link doesn&apos;t work. Ask your adm Indicia contact to remove you.</p>;
  }
  return <button type="button" disabled={pending} className={btn.primary} onClick={() => start(async () => setResult(await unsubscribe(token)))}>{pending ? "Working…" : "Unsubscribe"}</button>;
}
