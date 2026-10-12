import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/sourcing/action-form";
import { Panel, Pill } from "@/components/ui";
import { cancelApprovalRequest, decideApprovalRequest } from "./actions";
import { money, typeLabel } from "./labels";

type RequestRow = {
  id: string; request_no: number; approval_type: string; title: string; summary: string | null; reason: string | null; status: string;
  amount: number | null; currency: string | null; requested_by: string | null; requested_by_name: string | null; requested_at: string;
  decided_by_name: string | null; decided_at: string | null; decision_note: string | null; approver_label: string; maker_checker: boolean;
  policy_code: string | null; can_decide: boolean; required_doa_level: number | null;
};

const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const TONE: Record<string, "warn" | "ok" | "bad" | "neutral"> = { pending: "warn", approved: "ok", rejected: "bad", cancelled: "neutral" };

/**
 * Second-person approvals for one item (or a list of items): pending requests with Approve / Reject for whoever may decide
 * (maker-checker and the policy role are enforced in SQL), Withdraw for the requester, and the last few decisions.
 * Without entityIds it lists every request of the given types. Renders nothing when there is nothing to show.
 */
export async function ApprovalRequests({
  entityIds, types, title = "Waiting for a second person", meId, history = 3,
}: { entityIds?: string | string[]; types?: string[]; title?: string; meId?: string; history?: number }) {
  const ids = entityIds === undefined ? null : Array.isArray(entityIds) ? entityIds : [entityIds];
  if ((ids && ids.length === 0) || (!ids && !types?.length)) return null;
  const supabase = await createClient();
  let q = supabase.from("approval_requests_v").select("*").order("requested_at", { ascending: false }).limit(30);
  if (ids) q = q.in("entity_id", ids);
  if (types?.length) q = q.in("approval_type", types);
  const { data } = await q;
  const rows = (data as RequestRow[] | null) ?? [];
  const pending = rows.filter((r) => r.status === "pending" || r.status === "applying");
  const done = rows.filter((r) => !(r.status === "pending" || r.status === "applying")).slice(0, history);
  if (pending.length === 0 && done.length === 0) return null;

  return (
    <Panel title={title} sub="A second person approves these before they take effect. Who may decide comes from the approval policy.">
      <ul className="divide-y divide-line">
        {pending.map((r) => (
          <li key={r.id} className="space-y-2 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{r.title}</p>
                <p className="text-xs text-muted">
                  {typeLabel(r.approval_type)} · request #{r.request_no} · asked by {r.requested_by_name ?? "someone"} {when(r.requested_at)}
                  {r.amount != null && <> · {money(Number(r.amount), r.currency)}</>}
                </p>
              </div>
              <Pill tone="warn">Waiting</Pill>
            </div>
            {r.summary && <p className="text-sm">{r.summary}</p>}
            {r.reason && <p className="text-sm text-muted">Reason: {r.reason}</p>}
            <p className="text-xs text-muted">
              Who approves: {r.approver_label}{r.required_doa_level != null && ` (level ${r.required_doa_level} or above)`}
              {r.maker_checker && " · not the person who asked"}{r.policy_code && ` · policy ${r.policy_code}`}
            </p>
            {r.can_decide ? (
              <div className="flex flex-wrap items-end gap-3">
                <ActionForm action={decideApprovalRequest} hidden={{ id: r.id, decision: "approve" }} submit="Approve" inline>
                  <input name="note" className="input w-56" placeholder="Note (optional)" aria-label="Approval note" />
                </ActionForm>
                <ActionForm action={decideApprovalRequest} hidden={{ id: r.id, decision: "reject" }} submit="Reject" variant="danger" inline>
                  <input name="note" className="input w-56" placeholder="Why (required)" aria-label="Rejection reason" />
                </ActionForm>
              </div>
            ) : meId && r.requested_by === meId ? (
              <ActionForm action={cancelApprovalRequest} hidden={{ id: r.id }} submit="Withdraw request" variant="secondary" inline
                confirm="Withdraw this request? Nothing will change." />
            ) : (
              <p className="text-xs text-muted">You can&apos;t decide this one.</p>
            )}
          </li>
        ))}
        {done.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
            <div>
              <p>{r.title}</p>
              <p className="text-xs text-muted">
                {r.requested_by_name ?? "Someone"} asked {when(r.requested_at)}
                {r.decided_by_name && <> · {r.status} by {r.decided_by_name} {when(r.decided_at)}</>}
                {r.decision_note && <> · {r.decision_note}</>}
              </p>
            </div>
            <Pill tone={TONE[r.status] ?? "neutral"}>{r.status[0].toUpperCase() + r.status.slice(1)}</Pill>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
