import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/sourcing";
import { Card, PageHead } from "@/components/ui";
import { ImpactGradeBadge } from "@/components/impact-grade/grade-badge";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { createBriefFromRateCard } from "../../../rate-card-actions";

export const metadata: Metadata = { title: "Brief from a rate card" };

type CardRow = {
  id: string; code: string; name: string; length_mm: string | null; width_mm: string | null; min_qty: string | null; max_qty: string | null;
  unit_price: string | null; currency: string | null; client_code: string | null; supplier_name: string | null; selectable: boolean;
  grade: { score: number | null; confidence: number | null } | null;
};

export default async function BriefFromCard({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;
  const supabase = await createClient();
  const [cards, clients, markets, settings] = await Promise.all([
    supabase.rpc("sourcing_rate_cards"),
    supabase.from("sourcing_clients").select("id, code, name").eq("active", true).order("name"),
    supabase.from("markets").select("code, name").eq("active", true).order("name"),
    supabase.from("sourcing_settings").select("triage_tolerance_percent").limit(1),
  ]);
  const card = ((cards.data as CardRow[] | null) ?? []).find((c) => c.id === id);
  if (!card || !card.selectable) notFound();
  const tol = Number((settings.data as { triage_tolerance_percent: number }[] | null)?.[0]?.triage_tolerance_percent ?? 10);
  const clientList = ((clients.data ?? []) as { id: string; code: string; name: string }[]).filter((c) => !card.client_code || c.code === card.client_code);

  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "New brief", href: "/briefing/new" }, { label: "Existing rate card", href: "/briefing/new/rate-card" }, { label: card.code }]}
        title={card.name} sub={`${card.supplier_name} · ${card.unit_price ? money(Number(card.unit_price), card.currency ?? "EUR", 2) : "no price"} each · ${card.length_mm ?? "?"} × ${card.width_mm ?? "?"} mm · ${card.min_qty ?? 0} to ${card.max_qty ?? "no limit"}`}>
        <ImpactGradeBadge score={card.grade?.score} />
      </PageHead>
      <div className="grid max-w-5xl gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <ActionForm action={createBriefFromRateCard} hidden={{ card: card.id }} submit="Create the brief">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Brief title" htmlFor="title"><input id="title" name="title" required maxLength={200} defaultValue={card.name} className="input" /></Field>
              <Field label="Client" htmlFor="client"><select id="client" name="client" required className="input">{clientList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Market" htmlFor="market"><select id="market" name="market" required className="input">{((markets.data ?? []) as { code: string; name: string }[]).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
              <Field label="Quantity" htmlFor="quantity" hint={`The card covers ${card.min_qty ?? 0} to ${card.max_qty ?? "no limit"}. Outside that, the supplier confirms the price.`}><input id="quantity" name="quantity" type="number" min={1} required defaultValue={card.min_qty ?? ""} className="input" /></Field>
              <Field label="Length (mm)" htmlFor="length" hint="Leave as it is for Adopt."><input id="length" name="length" type="number" min={1} step="any" defaultValue={card.length_mm ?? ""} className="input" /></Field>
              <Field label="Width (mm)" htmlFor="width"><input id="width" name="width" type="number" min={1} step="any" defaultValue={card.width_mm ?? ""} className="input" /></Field>
              <Field label="Needed by" htmlFor="target"><input id="target" name="target" type="date" className="input" /></Field>
            </div>
            <Field label="Note" htmlFor="note" hint="Optional."><textarea id="note" name="note" rows={2} maxLength={2000} className="input" /></Field>
          </ActionForm>
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <p className="font-semibold">What happens</p>
          <ul className="list-disc space-y-2 pl-5 text-muted">
            <li><b className="text-fg">Adopt:</b> same size and a quantity the card covers. The card price applies, with no RFQ.</li>
            <li><b className="text-fg">Adapt:</b> a size up to {tol}% different. The price scales from the card, and the grade is flagged for a recalculation.</li>
            <li><b className="text-fg">Further away:</b> refused. Start a normal brief so the work goes to an RFQ.</li>
            <li>No concepts or ideation. The brief, job and spec are created at once, with the card&apos;s Impact Grade.</li>
            <li>Only a sourcing lead can route a line away from an RFQ. If you are not one, the line waits for a lead to confirm it.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
