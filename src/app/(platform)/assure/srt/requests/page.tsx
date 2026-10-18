import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { byId, getInternalPeople } from "@/lib/data";
import { formatDate, formatEur, personName } from "@/lib/srt";
import { CASE_STATUS_LABEL, taxonomyOf, TAXONOMY } from "@/lib/onboarding";
import { ButtonLink, Card, Empty, PageHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Onboarding requests" };

type CaseRow = {
  id: string; case_no: number; kind: string; status: string; proposed_name: string; client: string | null; market: string; category: string; urgency: string;
  estimated_spend: number | null; requested_by: string | null; requested_at: string; supplier_id: string | null; duplicate_matches: unknown[]; route: string | null;
};

// Stage 1-3 of the standard: every new supplier starts as a request, and Procurement triages it.
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireInternal();
  const { status } = await searchParams;
  const supabase = await createClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("onboarding_cases").select("*").order("requested_at", { ascending: false }).limit(500),
    getInternalPeople(supabase),
  ]);
  const pMap = byId(people);
  const all = (data ?? []) as CaseRow[];
  const rows = status ? all.filter((c) => c.status === status) : all;
  const tab = (v: string | undefined, label: string) => (
    <Link href={v ? `/assure/srt/requests?status=${v}` : "/assure/srt/requests"}
      className={`rounded-full px-3 py-1 text-sm font-semibold ${status === v ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-fg"}`}>
      {label} <span className="font-mono text-xs">{v ? all.filter((c) => c.status === v).length : all.length}</span>
    </Link>
  );
  return (
    <>
      <PageHead title="Onboarding requests" sub="No supplier is contacted or engaged outside this route: request, duplicate check, then Procurement approves the need and the route."
        crumbs={[{ label: "SRM", href: "/assure" }, { label: "Onboarding control", href: "/assure/srt" }, { label: "Requests" }]}>
        <ButtonLink href="/assure/srt/requests/new" variant="primary">New onboarding request</ButtonLink>
      </PageHead>
      <div className="flex flex-wrap gap-2">
        {tab(undefined, "All")}{tab("submitted", "Waiting for triage")}{tab("in_onboarding", "In onboarding")}{tab("released", "Released")}
        {tab("on_hold", "On hold")}{tab("declined", "Declined")}{tab("duplicate", "Duplicates")}
      </div>
      <Card className="min-w-0">
        {rows.length === 0 ? <Empty title="No requests here" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{["Request", "Proposed supplier", "Client · market · category", "Spend", "Status", "Requested by"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((c) => {
                  const t = taxonomyOf("case", c.status);
                  return (
                    <tr key={c.id} className="align-top">
                      <td className="td"><Link href={`/assure/srt/requests/${c.id}`} className="font-mono text-xs font-semibold text-accent underline">#{c.case_no}</Link>
                        {c.kind === "revalidation" && <div className="text-xs text-muted">Revalidation</div>}</td>
                      <td className="td font-semibold">{c.supplier_id ? <Link href={`/assure/suppliers/${c.supplier_id}?tab=record`} className="hover:underline">{c.proposed_name}</Link> : c.proposed_name}
                        {c.duplicate_matches?.length > 0 && <div className="text-xs font-normal text-warn">{c.duplicate_matches.length} possible duplicate(s) at intake</div>}</td>
                      <td className="td">{[c.client, c.market, c.category].filter(Boolean).join(" · ")}{c.urgency === "urgent" && <div><Pill tone="warn">Urgent</Pill></div>}</td>
                      <td className="td font-mono text-xs">{c.estimated_spend != null ? formatEur(c.estimated_spend) : "—"}</td>
                      <td className="td"><Pill tone={TAXONOMY[t].tone}>{TAXONOMY[t].label}</Pill><div className="text-xs text-muted">{CASE_STATUS_LABEL[c.status] ?? c.status}{c.route ? ` · ${c.route} route` : ""}</div></td>
                      <td className="td text-xs">{personName(pMap.get(c.requested_by ?? ""))}<div className="text-muted">{formatDate(c.requested_at)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
