import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/sourcing";
import { ButtonLink, Card, PageHead, Panel, Pill } from "@/components/ui";
import { approveCardRecord, changeCardPrice, retireCard } from "./request-actions";
import { ImpactGradeBadge } from "@/components/impact-grade/grade-badge";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { Td, Th, fmtDateTime } from "@/components/sourcing/bits";
import { calculateAllCardGrades, calculateCardGrade, reviewCardGrade } from "./actions";

export const metadata: Metadata = { title: "Rate cards" };

type CardRow = {
  id: string; code: string; name: string; status: string; effective_from: string; effective_to: string | null;
  spec_type: string | null; length_mm: string | null; width_mm: string | null; min_qty: string | null; max_qty: string | null;
  unit_price: string | null; currency: string | null; client_code: string | null; supplier_name: string | null; supplier_eligible: boolean;
  grade: { score: number | null; letter: string | null; confidence: number | null; range_low: number | null; range_high: number | null; review_status: "unreviewed" | "reviewed" | "disputed"; updated_at: string } | null;
  in_date: boolean; selectable: boolean;
};

const REVIEW_TONE = { unreviewed: "warn", reviewed: "ok", disputed: "bad" } as const;
const REVIEW_LABEL = { unreviewed: "Needs review", reviewed: "Reviewed", disputed: "Disputed" } as const;

