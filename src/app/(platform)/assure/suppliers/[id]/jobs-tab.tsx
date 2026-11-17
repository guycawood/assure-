import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { VendorJobsSummaryCards, VendorJobsTable, type VendorJobRow, type VendorJobsSummary } from "@/components/assure/vendor-jobs";

// Supplier 360: this vendor's jobs across every client, and how each is on the way to being paid.
export async function JobsTab({ supplierId }: { supplierId: string }) {
  const supabase = await createClient();
  const res = await supabase.rpc("srm_vendor_jobs", { p_vendor: supplierId, p_limit: 500 });
  const data = (res.data as { rows: VendorJobRow[]; summary: VendorJobsSummary } | null) ?? null;
  if (!data) return <Card className="p-5 text-sm text-muted">Jobs and payments could not be loaded.</Card>;
  return (
    <>
      <VendorJobsSummaryCards s={data.summary} base={`/assure/jobs?vendor=${supplierId}`} />
      <VendorJobsTable rows={data.rows} showVendor={false} money={data.summary.can_see_money} />
      {!data.summary.can_see_money && <p className="text-xs text-muted">Order values and invoice amounts are shown to procurement, finance and SRM leads.</p>}
    </>
  );
}
