import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { one, rows } from "@/lib/sourcing-data";
import { getMarkets } from "@/lib/logistics-data";
import { PageHead, Panel } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { DeliveryFields } from "@/components/logistics/delivery-fields";
import { createDelivery } from "../../actions";

export const metadata: Metadata = { title: "Add a destination" };

type Po = { id: string; po_number: string; estimate_id: string; supplier_name: string; job_number: string; status: string; delivery_date: string | null };

export default async function NewDeliveryPage({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  await requireInternal();
  const { po: poId } = await searchParams;
  if (!poId) notFound();
  const supabase = await createClient();
  const po = await one<Po>(supabase, "v_purchase_orders", poId);
  if (!po) notFound();
  const [lines, markets] = await Promise.all([
    rows<{ spec_id: string; quantity: number }>(supabase, "estimate_lines", { eq: { estimate_id: po.estimate_id } }),
    getMarkets(supabase),
  ]);
  const specs = await Promise.all(lines.map(async (l) => ({
    line: l,
    spec: await one<{ id: string; title: string; spec_no: number }>(supabase, "job_specs", l.spec_id),
    versions: await rows<{ id: string; name: string; quantity: number }>(supabase, "spec_versions", { eq: { spec_id: l.spec_id }, order: [["sort"]] }),
  })));

  return (
    <>
      <PageHead crumbs={[{ label: "Logistics+", href: "/logistics" }, { label: "Plan from a PO", href: "/logistics/plan" }, { label: "Add a destination" }]}
        title={`Add a destination to ${po.po_number}`} sub={`${po.supplier_name} · ${po.job_number}. One delivery is one destination for one spec version.`} />
      <Panel title="Delivery">
        <div className="p-5">
          <ActionForm action={createDelivery} hidden={{ po_id: po.id }} submit="Create delivery">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Spec" htmlFor="spec_id">
                <select id="spec_id" name="spec_id" className="input" required>
                  {specs.map((s) => <option key={s.line.spec_id} value={s.line.spec_id}>#{s.spec?.spec_no} {s.spec?.title} ({s.line.quantity} on the PO)</option>)}
                </select>
              </Field>
              <Field label="Version (optional)" htmlFor="spec_version_id" hint="Which artwork/version goes to this destination">
                <select id="spec_version_id" name="spec_version_id" className="input">
                  <option value="">—</option>
                  {specs.flatMap((s) => s.versions.map((v) => <option key={v.id} value={v.id}>{s.spec?.title}: {v.name} ({v.quantity})</option>))}
                </select>
              </Field>
            </div>
            <DeliveryFields markets={markets} d={{ planned_delivery_date: po.delivery_date, delivery_method: "road", uom: "units" }} />
          </ActionForm>
        </div>
      </Panel>
    </>
  );
}
