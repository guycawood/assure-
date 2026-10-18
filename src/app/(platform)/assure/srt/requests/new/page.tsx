import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHead, Panel } from "@/components/ui";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "New onboarding request" };

export default async function NewRequestPage() {
  await requireInternal();
  const supabase = await createClient();
  const [{ data: markets }, { data: cats }] = await Promise.all([
    supabase.from("markets").select("code, name, region_code").eq("active", true).order("name"),
    supabase.from("tax_categories").select("id, name, form_type").eq("active", true).order("name").limit(500),
  ]);
  return (
    <>
      <PageHead title="New onboarding request" sub="Stages 1 and 2: the business need and a complete request. We check for an existing supplier before anything is saved; Procurement then approves the need and the route."
        crumbs={[{ label: "SRM", href: "/assure" }, { label: "Onboarding control", href: "/assure/srt" }, { label: "Requests", href: "/assure/srt/requests" }, { label: "New" }]} />
      <Panel title="Request">
        <div className="p-5">
          <RequestForm markets={((markets ?? []) as { name: string }[]).map((m) => m.name)}
            taxCategories={((cats ?? []) as { id: string; name: string; form_type: string }[]).map((c) => ({ id: c.id, name: `${c.name} (${c.form_type.replace(/_/g, " ")})` }))} />
        </div>
      </Panel>
    </>
  );
}
