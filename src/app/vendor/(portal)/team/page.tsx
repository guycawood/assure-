import { requireVendorCompany, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, PERMISSION_HELP, PERMISSION_LABEL, roleLabel, statusTone, VENDOR_ROLES, type VendorPermission } from "@/lib/vendor";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionButton, ActionDialog, ActionForm } from "@/components/vendor/action-form";
import { inviteMember, removeMember, setMemberLevel, setMemberRoles } from "../actions";

export const metadata = { title: "Team" };

type Member = { id: string; email: string; permission_level: VendorPermission; status: string; created_at: string; full_name: string | null; is_me: boolean; is_primary_contact: boolean; functional_roles: string[] };
const LEVELS: VendorPermission[] = ["admin", "standard", "viewer"];

export default async function TeamPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const members = await rows<Member>(supabase.from("vendor_team_members").select("*").order("created_at"));
  const admin = ctx.permission === "admin" && (ctx.company.my_roles?.length ? ctx.company.my_roles.includes("company_admin") || ctx.company.primary_contact_email?.toLowerCase() === ctx.profile.email?.toLowerCase() : true);
  const roleBoxes = (have: string[] = []) => (
    <fieldset className="grid gap-1.5 text-sm"><legend className="label">Role in the company</legend>
      {VENDOR_ROLES.map((r) => <label key={r.key} className="flex items-start gap-2"><input type="checkbox" name="roles" value={r.key} defaultChecked={have.includes(r.key)} className="mt-1" /><span><b>{r.label}</b><span className="block text-xs text-muted">{r.help}</span></span></label>)}
      <p className="text-xs text-muted">Choose none to give full access at their level. Once a role is chosen they can act only in that area. The company admin role has no financial access.</p>
    </fieldset>
  );

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
              <div className="w-full">{roleBoxes()}</div>
            </ActionForm>
          </div>
        </Panel>
      ) : <p className="text-sm text-muted">Only your company&apos;s portal admins can invite people or change access. You are: {ctx.permission ? PERMISSION_LABEL[ctx.permission] : "Vendor"}.</p>}
      <Card className="overflow-x-auto">
        {members.length === 0 ? <Empty title="No team members listed yet" /> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Person</th><th className="th">Access</th><th className="th">Roles</th><th className="th">Status</th><th className="th">Added</th>{admin && <th className="th" />}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="td"><span className="font-semibold">{m.full_name ?? m.email}</span>{m.full_name && <span className="block text-xs text-muted">{m.email}</span>}
                    {(m.is_me || m.is_primary_contact) && <span className="block text-xs text-muted">{[m.is_me && "You", m.is_primary_contact && "Primary contact"].filter(Boolean).join(" · ")}</span>}</td>
                  <td className="td">{PERMISSION_LABEL[m.permission_level]}</td>
                  <td className="td text-xs">{m.functional_roles?.length ? m.functional_roles.map(roleLabel).join(", ") : <span className="text-muted">Full access at their level</span>}</td>
                  <td className="td"><Pill tone={statusTone(m.status === "pending" ? "invited" : m.status)}>{m.status === "pending" ? "Invited, not signed in yet" : human(m.status)}</Pill></td>
                  <td className="td">{formatDate(m.created_at)}</td>
                  {admin && (
                    <td className="td">
                      {!m.is_me && !m.is_primary_contact && (
                        <div className="flex flex-wrap gap-2">
                          <ActionDialog label="Change access" title={`Change access for ${m.email}`} action={setMemberLevel} hidden={{ id: m.id }} submit="Save">
                            <select name="level" className="input" defaultValue={m.permission_level} aria-label="Access">{LEVELS.map((l) => <option key={l} value={l}>{PERMISSION_LABEL[l]}</option>)}</select>
                          </ActionDialog>
                          <ActionDialog label="Change roles" title={`Roles for ${m.email}`} action={setMemberRoles} hidden={{ id: m.id }} submit="Save">{roleBoxes(m.functional_roles)}</ActionDialog>
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
