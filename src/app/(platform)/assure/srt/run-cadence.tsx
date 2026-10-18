"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/ui";
import { runReviewCadence, type OnbResult } from "@/app/(platform)/assure/onboarding-actions";

/** Creates the review tasks that are due now (SRT lead, Procurement head or Director, or admin). */
export function RunCadenceButton() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<OnbResult>({});
  return (
    <span className="flex items-center gap-2 text-xs">
      {r.message && <span className="text-ok">{r.message}</span>}
      {r.error && <span className="text-bad">{r.error}</span>}
      <button type="button" disabled={pending} className={btn.secondary} onClick={() => start(async () => setR(await runReviewCadence()))}>
        {pending ? "Checking…" : "Create due reviews"}
      </button>
    </span>
  );
}
