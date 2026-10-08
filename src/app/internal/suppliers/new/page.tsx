import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInternalPeople } from "@/lib/data";
import { createSupplier } from "@/app/internal/actions";
import { Card, PageHead } from "@/components/ui";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  await requireInternal();
  const supabase = await createClient();
  const people = await getInternalPeople(supabase);
  return (
    <>
      <PageHead title="Add a supplier" sub="The supplier starts with all 14 onboarding gates missing. Purchasing stays blocked until every critical gate is verified." />
      <Card className="max-w-4xl p-5">
        <SupplierForm action={createSupplier} people={people.map((p) => ({ id: p.id, name: p.full_name || p.email }))} submitLabel="Add supplier" />
      </Card>
    </>
  );
}
