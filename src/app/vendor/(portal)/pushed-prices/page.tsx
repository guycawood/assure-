import { requireVendorCompany, rpcList, canAct, type PushRow } from "@/lib/vendor-data";
import { formatDate, today } from "@/lib/srt";
import { human, money, statusTone } from "@/lib/vendor";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { ActionButton, ActionDialog } from "@/components/vendor/action-form";
import { respondPush } from "../actions";

export const metadata = { title: "Pushed prices" };

export default async function PushedPricesPage() {
  const ctx = await requireVendorCompany();
  const rows = await rpcList<PushRow>("triage_push_list");
  const act = canAct(ctx.permission);

  return (
    <>
      <PageHead title="Pushed prices" sub="When a job matches your agreed rate card closely, adm Indicia states the price and asks you to confirm it, instead of running a quote request. Confirm or decline by the respond-by date." />
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No pushed prices">Nothing is waiting for your confirmation.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr><th className="th">Item</th><th className="th">Job</th><th className="th text-right">Quantity</th><th className="th text-right">Unit price</th><th className="th text-right">Total</th><th className="th">Respond by</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>
              {rows.map((p) => {
                const late = !!p.respond_by && p.respond_by < today();
                return (
                  <tr key={p.id}>
                    <td className="td"><span className="font-semibold">{p.spec_title}</span>{p.description && <span className="block max-w-[38ch] truncate text-xs text-muted" title={p.description}>{p.description}</span>}</td>
                    <td className="td">{p.job_number}</td>
                    <td className="td text-right tabular-nums">{p.quantity.toLocaleString("en-GB")}</td>
                    <td className="td text-right tabular-nums">{money(p.unit_price, p.currency, 4)}</td>
                    <td className="td text-right tabular-nums">{money(p.unit_price * p.quantity, p.currency)}</td>
                    <td className="td">{formatDate(p.respond_by)}{late && p.status === "pending" && <span className="block text-xs text-bad">Passed</span>}</td>
                    <td className="td"><Pill tone={statusTone(p.status)}>{human(p.status)}</Pill></td>
                    <td className="td">
                      {p.status === "pending" && act && !late && (
                        <div className="flex gap-2">
                          <ActionButton action={respondPush} label="Confirm" variant="primary" hidden={{ id: p.id, decision: "accept" }} />
                          <ActionDialog label="Decline" variant="danger" title="Decline this price" sub={`${p.spec_title} · ${p.quantity} at ${money(p.unit_price, p.currency, 4)}`}
                            action={respondPush} hidden={{ id: p.id, decision: "decline" }} submit="Decline price">
                            <label className="label" htmlFor={`r-${p.id}`}>Why can&apos;t you accept it?</label>
                            <textarea id={`r-${p.id}`} name="reason" required rows={3} maxLength={1000} className="input" />
                            <p className="text-xs text-muted">adm Indicia will run a quote request for this item instead.</p>
                          </ActionDialog>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
