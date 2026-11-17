import { requireVendorCompany, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHead } from "@/components/ui";
import { VendorSampling } from "@/components/sampling/vendor-sampling";
import type { VendorSamplingJob } from "@/lib/sampling";

export const metadata = { title: "Sample jobs" };

// Sample quotes and sample POs from us: quote the sample, confirm the launch with photos, send it with tracking and your invoice number.
export default async function SamplingPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const { data } = await supabase.rpc("vendor_sampling_jobs");
  const items = (data ?? []) as VendorSamplingJob[];
  return (
    <>
      <PageHead title="Sample jobs" sub="Requests for a sample quote and sample orders. Quote the sample, confirm the launch with photos or video, then send it with its tracking number and your invoice number." />
      {items.length === 0 ? (
        <Card><Empty title="No sample jobs">When we ask you for a sample quote on an RFQ you have quoted on, it shows here.</Empty></Card>
      ) : (
        <VendorSampling items={items} supplierId={ctx.company.id} canAct={canAct(ctx.permission)} />
      )}
    </>
  );
}
