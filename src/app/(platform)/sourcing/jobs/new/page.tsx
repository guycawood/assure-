import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBillingEntities, getClients } from "@/lib/sourcing-data";
import { Card, PageHead } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { JobFields } from "@/components/sourcing/job-fields";
import { createJob } from "../../actions";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [clients, entities] = await Promise.all([getClients(supabase), getBillingEntities(supabase)]);
  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing+", href: "/sourcing" }, { label: "Jobs", href: "/sourcing/jobs" }, { label: "New job" }]} title="Open a job"
        sub="The job number is given automatically when you save. Add specs next, then triage them." />
      <Card className="max-w-3xl p-5">
        <ActionForm action={createJob} submit="Open job" pendingLabel="Opening…">
          <JobFields clients={clients} entities={entities} briefId={sp.brief ?? null} />
        </ActionForm>
      </Card>
    </>
  );
}
