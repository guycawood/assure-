import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfiles, getSupplier } from "@/lib/assure-data";
import { formatEur, RAG_LABEL } from "@/lib/srt";
import { RISK, SUPPLIER_STATUS, SUPPLIER_TIER } from "@/lib/assure";
import { ButtonLink, Card, PageHead, Pill, RagDot } from "@/components/ui";
import { OptPill, Tabs } from "@/components/assure/bits";
import { ApprovalRequests } from "@/components/approvals/requests";
import { onboardingLine, TAXONOMY, type Taxonomy } from "@/lib/onboarding";
import { OnboardingRecord } from "./onboarding-record";
import { CapabilityProfile } from "@/components/assure/capability-profile";
import { ImpactGradeBadge } from "@/components/impact-grade/grade-badge";
import { getCarbonIntensity, getSupplierGrade } from "@/lib/impact-grade-data";
import { IntensityChip } from "@/components/impact-grade/intensity-chip";
import { rollupIntensity } from "@/lib/carbon-intensity";
import {
  ActivityTab, CommercialTab, ComplianceTab, ContractsTab, DocumentsTab, OnboardingTab, OverviewTab, PerformanceTab, QualityTab, ReviewsTab, TasksTab,
} from "./tabs";
import { JobsTab } from "./jobs-tab";
import { HsTable } from "@/components/sourcing/hs-table";

export const metadata: Metadata = { title: "Supplier" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "record", label: "Onboarding record" },
  { key: "onboarding", label: "Onboarding gates" },
  { key: "capabilities", label: "Capabilities, machines & tooling" },
  { key: "compliance", label: "Compliance & certificates" },
  { key: "performance", label: "Performance" },
  { key: "jobs", label: "Jobs & payments" },
  { key: "hs", label: "HS codes" },
  { key: "commercial", label: "Commercial" },
  { key: "contracts", label: "Contracts" },
  { key: "quality", label: "Quality" },
  { key: "reviews", label: "Reviews" },
  { key: "tasks", label: "Tasks" },
  { key: "documents", label: "Documents" },
  { key: "activity", label: "Activity" },
];

// Supplier 360: one supplier across every SRM function. Onboarding gates are the SRT desk's view of the same record.
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
  const [ig, ciRows, moneyRes] = await Promise.all([getSupplierGrade(supabase, s.id), getCarbonIntensity(supabase, { supplierId: s.id }), supabase.rpc("division_can", { p_module: "assure", p_capability: "see_money" })]);
  const canSeeMoney = moneyRes.data === true;
  const ci = rollupIntensity(ciRows);

  return (
    <>
      <PageHead
        title={s.name}
        sub={[s.supplier_code, s.region, s.market, s.category, s.client].filter(Boolean).join(" · ")}
        crumbs={[{ label: "SRM", href: "/assure" }, { label: "Suppliers", href: "/assure/suppliers" }, { label: s.name }]}
      >
        <ButtonLink href={`/assure/srt/tickets/new?supplier=${s.id}`}>Raise SRT ticket</ButtonLink>
      </PageHead>

      <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <Pill tone={TAXONOMY[(s.onboarding_state ?? "in_review") as Taxonomy].tone}>{onboardingLine(s)}</Pill>
        <OptPill list={SUPPLIER_STATUS} value={s.status} />
        {s.tier && <OptPill list={SUPPLIER_TIER} value={s.tier} />}
        {profile && <span className="inline-flex items-center gap-1.5">Risk <OptPill list={RISK} value={profile.risk_level} title={profile.risk_reason ?? undefined} /></span>}
        <span className="inline-flex items-center gap-2"><RagDot rag={s.rag} /> Onboarding {RAG_LABEL[s.rag].toLowerCase()}</span>
        {s.purchasing_blocked ? <Pill tone="bad">Purchasing blocked</Pill> : <Pill tone="ok">Purchasing allowed</Pill>}
        <span className="inline-flex items-center gap-1.5" title={`Average Impact Grade of the ${ig.graded} graded specs on this supplier's purchase orders`}>
          Impact Grade <ImpactGradeBadge score={ig.avg} />{ig.specs > 0 && <span className="text-xs text-muted">{ig.graded} of {ig.specs} specs</span>}
        </span>
        <span className="inline-flex items-center gap-1.5" title={`Carbon intensity of the specs on this supplier's estimates: ${ci.measured} of ${ci.specs} measured`}>
          Carbon intensity <IntensityChip economic={ci.economic} physical={ci.physical} />
        </span>
        {canSeeMoney && <span className="ml-auto text-muted">YTD spend <b className="text-fg">{formatEur(s.ytd_spend)}</b></span>}
      </Card>

      <ApprovalRequests entityIds={s.id} types={["FAST_TRACK", "FAST_TRACK_FINANCE", "SUPPLIER_REACTIVATE"]} meId={me.id} />

      <Tabs tabs={TABS} active={active} base={`/assure/suppliers/${s.id}`} />

      {active === "overview" && <OverviewTab {...props} />}
      {active === "record" && <OnboardingRecord supplierId={s.id} me={me} />}
      {active === "onboarding" && <OnboardingTab {...props} />}
      {active === "capabilities" && <CapabilityProfile supplierId={s.id} mode="internal" />}
      {active === "compliance" && <ComplianceTab {...props} />}
      {active === "performance" && <PerformanceTab {...props} />}
      {active === "jobs" && <JobsTab supplierId={s.id} />}
      {active === "hs" && <HsTable supplierId={s.id} showJob />}
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
