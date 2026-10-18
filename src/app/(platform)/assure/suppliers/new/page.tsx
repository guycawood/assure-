import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInternalPeople } from "@/lib/data";
import { createSupplier } from "@/app/(platform)/assure/actions";
import { Card, PageHead } from "@/components/ui";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  await requireInternal();
  const supabase = await createClient();
  const people = await getInternalPeople(supabase);
  return (
    <>
      <PageHead title="Add a supplier" sub="New suppliers normally start as an onboarding request, so the duplicate check and Procurement triage happen first. A supplier added here starts at stage 1 of 9 with purchasing blocked; to onboard it, raise an onboarding request and link this supplier." />
      <Card className="max-w-4xl p-5">
        <SupplierForm action={createSupplier} people={people.map((p) => ({ id: p.id, name: p.full_name || p.email }))} submitLabel="Add supplier" />
      </Card>
    </>
  );
}
