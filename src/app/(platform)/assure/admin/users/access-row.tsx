"use client";

import { useActionState, useState } from "react";
import { setUserAccess, type ActionResult } from "@/app/(platform)/assure/actions";
import { SRT_ROLES, type Profile } from "@/lib/srt";
import { btn } from "@/components/ui";

export function AccessRow({ user, isMe, suppliers }: { user: Profile; isMe: boolean; suppliers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setUserAccess.bind(null, user.id), {});
  const [type, setType] = useState(user.user_type);
  const formId = `access-${user.id}`;
  return (
    <tr>
      <td className="td">
        <div className="font-semibold">{user.full_name || user.email}</div>
        {user.full_name && <div className="text-xs text-muted">{user.email}</div>}
        {state.error && <div className="text-xs text-bad" role="alert">{state.error}</div>}
        {state.ok && <div className="text-xs text-ok" role="status">{state.message}</div>}
      </td>
      <td className="td">
        <select form={formId} name="user_type" value={type} onChange={(e) => setType(e.target.value as Profile["user_type"])} className="input w-auto py-1" aria-label="Portal">
          <option value="internal">Internal</option>
          <option value="vendor">Vendor</option>
          <option value="client">Client</option>
        </select>
      </td>
      <td className="td">
        <select form={formId} name="srt_role" defaultValue={user.srt_role ?? ""} disabled={type !== "internal"} className="input w-auto py-1" aria-label="SRT role">
          <option value="">None</option>
          {SRT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </td>
      <td className="td">
        <select form={formId} name="supplier_id" defaultValue={user.supplier_id ?? ""} disabled={type !== "vendor"} className="input w-auto max-w-[220px] py-1" aria-label="Vendor company">
          <option value="">Not linked</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td className="td">
        <input form={formId} type="checkbox" name="is_admin" defaultChecked={user.is_admin} disabled={isMe} aria-label="Admin" />
        {isMe && <input form={formId} type="hidden" name="is_admin" value="on" />}
      </td>
      <td className="td">
        <form id={formId} action={action}>
          <button type="submit" disabled={pending} className={btn.secondary}>{pending ? "Saving…" : "Save"}</button>
        </form>
      </td>
    </tr>
  );
}
