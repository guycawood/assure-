import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/client-portal";
import { Card, Empty, PageHead, Panel, Pill, Stat } from "@/components/ui";
import { ClientActionForm } from "@/components/client/forms";
import { backfillClientLinks, grantClientAccess, revokeClientAccess } from "./actions";

export const metadata: Metadata = { title: "Client access" };

type Overview = {
  grants: { user_id: string; email: string; full_name: string | null; client_id: string; client_name: string; client_code: string; role: "approver" | "viewer"; granted_at: string; granted_by_name: string | null }[];
  candidates: { id: string; email: string; full_name: string | null; user_type: string }[];
  clients: { id: string; name: string; code: string }[];
  audit: { action: string; role: string | null; at: string; user_email: string | null; client_name: string | null; actor_name: string | null; detail: Record<string, unknown> }[];
};

const ACTION: Record<string, string> = { granted: "Granted", role_changed: "Role changed", revoked: "Revoked", backfill: "Re-linked client records" };

// Who can sign in to the Client Portal, and for which client. Admins grant and revoke; every change is audited.
export default async function ClientAccessPage() {
  const me = await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_access_overview", {});
  const o = (data ?? { grants: [], candidates: [], clients: [], audit: [] }) as Overview;
  const people = new Set(o.grants.map((g) => g.user_id)).size;

  return (
    <>
      <PageHead
        title="Client access"
        crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Client access" }]}
        sub="Client users see only the accounts listed here in the Client Portal. Approvers can approve or decline estimates; viewers can follow progress and comment. adm Indicia staff can preview any client read-only."
      />
      {error && <Card className="p-4 text-sm text-bad">{error.message}</Card>}

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Client users" value={people} />
        <Stat label="Approvers" value={o.grants.filter((g) => g.role === "approver").length} />
        <Stat label="Clients with portal users" value={new Set(o.grants.map((g) => g.client_id)).size} hint={`of ${o.clients.length} active clients`} />
      </section>

      {me.is_admin && (
        <Panel title="Give someone access" sub="People appear here after their first sign-in with a non-adm Indicia email. Giving access makes them a client user.">
          <ClientActionForm action={grantClientAccess} submit="Give access" className="px-5 py-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="label" htmlFor="user_id">Person</label>
                <select id="user_id" name="user_id" required className="input" defaultValue="">
                  <option value="" disabled>Choose a person</option>
                  {o.candidates.map((p) => <option key={p.id} value={p.id}>{p.full_name ? `${p.full_name} (${p.email})` : p.email}{p.user_type === "client" ? " · client" : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="client_id">Client</label>
                <select id="client_id" name="client_id" required className="input" defaultValue="">
                  <option value="" disabled>Choose a client</option>
                  {o.clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="role">Role</label>
                <select id="role" name="role" className="input" defaultValue="viewer">
                  <option value="viewer">Viewer: follows progress and comments</option>
                  <option value="approver">Approver: also approves or declines estimates</option>
                </select>
              </div>
            </div>
          </ClientActionForm>
        </Panel>
      )}

      <Panel title="Current access">
        {o.grants.length === 0 ? <Empty title="No client users yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Person", "Client", "Role", "Granted", "", ""].map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {o.grants.map((g) => (
                  <tr key={`${g.user_id}-${g.client_id}`}>
                    <td className="td"><div className="font-semibold">{g.full_name || g.email}</div>{g.full_name && <div className="text-xs text-muted">{g.email}</div>}</td>
                    <td className="td">{g.client_name} <span className="text-xs text-muted">{g.client_code}</span></td>
                    <td className="td"><Pill tone={g.role === "approver" ? "accent" : "neutral"}>{g.role === "approver" ? "Approver" : "Viewer"}</Pill></td>
                    <td className="td whitespace-nowrap text-xs text-muted">{fmtDate(g.granted_at)}{g.granted_by_name ? ` by ${g.granted_by_name}` : ""}</td>
                    <td className="td"><Link href={`/client-portal?preview=${g.client_id}`} className="text-xs font-semibold text-accent hover:underline">Preview as client</Link></td>
                    <td className="td">
                      {me.is_admin && (
                        <ClientActionForm action={revokeClientAccess} hidden={{ user_id: g.user_id, client_id: g.client_id }} submit="Remove" variant="danger" pendingLabel="Removing…" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Client records in Briefing+ and Shopper IQ" sub="Campaigns and briefs name the client in free text. They are linked to a client when the text matches its code or name (ignoring case and any bracketed suffix), or through their campaign.">
          <div className="px-5 py-4 text-sm">
            {me.is_admin ? (
              <ClientActionForm action={backfillClientLinks} submit="Re-link unmatched records" variant="secondary" pendingLabel="Linking…" />
            ) : <p className="text-muted">Admins can re-link records saved before a client existed.</p>}
          </div>
        </Panel>
        <Panel title="Recent changes">
          {o.audit.length === 0 ? <Empty title="No changes yet" /> : (
            <ul className="divide-y divide-line">
              {o.audit.slice(0, 15).map((a, i) => (
                <li key={i} className="px-5 py-2.5 text-sm">
                  <b>{ACTION[a.action] ?? a.action}</b>{a.user_email ? ` · ${a.user_email}` : ""}{a.client_name ? ` · ${a.client_name}` : ""}{a.role ? ` · ${a.role}` : ""}
                  <div className="text-xs text-muted">{fmtDate(a.at)}{a.actor_name ? ` by ${a.actor_name}` : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
