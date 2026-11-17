import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPefIndex } from "@/lib/pef-data";
import { Card, PageHead, Pill, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Impact Grade open issues" };

const BASE = "/impact-grade/watchtower";
const ORDER = ["high", "medium", "low"] as const;
const TONE = { high: "bad", medium: "warn", low: "neutral" } as const;

// The Anthesis consistency review plus what porting the workbook found. Each issue says how the model treats it
// today, so nobody mistakes a provisional result for an approved one. Decisions are recorded in the library.
export default async function Issues() {
  await requireInternal();
  const supabase = await createClient();
  const { libs } = await getPefIndex(supabase);
  const issues = [...(libs.pef_open_issues ?? [])].sort((a, b) =>
    ORDER.indexOf(a.data.severity as (typeof ORDER)[number]) - ORDER.indexOf(b.data.severity as (typeof ORDER)[number]) || Number(a.data.seq) - Number(b.data.seq));
  const open = issues.filter((i) => (i.data.status ?? "open") === "open");
  const count = (s: string) => open.filter((i) => i.data.severity === s).length;

  return (
    <>
      <PageHead crumbs={[{ label: "Impact Grade", href: "/impact-grade" }, { label: "Watchtower", href: BASE }, { label: "Open issues" }]} title="Open issues"
        sub="What has to be decided before grades are published. Record a decision by correcting the issue in the library (status and decision).">
        <Link href={`${BASE}/libraries/pef_open_issues`} className="text-sm font-semibold text-accent hover:underline">Manage in the library</Link>
      </PageHead>
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Open" value={open.length} />
        <Stat label="High" value={count("high")} tone={count("high") ? "bad" : "ok"} />
        <Stat label="Medium" value={count("medium")} tone={count("medium") ? "warn" : "ok"} />
        <Stat label="Decided or resolved" value={issues.length - open.length} />
      </section>
      <div className="space-y-3">
        {issues.map((i) => {
          const sev = (i.data.severity as (typeof ORDER)[number]) ?? "low";
          const status = String(i.data.status ?? "open");
          return (
            <Card key={i.code} className="p-5 text-sm">
              <div id={String(i.code)} className="flex flex-wrap items-center gap-2 scroll-mt-24">
                <span className="font-mono text-xs font-bold">{i.code}</span>
                <Pill tone={TONE[sev]}>{sev}</Pill>
                <Pill tone={status === "open" ? "warn" : "ok"}>{status}</Pill>
                {String(i.code).startsWith("PORT-") && <Pill tone="info">Found while porting</Pill>}
                <span className="text-xs text-muted">{String(i.data.location ?? "")}</span>
              </div>
              <h3 className="mt-1.5 font-bold">{i.name}</h3>
              <dl className="mt-2 grid gap-x-6 gap-y-2 md:grid-cols-2">
                {[["Evidence", i.data.evidence], ["Recommendation", i.data.recommendation], ["How the model treats it today", i.data.current_treatment], ["Decision", i.data.decision]]
                  .filter(([, v]) => v).map(([k, v]) => (
                    <div key={String(k)}><dt className="eyebrow">{String(k)}</dt><dd className="mt-0.5 text-muted">{String(v)}</dd></div>
                  ))}
              </dl>
            </Card>
          );
        })}
      </div>
    </>
  );
}
