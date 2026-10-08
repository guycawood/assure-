import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfiles, getSupplier } from "@/lib/assure-data";
import { formatEur, RAG_LABEL } from "@/lib/srt";
import { RISK, SUPPLIER_STATUS, SUPPLIER_TIER } from "@/lib/assure";
import { ButtonLink, Card, PageHead, Pill, RagDot } from "@/components/ui";
import { OptPill, Tabs } from "@/components/assure/bits";
import {
  ActivityTab, CommercialTab, ComplianceTab, ContractsTab, DocumentsTab, OnboardingTab, OverviewTab, PerformanceTab, QualityTab, ReviewsTab, TasksTab,
} from "./tabs";

export const metadata: Metadata = { title: "Supplier" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "onboarding", label: "Onboarding gates" },
  { key: "compliance", label: "Compliance & certificates" },
  { key: "performance", label: "Performance" },
  { key: "commercial", label: "Commercial" },
  { key: "contracts", label: "Contracts" },
  { key: "quality", label: "Quality" },
  { key: "reviews", label: "Reviews" },
  { key: "tasks", label: "Tasks" },
  { key: "documents", label: "Documents" },
  { key: "activity", label: "Activity" },
];

// Supplier 360: one supplier across every Assure+ function. Onboarding gates are the SRT desk's view of the same record.
export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requireInternal();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const supabase = await createClient();
  const s = await getSupplier(supabase, id);
  if (!s) notFound();
  const profile = (await getProfiles(supabase)).get(id);
  const active = TABS.some((t) => t.key === tab) ? tab : "overview";
  const props = { supplier: s, profile, me };

  return (
    <>
      <PageHead
        title={s.name}
        sub={[s.supplier_code, s.region, s.market, s.category, s.client].filter(Boolean).join(" · ")}
        crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Suppliers", href: "/assure/suppliers" }, { label: s.name }]}
      >
        <ButtonLink href={`/assure/srt/tickets/new?supplier=${s.id}`}>Raise SRT ticket</ButtonLink>
      </PageHead>

      <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <OptPill list={SUPPLIER_STATUS} value={s.status} />
        {s.tier && <OptPill list={SUPPLIER_TIER} value={s.tier} />}
        {profile && <span className="inline-flex items-center gap-1.5">Risk <OptPill list={RISK} value={profile.risk_level} title={profile.risk_reason ?? undefined} /></span>}
        <span className="inline-flex items-center gap-2"><RagDot rag={s.rag} /> Onboarding {RAG_LABEL[s.rag].toLowerCase()}</span>
        {s.purchasing_blocked ? <Pill tone="bad">Purchasing blocked</Pill> : <Pill tone="ok">Purchasing allowed</Pill>}
        <span className="ml-auto text-muted">YTD spend <b className="text-fg">{formatEur(s.ytd_spend)}</b></span>
      </Card>

      <Tabs tabs={TABS} active={active} base={`/assure/suppliers/${s.id}`} />

      {active === "overview" && <OverviewTab {...props} />}
      {active === "onboarding" && <OnboardingTab {...props} />}
      {active === "compliance" && <ComplianceTab {...props} />}
      {active === "performance" && <PerformanceTab {...props} />}
      {active === "commercial" && <CommercialTab {...props} />}
      {active === "contracts" && <ContractsTab {...props} />}
      {active === "quality" && <QualityTab {...props} />}
      {active === "reviews" && <ReviewsTab {...props} />}
      {active === "tasks" && <TasksTab {...props} />}
      {active === "documents" && <DocumentsTab {...props} />}
      {active === "activity" && <ActivityTab {...props} />}
    </>
  );
}
