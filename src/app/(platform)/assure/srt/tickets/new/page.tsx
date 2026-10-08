import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getGateDefs, getInternalPeople, getSuppliers } from "@/lib/data";
import { Card, PageHead } from "@/components/ui";
import { NewTicketForm } from "./new-ticket-form";

export const metadata: Metadata = { title: "Raise a ticket" };

export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ supplier?: string; gate?: string; type?: string }> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [suppliers, people, defs] = await Promise.all([getSuppliers(supabase), getInternalPeople(supabase), getGateDefs(supabase)]);
  return (
    <>
      <PageHead title="Raise a ticket" sub="The due date is set from the ticket type's SLA. An SRT lead can change it later." />
      <Card className="max-w-3xl p-5">
        <NewTicketForm
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, market: s.market }))}
          people={people.map((p) => ({ id: p.id, name: p.full_name || p.email }))}
          gates={defs.map((d) => ({ key: d.key, label: d.label }))}
          defaults={{ supplier: sp.supplier, gate: sp.gate, type: sp.type }}
        />
      </Card>
    </>
  );
}
