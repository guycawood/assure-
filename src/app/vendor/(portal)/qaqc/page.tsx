import Link from "next/link";
import { requireVendorCompany, rpcList } from "@/lib/vendor-data";
import { formatDate } from "@/lib/srt";
import { checkpointStatus, levelLabel, planStatus, type QaqcPlan } from "@/lib/qaqc";
import { Card, Empty, PageHead, Pill, Stat } from "@/components/ui";

export const metadata = { title: "QA/QC" };

/** Everything QA/QC across the vendor's orders: what is due, what needs fixing, what is done. */
export default async function VendorQaqc() {
  await requireVendorCompany();
  const plans = await rpcList<QaqcPlan>("qaqc_vendor_plans");
  const rows = plans.flatMap((p) => p.checkpoints.map((c) => ({ p, c })));
  const todo = rows.filter(({ p, c }) => ["required", "rejected"].includes(c.status) && !["passed", "waived"].includes(p.status))
    .sort((a, b) => (a.c.due_date ?? "9999").localeCompare(b.c.due_date ?? "9999"));
  const today = new Date().toISOString().slice(0, 10);
  const overdue = todo.filter(({ c }) => c.due_date && c.due_date < today).length;
  const review = rows.filter(({ c }) => c.status === "needs_review").length;

  return (
    <>
      <PageHead title="QA/QC" sub="The quality evidence adm Indicia needs on your orders. The level depends on the item and the order; each order shows why." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="To upload" value={todo.length} hint={overdue ? `${overdue} overdue` : "Nothing overdue"} tone={overdue ? "bad" : undefined} />
        <Stat label="With adm Indicia for review" value={review} />
        <Stat label="Plans passed" value={plans.filter((p) => p.status === "passed").length} hint={`of ${plans.length}`} />
      </div>
      <Card>
        {todo.length === 0 ? <Empty title="Nothing to upload right now">QA/QC plans appear here when adm Indicia issues you a purchase order.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Order</th><th className="th">Item</th><th className="th">Level</th><th className="th">Checkpoint</th><th className="th">Needs</th><th className="th">Due</th><th className="th">Status</th></tr></thead>
              <tbody>{todo.map(({ p, c }) => (
                <tr key={c.id}>
                  <td className="td font-semibold"><Link className="text-accent hover:underline" href={`/vendor/orders/${p.po_id}#qaqc`}>{p.po_number}</Link><span className="block text-xs font-normal text-muted">{p.job_number}</span></td>
                  <td className="td">{p.spec_title ?? "Whole order"}</td>
                  <td className="td">{levelLabel(p.required_level)}</td>
                  <td className="td">{c.label}</td>
                  <td className="td text-xs">{c.required.map((r) => r.names).join("; ")}</td>
                  <td className={`td ${c.due_date && c.due_date < today ? "text-bad" : ""}`}>{formatDate(c.due_date)}</td>
                  <td className="td"><Pill tone={checkpointStatus(c.status).tone}>{checkpointStatus(c.status).label}</Pill>{c.rejection_reason && <span className="block text-xs text-bad">{c.rejection_reason}</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <div className="border-b border-line px-5 py-3.5"><h2 className="font-display text-[0.95rem] font-bold">All QA/QC plans</h2></div>
        {plans.length === 0 ? <Empty title="No QA/QC plans yet" /> : (
          <ul className="divide-y divide-line">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="font-semibold">{levelLabel(p.required_level)}</span>
                <Link className="font-semibold text-accent hover:underline" href={`/vendor/orders/${p.po_id}#qaqc`}>{p.po_number}</Link>
                <span className="flex-1 text-muted">{p.spec_title ?? "Whole order"} · {p.checkpoints.filter((c) => ["verified", "auto_verified"].includes(c.status)).length}/{p.checkpoints.length} checkpoints done</span>
                <Pill tone={planStatus(p.status).tone}>{planStatus(p.status).label}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
