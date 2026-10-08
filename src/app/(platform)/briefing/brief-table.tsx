"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Card, Empty } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ApprovalPill, BriefStatusPill } from "@/components/briefing/labels";
import { BRIEF_STATUS, BRIEF_STATUSES, type Brief, type BriefStatus } from "@/lib/briefing";
import { formatDate } from "@/lib/srt";

export function BriefTable({ briefs, people }: { briefs: Brief[]; people: Record<string, string> }) {
  const [tab, setTab] = useState<"all" | BriefStatus | "mine_to_review">("all");
  const [q, setQ] = useState("");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: briefs.length };
    for (const s of BRIEF_STATUSES) c[s] = briefs.filter((b) => b.status === s).length;
    return c;
  }, [briefs]);
  const rows = briefs.filter((b) => {
    if (tab !== "all" && b.status !== tab) return false;
    const hay = `${b.brief_code} ${b.title} ${b.client ?? ""} ${b.brand ?? ""} ${b.market ?? ""} ${b.campaign_name ?? ""}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  });
  const tabs: { k: "all" | BriefStatus; l: string }[] = [{ k: "all", l: "All" }, ...BRIEF_STATUSES.map((s) => ({ k: s, l: BRIEF_STATUS[s].label }))];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1" role="tablist">
          {tabs.map((t) => (
            <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
              className={clsx("rounded-md px-3 py-1.5 text-xs font-semibold transition", tab === t.k ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}>
              {t.l} <span className="opacity-70">{counts[t.k] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="relative min-w-[220px] max-w-xs flex-1">
          <span className="sr-only">Search briefs</span>
          <MSymbol name="search" size={18} className="absolute left-2.5 top-2.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, client, brand, market…" className="input pl-8" />
        </label>
      </div>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <Empty title="No briefs here yet">Capture a brief, or start from a campaign objective with Campaign ideation.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr><th className="th">Brief</th><th className="th">Client · brand</th><th className="th">Market</th><th className="th">Campaign</th><th className="th">Status</th><th className="th">Target launch</th><th className="th">Author</th></tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="td">
                    <Link href={`/briefing/${b.id}`} className="font-semibold hover:underline">{b.title}</Link>
                    <p className="text-xs text-muted">{b.brief_code}{b.revision_count > 0 ? ` · revised v${b.revision_count}` : ""}</p>
                  </td>
                  <td className="td">{[b.client, b.brand].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="td whitespace-nowrap">{b.market ?? "—"}<span className="text-xs text-muted">{b.region ? ` · ${b.region}` : ""}</span></td>
                  <td className="td">{b.campaign_id ? <Link href={`/briefing/campaigns/${b.campaign_id}`} className="hover:underline">{b.campaign_name}</Link> : "—"}</td>
                  <td className="td"><div className="flex flex-wrap gap-1"><BriefStatusPill status={b.status} />{b.status === "submitted" && <ApprovalPill status={b.approval_status} />}</div></td>
                  <td className="td whitespace-nowrap text-xs text-muted">{formatDate(b.target_launch) || "—"}</td>
                  <td className="td text-xs text-muted">{b.created_by ? people[b.created_by] ?? "—" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
