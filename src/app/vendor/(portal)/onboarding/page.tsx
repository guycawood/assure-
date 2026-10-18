import Link from "next/link";
import { clsx } from "clsx";
import { requireVendorCompany } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import type { VendorTracker } from "@/lib/onboarding";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";

export const metadata = { title: "Your onboarding" };

// What a finished step says (the stage's own text describes the work still to do).
const DONE_TEXT: Record<number, string> = {
  1: "adm Indicia confirmed why a new supplier is needed.",
  2: "Your onboarding request was prepared.",
  3: "adm Indicia Procurement approved the request.",
  4: "Your information, documents and certificates were received and checked.",
  5: "adm Indicia reviewed and accepted the evidence.",
  6: "The agreements are signed.",
  7: "adm Indicia Finance confirmed your bank and tax details.",
  8: "You are set up in adm Indicia's systems.",
  9: "Training complete. You are ready to receive work.",
};

// The vendor's own onboarding, in plain words: the nine steps, what adm Indicia needs from them now, and any items they
// must close by a date (fast-track). Only vendor-facing items; internal notes and approvals are never shown here.
export default async function VendorOnboardingPage() {
  await requireVendorCompany();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_onboarding_tracker", {});
  const t = data as VendorTracker | null;
  if (error || !t) return <><PageHead title="Your onboarding" /><Card><Empty title="Your onboarding status isn't available right now" /></Card></>;
  const current = t.stages.find((s) => s.status === "current");

  return (
    <>
      <PageHead title="Your onboarding" sub={t.released ? `${t.name} is fully onboarded with adm Indicia.` : `Where ${t.name} is in onboarding with adm Indicia, and what we need from you.`} />

      {t.blocked_by_overdue && (
        <Card className="border-bad bg-bad-soft p-4 text-sm">
          <b>Some items are past their due date.</b> adm Indicia can&apos;t place new orders with you until they are complete. Please send them as soon as possible.
        </Card>
      )}
      {t.exception && !t.blocked_by_overdue && (
        <Card className="border-warn bg-warn-soft p-4 text-sm">
          You can work on the agreed urgent job while you finish onboarding. Please complete the items below by their due dates.
        </Card>
      )}

      <Panel title="Your steps" sub={t.released ? "All nine steps complete." : current ? `Now: step ${current.stage_no}, ${current.label}` : undefined}>
        <ol className="divide-y divide-line">
          {t.stages.map((s) => (
            <li key={s.stage_no} className="flex items-start gap-3 px-5 py-3 text-sm">
              <span className={clsx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                s.status === "done" ? "bg-ok text-white" : s.status === "current" ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}>{s.status === "done" ? "✓" : s.stage_no}</span>
              <div className="min-w-0 flex-1">
                <p className={clsx("font-semibold", s.status === "upcoming" && "text-muted")}>{s.label}</p>
                <p className="text-muted">{s.status === "done" ? (DONE_TEXT[s.stage_no] ?? "Complete.") : s.text}</p>
              </div>
              {s.needs_you && s.status !== "upcoming" && <Pill tone="warn">Needs you</Pill>}
            </li>
          ))}
        </ol>
      </Panel>

      {(t.remediation.length > 0 || t.gaps.length > 0) && (
        <Panel title="Items to complete by a date">
          <ul className="divide-y divide-line text-sm">
            {t.remediation.map((r, i) => (
              <li key={`r${i}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <span>{r.item}</span>
                <span>{r.overdue ? <Pill tone="bad">Overdue since {formatDate(r.due_date)}</Pill> : <Pill tone="warn">Due {formatDate(r.due_date)}</Pill>}</span>
              </li>
            ))}
            {t.gaps.map((g, i) => (
              <li key={`g${i}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <span>{g.item}</span><Pill tone="warn">Agreed for {formatDate(g.due_date)}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {t.items.length > 0 && (
        <Panel title="What we need from you" sub="Upload documents on Certificates & documents, answer the information request, and sign agreements on Contracts.">
          <ul className="divide-y divide-line text-sm">
            {t.items.map((i, k) => (
              <li key={k} className="flex flex-wrap items-start justify-between gap-2 px-5 py-2.5">
                <span>{i.label}{i.what_to_fix && <span className="block text-xs text-bad">What to fix: {i.what_to_fix}</span>}{i.expired && <span className="block text-xs text-bad">Expired: please send a current one</span>}</span>
                <Pill tone={i.status === "Please resubmit" ? "bad" : i.status === "Received, being checked" ? "info" : "warn"}>{i.status}</Pill>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-4 border-t border-line px-5 py-3 text-sm">
            <Link href="/vendor/information-request" className="font-semibold text-accent hover:underline">Information request</Link>
            <Link href="/vendor/compliance" className="font-semibold text-accent hover:underline">Certificates & documents</Link>
            <Link href="/vendor/contracts" className="font-semibold text-accent hover:underline">Contracts</Link>
            <Link href="/vendor/training" className="font-semibold text-accent hover:underline">Training</Link>
          </div>
        </Panel>
      )}
    </>
  );
}
