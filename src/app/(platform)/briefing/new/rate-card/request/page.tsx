import type { Metadata } from "next";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SPEC_TYPES } from "@/lib/sourcing";
import { Card, PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { createRateCardRequest } from "../../../rate-card-actions";

export const metadata: Metadata = { title: "Request a rate card" };

// When no approved card fits, ask the sourcing team to build one.
export default async function RequestRateCard({ searchParams }: { searchParams: Promise<{ brief?: string; title?: string; type?: string; substrate?: string; min?: string; max?: string; why?: string }> }) {
  await requireInternal();
  const { brief, title, type, substrate, min, max, why } = await searchParams;
  const supabase = await createClient();
  const [clients, markets, substrates] = await Promise.all([
    supabase.from("sourcing_clients").select("id, name").eq("active", true).order("name"),
    supabase.from("markets").select("code, name").eq("active", true).order("name"),
    supabase.from("library_records").select("code, name").eq("library_key", "substrates").eq("status", "active").order("name"),
  ]);
  return (
    <>
      <PageHead crumbs={[{ label: "Briefing+", href: "/briefing" }, { label: "New brief", href: "/briefing/new" }, { label: "Existing rate card", href: "/briefing/new/rate-card" }, { label: "Request a rate card" }]}
        title="Request a rate card" sub="Tell the sourcing team what you need. They take it, get the price, build the card, and tell you when it is ready." />
      <div className="grid max-w-5xl gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <ActionForm action={createRateCardRequest} hidden={{ brief }} submit="Send the request">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="What is the card for?" htmlFor="title"><input id="title" name="title" required maxLength={200} defaultValue={title ?? ""} placeholder="A3 floor decal, 300gsm board" className="input" /></Field>
              <Field label="Type" htmlFor="spec_type"><select id="spec_type" name="spec_type" defaultValue={type ?? "2d"} className="input">{SPEC_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
              <Field label="Material" htmlFor="substrate" hint="Optional."><select id="substrate" name="substrate" defaultValue={substrate ?? ""} className="input"><option value="">Not decided</option>{((substrates.data ?? []) as { code: string; name: string }[]).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
              <Field label="Client" htmlFor="client" hint="Leave as any client for a card the whole team can use."><select id="client" name="client" className="input"><option value="">Any client</option>{((clients.data ?? []) as { id: string; name: string }[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Length (mm)" htmlFor="length"><input id="length" name="length" type="number" min={1} step="any" className="input" /></Field>
              <Field label="Width (mm)" htmlFor="width"><input id="width" name="width" type="number" min={1} step="any" className="input" /></Field>
              <Field label="Smallest quantity" htmlFor="min_qty"><input id="min_qty" name="min_qty" type="number" min={1} defaultValue={min ?? ""} className="input" /></Field>
              <Field label="Largest quantity" htmlFor="max_qty"><input id="max_qty" name="max_qty" type="number" min={1} defaultValue={max ?? ""} className="input" /></Field>
              <Field label="Market" htmlFor="market" hint="Optional."><select id="market" name="market" className="input"><option value="">Any market</option>{((markets.data ?? []) as { code: string; name: string }[]).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
            </div>
            <Field label="Why do you need a new card?" htmlFor="reason" hint="How often it is bought and roughly how much."><textarea id="reason" name="reason" required rows={3} maxLength={2000} defaultValue={why ?? ""} className="input" /></Field>
          </ActionForm>
        </Card>
        <Card className="space-y-2 p-5 text-sm">
          <p className="font-semibold">What happens next</p>
          <ol className="list-decimal space-y-2 pl-5 text-muted">
            <li>The sourcing leads are told.</li>
            <li>Someone takes it and gets the price, usually with an RFQ.</li>
            <li>They build the card. A different person approves it, and it gets a reviewed Impact Grade.</li>
            <li>You are told, and can start a brief from the card.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
