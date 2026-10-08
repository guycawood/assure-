import { notFound } from "next/navigation";
import { clsx } from "clsx";
import { requireVendorCompany, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, money, orderChecklist, statusTone, type OrderDocType } from "@/lib/vendor";
import { Card, PageHead, Panel, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { FileUpload } from "@/components/file-upload";
import { FileList, getFiles } from "@/components/file-list";
import { ActionButton, ActionDialog } from "@/components/vendor/action-form";
import { respondPo } from "../../actions";

export const metadata = { title: "Purchase order" };

type Po = {
  id: string; po_number: string; job_number: string; title: string; category: string | null; market: string; region: string; currency: string;
  total_value: number; po_date: string; delivery_date: string | null; status: string; issued_at: string | null; responded_at: string | null;
  decline_reason: string | null; job_status: string;
  lines: { spec: string; spec_type: string; quantity: number; unit_cost: number; line_cost: number }[];
};

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_po_detail", { p_po: id });
  if (error || !data) notFound();
  const po = data as Po;
  const [{ data: types }, files] = await Promise.all([
    supabase.from("vendor_order_document_types").select("id, code, name, required_for_categories, uploaded_by").order("name"),
    getFiles("purchase_order", po.id),
  ]);
  const checklist = orderChecklist(po.category, (types ?? []) as OrderDocType[], files.map((f) => f.label ?? ""));
  const act = canAct(ctx.permission);
  const accepted = po.status === "accepted";

  type TimelineStep = { label: string; at: string | null; done: boolean; bad?: boolean; planned?: boolean };
  const steps: TimelineStep[] = po.status === "declined"
    ? [{ label: "Issued", at: po.issued_at ?? po.po_date, done: true }, { label: "Declined", at: po.responded_at, done: true, bad: true }]
    : [
        { label: "Issued", at: po.issued_at ?? po.po_date, done: true },
        { label: "Accepted", at: po.responded_at, done: accepted },
        { label: "In production", at: null, done: accepted && ["in_production", "delivered", "closed"].includes(po.job_status) },
        { label: "Delivered", at: po.delivery_date, done: ["delivered", "closed"].includes(po.job_status), planned: true },
      ];

  return (
    <>
      <PageHead title={po.po_number} crumbs={[{ label: "Orders", href: "/vendor/orders" }, { label: po.po_number }]} sub={`${po.title} · ${po.job_number} · ${po.market}`}>
        {po.status === "issued" && act && (
          <>
            <ActionButton action={respondPo} label="Accept purchase order" variant="primary" hidden={{ id: po.id, decision: "accept" }} />
            <ActionDialog label="Decline" variant="danger" title={`Decline ${po.po_number}`} sub="adm Indicia will see your reason." action={respondPo} hidden={{ id: po.id, decision: "decline" }} submit="Decline purchase order">
              <label className="label" htmlFor="reason">Reason</label>
              <textarea id="reason" name="reason" required rows={3} maxLength={1000} className="input" />
            </ActionDialog>
          </>
        )}
      </PageHead>

      <Card className="px-6 py-5">
        <ol className="flex items-start">
          {steps.map((st, i) => (
            <li key={st.label} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <span className={clsx("h-0.5 flex-1", i === 0 ? "bg-transparent" : st.done ? "bg-ok" : "bg-line")} />
                <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-full border-2", st.bad ? "border-bad bg-bad text-white" : st.done ? "border-ok bg-ok text-white" : "border-line bg-surface text-muted")}>
                  <MSymbol name={st.bad ? "close" : st.done ? "check" : "radio_button_unchecked"} size={16} />
                </span>
                <span className={clsx("h-0.5 flex-1", i === steps.length - 1 ? "bg-transparent" : steps[i + 1].done ? "bg-ok" : "bg-line")} />
              </div>
              <p className="mt-1.5 text-xs font-bold">{st.label}</p>
              {st.at && <p className="text-[0.68rem] text-muted">{st.planned && !st.done ? "Due " : ""}{formatDate(st.at)}</p>}
            </li>
          ))}
        </ol>
        {po.status === "declined" && po.decline_reason && <p className="mt-3 text-sm text-muted">You declined: {po.decline_reason}</p>}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Order lines" sub={`Total ${money(po.total_value, po.currency)} · PO date ${formatDate(po.po_date)} · delivery ${formatDate(po.delivery_date) || "to be confirmed"}`}
          actions={<Pill tone={statusTone(po.status)}>{po.status === "issued" ? "Waiting for you" : human(po.status)}</Pill>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Item</th><th className="th text-right">Quantity</th><th className="th text-right">Unit price</th><th className="th text-right">Line total</th></tr></thead>
              <tbody>
                {po.lines.map((l, i) => (
                  <tr key={i}><td className="td font-semibold">{l.spec}<span className="block text-xs font-normal text-muted">{l.spec_type?.toUpperCase()}</span></td>
                    <td className="td text-right tabular-nums">{l.quantity.toLocaleString("en-GB")}</td><td className="td text-right tabular-nums">{money(l.unit_cost, po.currency, 4)}</td>
                    <td className="td text-right tabular-nums">{money(l.line_cost, po.currency)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Control documents & invoice" sub={po.category ? `Checklist for ${po.category} jobs, from adm Indicia's document library` : "From adm Indicia's document library"}>
          <ul className="divide-y divide-line">
            {checklist.map((c) => (
              <li key={c.code} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <MSymbol name={c.done ? "check_circle" : c.required ? "pending" : "radio_button_unchecked"} size={18} fill={c.done} className={c.done ? "text-ok" : c.required ? "text-warn" : "text-muted"} />
                  <span className="flex-1 text-sm font-semibold">{c.name}</span>
                  {c.required ? <Pill tone={c.done ? "ok" : "warn"}>{c.done ? "Uploaded" : "Required"}</Pill> : c.done ? <Pill tone="ok">Uploaded</Pill> : <span className="text-xs text-muted">If applicable</span>}
                </div>
                {accepted && act && <div className="mt-2"><FileUpload module="orders" entityType="purchase_order" entityId={po.id} supplierId={ctx.company.id} label={c.name} compact /></div>}
              </li>
            ))}
          </ul>
          {!accepted && <p className="border-t border-line px-5 py-3 text-xs text-muted">{po.status === "issued" ? "Accept the purchase order to upload documents against it." : "This order is closed."}</p>}
          <div className="border-t border-line p-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Uploaded</p>
            <FileList entityType="purchase_order" entityId={po.id} empty="Nothing uploaded yet." />
          </div>
        </Panel>
      </div>
    </>
  );
}