// Approved rate cards, with the Impact Grade each one carries. A card can only be chosen once its grade is reviewed.
export default async function RateCardsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireInternal();
  const { show } = await searchParams;
  const supabase = await createClient();
  const all = ((await supabase.rpc("sourcing_rate_cards")).data as CardRow[] | null) ?? [];
  const list = show === "all" ? all : show === "needs" ? all.filter((c) => !c.selectable) : all.filter((c) => c.selectable);
  const needs = all.filter((c) => !c.selectable).length;
  const tab = (key: string, label: string, n: number) => (
    <a href={key === "ready" ? "/sourcing/rate-cards" : `/sourcing/rate-cards?show=${key}`}
      className={`border-b-2 px-3 py-2 text-sm font-semibold ${(show ?? "ready") === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>{label} ({n})</a>
  );

  return (
    <>
      <PageHead crumbs={[{ label: "Sourcing", href: "/sourcing" }, { label: "Rate cards" }]} title="Rate cards"
        sub="Approved prices for repeat work. Each card carries an Impact Grade, and can only be chosen once a second person has reviewed it." />
      <nav className="flex flex-wrap items-center justify-between gap-2 border-b border-line">
        <div className="flex gap-1">{tab("ready", "Approved", all.length - needs)}{tab("needs", "Needs attention", needs)}{tab("all", "All", all.length)}</div>
        <div className="flex gap-2"><ButtonLink href="/sourcing/rate-cards/reorder" variant="primary">Reorder</ButtonLink><ButtonLink href="/sourcing/rate-cards/opportunities">Opportunities</ButtonLink><ButtonLink href="/sourcing/rate-cards/programmes">Programmes</ButtonLink><ButtonLink href="/sourcing/rate-cards/requests">Requests</ButtonLink></div>
      </nav>

      {needs > 0 && all.some((c) => !c.grade) && (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
          <span>{all.filter((c) => !c.grade).length} card(s) have no Impact Grade yet.</span>
          <ActionForm action={calculateAllCardGrades} submit="Calculate the missing grades" variant="secondary" inline />
        </Card>
      )}

      <Panel title={show === "all" ? "All rate cards" : show === "needs" ? "Needs attention" : "Approved rate cards"} sub={`${list.length} card(s)`}>
        {list.length === 0 ? <p className="px-5 py-4 text-sm text-muted">{show === "needs" ? "Every card is graded, reviewed and usable." : "No approved cards yet. Calculate and review a grade to approve one."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Card</Th><Th>Supplier</Th><Th>Size and quantity</Th><Th>Price</Th><Th>Impact Grade</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {list.map((c) => (
                  <tr key={c.id} className="align-top">
                    <Td><b>{c.name}</b><br /><span className="text-xs text-muted">{c.code}{c.client_code ? ` · ${c.client_code} only` : ""}</span></Td>
                    <Td>{c.supplier_name ?? "No supplier"}{c.supplier_name && !c.supplier_eligible && <><br /><Pill tone="bad">Not eligible</Pill></>}</Td>
                    <Td className="tabular-nums">{c.length_mm && c.width_mm ? `${c.length_mm} × ${c.width_mm} mm` : "No size"}<br /><span className="text-xs text-muted">{c.min_qty ?? 0} to {c.max_qty ?? "no limit"}</span></Td>
                    <Td className="tabular-nums">{c.unit_price ? money(Number(c.unit_price), c.currency ?? "EUR", 2) : "No price"}</Td>
                    <Td>
                      {c.grade ? (
                        <div className="space-y-1">
                          <ImpactGradeBadge score={c.grade.score} />
                          <p className="text-xs text-muted">{c.grade.confidence ?? 0}% confidence{c.grade.range_low != null ? ` · ${Math.round(c.grade.range_low)} to ${Math.round(c.grade.range_high ?? 0)}` : ""}</p>
                          <Pill tone={REVIEW_TONE[c.grade.review_status]}>{REVIEW_LABEL[c.grade.review_status]}</Pill>
                        </div>
                      ) : <Pill tone="warn">No grade</Pill>}
                    </Td>
                    <Td>
                      <div className="space-y-2">
                        <Pill tone={c.selectable ? "ok" : "warn"}>{c.selectable ? "Can be chosen" : c.status === "pending_approval" ? "Waiting for approval" : !c.in_date ? "Out of date" : !c.supplier_eligible ? "Supplier not eligible" : "Needs a reviewed grade"}</Pill>
                        {c.status === "pending_approval" && (
                          <ActionForm action={approveCardRecord} hidden={{ card: c.id, decision: "approve" }} submit="Approve the card" variant="primary">
                            <Field label="Note" htmlFor={`ap-${c.id}`} hint="A different governor from the one who built it."><input id={`ap-${c.id}`} name="note" className="input" /></Field>
                          </ActionForm>
                        )}
                        {c.status === "active" && (
                          <details className="rounded-md border border-line p-2">
                            <summary className="cursor-pointer text-xs font-semibold">Price and status</summary>
                            <div className="mt-2 space-y-3">
                              <ActionForm action={changeCardPrice} hidden={{ card: c.id }} submit="Change the price" variant="secondary">
                                <Field label="New unit price" htmlFor={`np-${c.id}`}><input id={`np-${c.id}`} name="price" type="number" min={0} step="any" required defaultValue={c.unit_price ?? ""} className="input" /></Field>
                                <Field label="From" htmlFor={`nf-${c.id}`} hint="Leave blank for tomorrow."><input id={`nf-${c.id}`} name="from" type="date" className="input" /></Field>
                                <Field label="Why" htmlFor={`nn-${c.id}`} hint="A different governor approves the new version."><input id={`nn-${c.id}`} name="note" required className="input" /></Field>
                              </ActionForm>
                              <ActionForm action={retireCard} hidden={{ card: c.id }} submit="Retire the card" variant="danger" confirm="Retire this rate card? It can no longer be chosen.">
                                <Field label="Why" htmlFor={`rt-${c.id}`}><input id={`rt-${c.id}`} name="note" required className="input" /></Field>
                              </ActionForm>
                            </div>
                          </details>
                        )}
                        <details className="rounded-md border border-line p-2">
                          <summary className="cursor-pointer text-xs font-semibold">Grade</summary>
                          <div className="mt-2 space-y-3">
                            <ActionForm action={calculateCardGrade} hidden={{ id: c.id }} submit={c.grade ? "Recalculate" : "Calculate"} variant="secondary" inline />
                            {c.grade && c.grade.review_status !== "reviewed" && (
                              <ActionForm action={reviewCardGrade} hidden={{ id: c.id, status: "reviewed" }} submit="Mark reviewed" variant="primary">
                                <Field label="Note" htmlFor={`rv-${c.id}`} hint="A different person from the one who calculated it."><input id={`rv-${c.id}`} name="note" className="input" /></Field>
                              </ActionForm>
                            )}
                            {c.grade && c.grade.review_status !== "disputed" && (
                              <ActionForm action={reviewCardGrade} hidden={{ id: c.id, status: "disputed" }} submit="Dispute" variant="secondary">
                                <Field label="What is wrong?" htmlFor={`ds-${c.id}`}><input id={`ds-${c.id}`} name="note" required className="input" /></Field>
                              </ActionForm>
                            )}
                            {c.grade && <p className="text-xs text-muted">Last calculated {fmtDateTime(c.grade.updated_at)}</p>}
                          </div>
                        </details>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
