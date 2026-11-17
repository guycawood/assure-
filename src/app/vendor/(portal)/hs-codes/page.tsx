import { requireVendorCompany, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/vendor/action-form";
import { declareHsCode } from "../actions";

export const metadata = { title: "HS codes" };

type Row = { spec_id: string; job_number: string; spec_no: number; title: string; buyer_code: string | null; mine: string | null; note: string | null; declared_at: string | null };

export default async function VendorHsCodes() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_hs_list");
  const rows = (data as Row[] | null) ?? [];
  const act = canAct(ctx.permission);
  const differs = rows.filter((r) => r.mine && r.buyer_code && r.mine !== r.buyer_code).length;

  return (
    <>
      <PageHead title="HS codes" sub="The customs HS code on each product you supply. If you ship under a different code, enter it here. We review it and decide whether to use it: your entry does not change our spec." />
      {error ? <Card className="p-5 text-sm text-bad">Your HS codes could not be loaded.</Card> : rows.length === 0 ? (
        <Card><Empty title="Nothing to declare yet">Products appear here once you have been awarded or are supplying an order.</Empty></Card>
      ) : (
        <Panel title={`Products (${rows.length})`} sub={differs ? `${differs} of your codes differ from ours. We will confirm which to use.` : "4 to 10 digits, for example 4911.10"}>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.spec_id} className="space-y-2 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-semibold">{r.job_number} · {r.title}</span>
                  <span className="text-xs text-muted">Our HS code</span>
                  {r.buyer_code ? <code className="rounded bg-surface-2 px-2 py-0.5 font-bold">{r.buyer_code}</code> : <Pill>Not set</Pill>}
                  {r.mine && (r.buyer_code === r.mine ? <Pill tone="ok">Matches yours</Pill> : <Pill tone="warn">Yours: {r.mine}</Pill>)}
                </div>
                {act && (
                  <ActionForm action={declareHsCode} hidden={{ spec_id: r.spec_id }} submit={r.mine ? "Update" : "Send to us"} variant="secondary" className="flex flex-wrap items-end gap-3">
                    <label className="block text-xs"><span className="label">Your HS code</span><input name="hs_code" defaultValue={r.mine ?? ""} placeholder="e.g. 4911.10" className="input w-36" /></label>
                    <label className="block text-xs"><span className="label">Note (optional)</span><input name="note" defaultValue={r.note ?? ""} placeholder="Why this code" className="input w-72" /></label>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
