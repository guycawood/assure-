import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { SRT_ROLES, type Profile } from "@/lib/srt";
import { Card, PageHead } from "@/components/ui";
import { AccessRow } from "./access-row";

export const metadata: Metadata = { title: "User access" };

export default async function UsersPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const [{ data }, suppliers] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, user_type, is_admin, srt_role, supplier_id").order("email"),
    getSuppliers(supabase),
  ]);
  const users = (data ?? []) as Profile[];
  return (
    <>
      <PageHead title="User access" sub="People appear here after their first sign-in. Staff with an adm-indicia.com email join as internal; vendors are linked to their company by email." />
      <Card className="p-4 text-sm">
        <p className="mb-2 font-semibold">SRT roles</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {SRT_ROLES.map((r) => <li key={r.value}><b>{r.label}:</b> <span className="text-muted">{r.description}</span></li>)}
        </ul>
      </Card>
      <Card className="min-w-0 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr>{["Person", "Portal", "SRT role", "Vendor company", "Admin", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {users.map((u) => (
              <AccessRow key={u.id} user={u} isMe={u.id === me.id} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} />
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
