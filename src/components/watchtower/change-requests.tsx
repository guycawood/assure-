import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { canGovern } from "@/lib/library-data";
import { moduleByKey } from "@/modules/registry";
import { personName, timeAgo } from "@/lib/srt";
import { Card, Empty, PageHead, Pill, type Crumb } from "@/components/ui";
import { CrActions } from "./cr-actions";

export type ChangeRequest = {
  id: string; request_no: number; module: string; source_area: string | null; library_key: string | null; record_id: string | null;
  request_text: string; category: string | null; impact_level: string | null; status: string; requested_by: string | null; requester_type: string;
  requested_at: string; review_notes: string | null; principles_checked: string[]; conflicts_with_principle: boolean; reviewed_by: string | null;
  reviewed_at: string | null; implementation_notes: string | null; implemented_by: string | null; implementation_check_notes: string | null; verified_by: string | null;
};

export const CR_CATEGORY: Record<string, string> = {
  data_integrity: "Data integrity", access_control: "Access control", provenance: "Provenance", governance_ownership: "Governance & ownership", user_experience: "User experience",
};
const IMPACT_FROM_CATEGORY: Record<string, string> = { access_control: "high", data_integrity: "high", governance_ownership: "medium", provenance: "low", user_experience: "low" };
export const CR_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }> = {
  logged: { label: "Logged", tone: "info" }, under_review: { label: "Under review", tone: "warn" }, needs_clarification: { label: "Needs clarification", tone: "warn" },
  approved: { label: "Approved", tone: "ok" }, rejected: { label: "Rejected", tone: "bad" },
  implemented_pending_verification: { label: "Implemented, to verify", tone: "info" }, verified_complete: { label: "Verified and closed", tone: "neutral" },
};
const impactOf = (r: ChangeRequest) => r.impact_level ?? (r.category ? IMPACT_FROM_CATEGORY[r.category] : null) ?? "medium";
const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Change request queue: one module's, or all (master). Grouped by impact, newest first. */
export async function ChangeRequests({ module, crumbs, view }: { module?: string; crumbs: Crumb[]; view?: string }) {
  const me = await requireInternal();
  const supabase = await createClient();
  let q = supabase.from("change_requests").select("*");
  if (module) q = q.eq("module", module);
  const [{ data }, people, { data: principles }] = await Promise.all([
    q.order("requested_at", { ascending: false }).limit(500),
    getInternalPeople(supabase),
    supabase.from("library_records").select("id, code, name, data").eq("library_key", "core_principles").eq("status", "active"),
  ]);
  const all = (data ?? []) as ChangeRequest[];
  const completed = view === "completed";
  const rows = all.filter((r) => (completed ? ["verified_complete", "rejected"].includes(r.status) : !["verified_complete", "rejected"].includes(r.status)))
    .sort((a, b) => RANK[impactOf(a)] - RANK[impactOf(b)] || b.requested_at.localeCompare(a.requested_at));
  const pMap = byId(people);
  const governMods = new Map<string, boolean>();
  for (const m of new Set(rows.map((r) => r.module))) governMods.set(m, await canGovern(supabase, m));
  const prin = ((principles ?? []) as { id: string; code: string | null; name: string; data: { category?: string; description?: string } }[]).map((p) => ({
    id: p.id, code: p.code, title: p.name, category: p.data.category ?? "", description: p.data.description ?? "",
  }));

  return (
    <>
      <PageHead crumbs={crumbs} title="Change requests" sub="Suggestions from anyone using System Guy, reviewed against the core principles before anything changes. Use “Suggest a change” in any sidebar to add one." />
      <div className="flex gap-2 text-sm">
        <Link href="?" className={`rounded-full border px-3 py-1 font-semibold ${!completed ? "border-accent bg-accent-soft" : "border-line"}`}>Active ({all.filter((r) => !["verified_complete", "rejected"].includes(r.status)).length})</Link>
        <Link href="?view=completed" className={`rounded-full border px-3 py-1 font-semibold ${completed ? "border-accent bg-accent-soft" : "border-line"}`}>Closed ({all.filter((r) => ["verified_complete", "rejected"].includes(r.status)).length})</Link>
      </div>
      <Card>
        {rows.length === 0 ? <Empty title={completed ? "Nothing closed yet" : "No open change requests"}>New suggestions appear here for review.</Empty> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const st = CR_STATUS[r.status];
              const impact = impactOf(r);
              return (
                <li key={r.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-muted">CR-{String(r.request_no).padStart(4, "0")}</span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                      <Pill tone={impact === "high" ? "bad" : impact === "medium" ? "warn" : "neutral"}>{impact} impact</Pill>
                      {r.category && <Pill>{CR_CATEGORY[r.category]}</Pill>}
                      {!module && <Pill tone="info">{moduleByKey(r.module)?.name ?? r.module}</Pill>}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap">{r.request_text}</p>
                    <p className="mt-1 text-xs text-muted">
                      {personName(r.requested_by ? pMap.get(r.requested_by) : null)} ({r.requester_type}) · {timeAgo(r.requested_at)}{r.source_area ? ` · from ${r.source_area}` : ""}
                      {r.reviewed_by ? ` · reviewed by ${personName(pMap.get(r.reviewed_by))}` : ""}
                    </p>
                    {r.review_notes && <p className="mt-1 text-sm text-muted">Review: {r.review_notes}</p>}
                    {r.implementation_notes && <p className="text-sm text-muted">Implemented: {r.implementation_notes}</p>}
                    {r.implementation_check_notes && <p className="text-sm text-muted">Verified: {r.implementation_check_notes}</p>}
                  </div>
                  {governMods.get(r.module) && <CrActions request={r} principles={prin} me={me.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
