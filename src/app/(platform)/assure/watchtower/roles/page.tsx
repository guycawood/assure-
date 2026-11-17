import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/assure/action-form";
import { assignRole, removeRole } from "./actions";

export const metadata: Metadata = { title: "Roles and access" };

type Role = { key: string; label: string; rank: number; description: string | null; capabilities: string[] };
type Cap = { key: string; label: string; description: string };
type Person = { id: string; full_name: string | null; email: string; srt_role: string | null; is_admin: boolean; user_type: string };
type Assignment = { user_id: string; role_key: string; assigned_by: string | null; assigned_at: string };
type Event = { id: number; user_id: string | null; action: string; from_role: string | null; to_role: string | null; note: string | null; actor: string | null; at: string };

const LEGACY: Record<string, string> = { agent: "SRT agent", lead: "SRT lead", finance: "Finance", procurement: "Procurement", head: "Procurement head", director: "Procurement director" };
const when = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// SRM's role levels: the five procurement and supply chain levels, what each can see and do, and who holds each.
export default async function SrmRoles() {
  await requireInternal();
  const supabase = await createClient();
  const [roles, caps, assigned, people, events, can] = await Promise.all([
    supabase.from("division_roles").select("key, label, rank, description, capabilities").eq("module", "assure").order("rank"),
    supabase.from("division_capabilities").select("key, label, description").order("sort"),
    supabase.from("division_role_users").select("user_id, role_key, assigned_by, assigned_at").eq("module", "assure"),
    supabase.from("profiles").select("id, full_name, email, srt_role, is_admin, user_type").or("user_type.eq.internal,is_admin.eq.true").order("full_name"),
    supabase.from("division_role_events").select("id, user_id, action, from_role, to_role, note, actor, at").eq("module", "assure").order("at", { ascending: false }).limit(15),
    supabase.rpc("division_can", { p_module: "assure", p_capability: "manage_users" }),
  ]);
  const R = (roles.data ?? []) as Role[];
  const C = (caps.data ?? []) as Cap[];
  const A = (assigned.data ?? []) as Assignment[];
  const P = (people.data ?? []) as Person[];
  const E = (events.data ?? []) as Event[];
  const canManage = can.data === true;
  const name = new Map(P.map((p) => [p.id, p.full_name || p.email]));
  const label = new Map(R.map((r) => [r.key, r.label]));
  const byRole = new Map<string, Assignment[]>();
  for (const a of A) byRole.set(a.role_key, [...(byRole.get(a.role_key) ?? []), a]);
  const assignedIds = new Set(A.map((a) => a.user_id));
  const unassigned = P.filter((p) => !assignedIds.has(p.id) && !p.is_admin);

  return (
    <>
      <PageHead crumbs={[{ label: "SRM", href: "/assure" }, { label: "Watchtower", href: "/assure/watchtower" }, { label: "Roles and access" }]} title="Roles and access"
        sub="The levels in procurement and supply chain. Every level sees all clients. The levels differ in what data they see and what they can do." />

      <Panel title="What each level can see and do" sub="Ranked from the most senior. Your Watchtower owners set this; changes are recorded.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Capability</th>{R.map((r) => <th key={r.key} className="th text-center">{r.label}</th>)}</tr></thead>
            <tbody>
              {C.map((c) => (
                <tr key={c.key}>
                  <td className="td"><b>{c.label}</b><div className="text-xs text-muted">{c.description}</div></td>
                  {R.map((r) => <td key={r.key} className="td text-center">{r.capabilities.includes(c.key) ? <Pill tone="ok">Yes</Pill> : <span className="text-muted">No</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Who holds each level" sub={canManage ? "You can assign levels below your own." : "You can see who holds each level. Only owners and senior levels can change them."}>
        <div className="divide-y divide-line">
          {R.map((r) => (
            <div key={r.key} className="grid gap-3 px-5 py-4 md:grid-cols-[16rem_1fr]">
              <div><p className="font-semibold">{r.label}</p><p className="text-xs text-muted">{r.description}</p></div>
              <div>
                {(byRole.get(r.key) ?? []).length === 0 ? <p className="text-sm text-muted">No one yet.</p> : (
                  <ul className="space-y-2 text-sm">
                    {(byRole.get(r.key) ?? []).map((a) => (
                      <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-2">
                        <span><b>{name.get(a.user_id) ?? "Someone"}</b> <span className="text-xs text-muted">since {when(a.assigned_at)}{a.assigned_by ? ` by ${name.get(a.assigned_by) ?? "someone"}` : ""}</span></span>
                        {canManage && (
                          <ActionForm action={removeRole} hidden={{ user: a.user_id }} submit="Remove" variant="secondary" inline confirm={`Remove ${name.get(a.user_id) ?? "this person"} from this level?`}>
                            <input name="note" placeholder="Why" aria-label="Why" className="input w-40 py-1.5" />
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {canManage && (
        <Card className="p-5">
          <h2 className="mb-3 font-display text-lg font-semibold">Assign a level</h2>
          <ActionForm action={assignRole} submit="Save level" resetOnOk>
            <div className="grid gap-3 md:grid-cols-3">
              <div><label className="label" htmlFor="user">Person</label>
                <select id="user" name="user" required className="input"><option value="">Choose a person</option>
                  {P.filter((p) => !p.is_admin).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}{assignedIds.has(p.id) ? ` (now ${label.get(A.find((a) => a.user_id === p.id)?.role_key ?? "") ?? ""})` : p.srt_role ? ` (older role: ${LEGACY[p.srt_role] ?? p.srt_role})` : ""}</option>)}</select></div>
              <div><label className="label" htmlFor="role">Level</label>
                <select id="role" name="role" required className="input"><option value="">Choose a level</option>{R.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></div>
              <div><label className="label" htmlFor="note">Note</label><input id="note" name="note" className="input" placeholder="Optional" /></div>
            </div>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">The person is told. Someone who holds a level uses it instead of their older role. Removing it puts them back on the older role.</p>
        </Card>
      )}

      <Panel title="People still on older roles" sub="No level assigned yet, so their older SRM role still decides what they can see and do. Platform admins always see everything.">
        {unassigned.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Everyone has a level.</p> : (
          <ul className="divide-y divide-line text-sm">
            {unassigned.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <span><b>{p.full_name || p.email}</b> <span className="text-xs text-muted">{p.email}</span></span>
                <Pill tone="neutral">{p.srt_role ? LEGACY[p.srt_role] ?? p.srt_role : "No SRM role"}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Recent changes">
        {E.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing changed yet.</p> : (
          <ul className="divide-y divide-line text-sm">
            {E.map((e) => (
              <li key={e.id} className="px-5 py-2.5">
                <b>{name.get(e.user_id ?? "") ?? "Someone"}</b>{" "}
                {e.action === "removed" ? `was removed from ${label.get(e.from_role ?? "") ?? e.from_role}` : e.action === "assigned" ? `became ${label.get(e.to_role ?? "") ?? e.to_role}` : `moved from ${label.get(e.from_role ?? "") ?? e.from_role} to ${label.get(e.to_role ?? "") ?? e.to_role}`}
                <span className="text-xs text-muted"> · {when(e.at)} by {name.get(e.actor ?? "") ?? "the system"}{e.note ? ` · ${e.note}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
