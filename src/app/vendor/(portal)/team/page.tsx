import { requireVendorCompany, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, PERMISSION_HELP, PERMISSION_LABEL, statusTone, type VendorPermission } from "@/lib/vendor";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionButton, ActionDialog, ActionForm } from "@/components/vendor/action-form";
import { inviteMember, removeMember, setMemberLevel } from "../actions";

export const metadata = { title: "Team" };

type Member = { id: string; email: string; permission_level: VendorPermission; status: string; created_at: string; full_name: string | null; is_me: boolean; is_primary_contact: boolean };
const LEVELS: VendorPermission[] = ["admin", "standard", "viewer"];

export default async function TeamPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const members = await rows<Member>(supabase.from("vendor_team_members").select("*").order("created_at"));
  const admin = ctx.permission === "admin";

  return (
    <>
      <PageHead title="Team" sub="Colleagues who can use the vendor portal for your company. Portal admins invite people and choose what they can do; invited people sign in with the email address you enter." />
      <div className="grid gap-4 sm:grid-cols-3">
        {LEVELS.map((l) => <Card key={l} className="p-4"><p className="font-semibold">{PERMISSION_LABEL[l]}</p><p className="text-xs text-muted">{PERMISSION_HELP[l]}</p></Card>)}
      </div>
      {admin ? (
        <Panel title="Invite a colleague">
          <div className="p-5">
            <ActionForm action={inviteMember} submit="Send invitation" resetOnOk className="flex flex-wrap items-end gap-3">
              <div className="min-w-[260px] flex-1"><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" required maxLength={254} className="input" placeholder="name@yourcompany.com" /></div>
              <div><label className="label" htmlFor="level">Access</label>
                <select id="level" name="level" className="input" defaultValue="standard">{LEVELS.map((l) => <option key={l} value={l}>{PERMISSION_LABEL[l]}</option>)}</select></div>
            </ActionForm>
          </div>
        </Panel>
      ) : <p className="text-sm text-muted">Only your company&apos;s portal admins can invite people or change access. You are: {ctx.permission ? PERMISSION_LABEL[ctx.permission] : "Vendor"}.</p>}
      <Card className="overflow-x-auto">
        {members.length === 0 ? <Empty title="No team members listed yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Person</th><th className="th">Access</th><th className="th">Status</th><th className="th">Added</th>{admin && <th className="th" />}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="td"><span className="font-semibold">{m.full_name ?? m.email}</span>{m.full_name && <span className="block text-xs text-muted">{m.email}</span>}
                    {(m.is_me || m.is_primary_contact) && <span className="block text-xs text-muted">{[m.is_me && "You", m.is_primary_contact && "Primary contact"].filter(Boolean).join(" · ")}</span>}</td>
                  <td className="td">{PERMISSION_LABEL[m.permission_level]}</td>
                  <td className="td"><Pill tone={statusTone(m.status === "pending" ? "invited" : m.status)}>{m.status === "pending" ? "Invited, not signed in yet" : human(m.status)}</Pill></td>
                  <td className="td">{formatDate(m.created_at)}</td>
                  {admin && (
                    <td className="td">
                      {!m.is_me && !m.is_primary_contact && (
                        <div className="flex flex-wrap gap-2">
                          <ActionDialog label="Change access" title={`Change access for ${m.email}`} action={setMemberLevel} hidden={{ id: m.id }} submit="Save">
                            <select name="level" className="input" defaultValue={m.permission_level} aria-label="Access">{LEVELS.map((l) => <option key={l} value={l}>{PERMISSION_LABEL[l]}</option>)}</select>
                          </ActionDialog>
                          <ActionButton action={removeMember} label="Remove" variant="danger" hidden={{ id: m.id }} />
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
