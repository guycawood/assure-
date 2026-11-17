import { requireVendorCompany } from "@/lib/vendor-data";
import { PageHead } from "@/components/ui";
import { CapabilityProfile } from "@/components/assure/capability-profile";

export const metadata = { title: "Capabilities" };

// The vendor keeps its own capability profile: processes, machines and the tooling it holds. Entries are 'declared'
// until our SRM verifies them; any change makes an entry declared again.
export default async function VendorCapabilities() {
  const { company } = await requireVendorCompany();
  return (
    <>
      <PageHead title="Capabilities, machines and tooling" sub="What you make, the machines you make it on and the tooling you hold for us and our clients. Keep it current: it decides which RFQs you are invited to." />
      <CapabilityProfile supplierId={company.id} mode="vendor" />
    </>
  );
}
