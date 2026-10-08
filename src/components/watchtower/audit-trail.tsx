import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { getAudit } from "@/lib/library-data";
import { moduleByKey } from "@/modules/registry";
import { personName, timeAgo } from "@/lib/srt";
import { Card, Empty, PageHead, Pill, type Crumb } from "@/components/ui";

type Entry = { at: string; module: string; source: string; what: string; detail: string; actor: string | null };

/** One audit trail across sources: libraries, change requests, scoring methodology, onboarding gates. Filter by module. */
export async function AuditTrail({ module, crumbs }: { module?: string; crumbs: Crumb[] }) {
  await requireInternal();
  const supabase = await createClient();
  const [lib, people, cr, crHeads, sc, gates] = await Promise.all([
    getAudit(supabase, { module, limit: 200 }),
    getInternalPeople(supabase),
    supabase.from("change_request_events").select("change_request_id, to_status, note, actor, at").order("at", { ascending: false }).limit(200),
    supabase.from("change_requests").select("id, request_no, module").limit(2000),
    !module || module === "assure" ? supabase.from("scorecard_audit").select("action, detail, actor, at").order("at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    !module || module === "assure" ? supabase.from("gate_audit_log").select("gate_key, from_status, to_status, note, actor, created_at").order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  const pMap = byId(people);
  const heads = new Map(((crHeads.data ?? []) as { id: string; request_no: number; module: string }[]).map((h) => [h.id, h]));

  const entries: Entry[] = [
    ...lib.map((a) => ({ at: a.at, module: a.module, source: "Library", what: `${a.action.replace("_", " ")} · ${a.record_name ?? ""}`, detail: [a.library_key?.replace(/_/g, " "), a.note, a.changes.length ? `${a.changes.length} field${a.changes.length === 1 ? "" : "s"} changed` : ""].filter(Boolean).join(" · "), actor: a.actor })),
    ...((cr.data ?? []) as { change_request_id: string; to_status: string; note: string | null; actor: string | null; at: string }[])
      .map((e) => ({ ...e, change_requests: heads.get(e.change_request_id) ?? null }))
      .filter((e) => !module || e.change_requests?.module === module)
      .map((e) => ({ at: e.at, module: e.change_requests?.module ?? "watchtower", source: "Change request", what: `CR-${String(e.change_requests?.request_no ?? 0).padStart(4, "0")} → ${e.to_status.replace(/_/g, " ")}`, detail: e.note ?? "", actor: e.actor })),
    ...((sc.data ?? []) as { action: string; detail: { note?: string } | null; actor: string | null; at: string }[])
      .map((e) => ({ at: e.at, module: "assure", source: "Scoring methodology", what: e.action.replace("_", " "), detail: e.detail?.note ?? "", actor: e.actor })),
    ...((gates.data ?? []) as { gate_key: string; from_status: string; to_status: string; note: string | null; actor: string | null; created_at: string }[])
      .map((e) => ({ at: e.created_at, module: "assure", source: "Onboarding gate", what: `${e.gate_key.replace(/_/g, " ")}: ${e.from_status} → ${e.to_status}`, detail: e.note ?? "", actor: e.actor })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);

  const sources = [...new Set(entries.map((e) => e.source))];
  return (
    <>
      <PageHead crumbs={crumbs} title="Audit trail" sub="Every governed change, who made it and when. Entries can't be edited or deleted." />
      <div className="flex flex-wrap gap-2 text-xs">{sources.map((s) => <Pill key={s} tone="info">{s} · {entries.filter((e) => e.source === s).length}</Pill>)}</div>
      <Card>
        {entries.length === 0 ? <Empty title="No changes recorded yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">When</th>{!module && <th className="th">Module</th>}<th className="th">Source</th><th className="th">Change</th><th className="th">Detail</th><th className="th">By</th></tr></thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td className="td whitespace-nowrap text-xs text-muted">{timeAgo(e.at)}</td>
                    {!module && <td className="td text-xs">{moduleByKey(e.module)?.name ?? e.module}</td>}
                    <td className="td text-xs">{e.source}</td>
                    <td className="td font-semibold capitalize">{e.what}</td>
                    <td className="td max-w-[360px] text-xs text-muted">{e.detail}</td>
                    <td className="td whitespace-nowrap text-xs">{e.actor ? personName(pMap.get(e.actor)) : "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
