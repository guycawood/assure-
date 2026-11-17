import { requireVendorCompany, canAct } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHead, Panel } from "@/components/ui";
import { CreativeRequests } from "@/components/vendor/creative-requests";
import { SampleRequests } from "@/components/vendor/sample-requests";
import type { VendorRfi, VendorSample } from "@/lib/creative-rfi";

export const metadata = { title: "Creative requests" };

// Creative requests for information from us (confirm or decline, accept the IP rule, send the ideation proposal)
// and sample requests (send the sample with its tracking number).
export default async function CreativeRequestsPage() {
  const ctx = await requireVendorCompany();
  const supabase = await createClient();
  const [{ data }, { data: sm }] = await Promise.all([supabase.rpc("vendor_creative_rfis"), supabase.rpc("vendor_samples")]);
  const items = (data ?? []) as VendorRfi[];
  const samples = (sm ?? []) as VendorSample[];
  const act = canAct(ctx.permission);
  return (
    <>
      <PageHead title="Creative requests" sub="Requests from us for creative ideation and samples. Say whether you can respond, upload your proposal and accept the IP rule, or send the sample with its tracking number." />
      {items.length === 0 && samples.length === 0 && (
        <Card><Empty title="No creative requests">When we invite you to propose creative ideas or asks for a sample, the request shows here.</Empty></Card>
      )}
      {items.length > 0 && <CreativeRequests items={items} supplierId={ctx.company.id} canAct={act} />}
      {samples.length > 0 && (
        <Panel title="Sample requests" sub="Send the sample, add the tracking number, and we confirm it arrived.">
          <div className="p-5"><SampleRequests items={samples} canAct={act} /></div>
        </Panel>
      )}
    </>
  );
}
