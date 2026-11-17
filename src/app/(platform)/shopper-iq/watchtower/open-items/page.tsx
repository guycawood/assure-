import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDesignModel } from "@/lib/design-data";
import { Card, PageHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Design model open items" };

const BASE = "/shopper-iq/watchtower";
const isOpen = (s: string) => !["decided", "resolved", "closed"].includes(s);

// The workbook's OpenItems sheet, plus decisions taken since (e.g. the Impact Grade scale). Record a decision by
// correcting the item in the library.
export default async function OpenItems() {
  await requireInternal();
  const supabase = await createClient();
  const { libs } = await getDesignModel(supabase);
  const items = [...(libs.siq_de_open_items ?? [])].sort((a, b) => Number(a.data.seq) - Number(b.data.seq));
  return (
    <>
      <PageHead crumbs={[{ label: "Shopper IQ", href: "/shopper-iq" }, { label: "Watchtower", href: BASE }, { label: "Open items" }]} title="Design model open items"
        sub="Decisions and gaps to close before the model is calibrated and approved.">
        <Link href={`${BASE}/libraries/siq_de_open_items`} className="text-sm font-semibold text-accent hover:underline">Manage in the library</Link>
      </PageHead>
      <div className="space-y-3">
        {items.map((i) => {
          const status = String(i.data.status ?? "open");
          return (
            <Card key={i.code} className="p-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold">{i.code}</span>
                <Pill tone={isOpen(status) ? "warn" : "ok"}>{status}</Pill>
                {i.data.owner ? <span className="text-xs text-muted">Owner: {String(i.data.owner)}</span> : null}
              </div>
              <h3 className="mt-1.5 font-bold">{i.name}</h3>
              <dl className="mt-2 grid gap-x-6 gap-y-2 md:grid-cols-2">
                {[["Why it matters", i.data.why], ["Proposed default in v1", i.data.proposed_default], ["Decision", i.data.decision]].filter(([, v]) => v).map(([k, v]) => (
                  <div key={String(k)}><dt className="eyebrow">{String(k)}</dt><dd className="mt-0.5 text-muted">{String(v)}</dd></div>
                ))}
              </dl>
            </Card>
          );
        })}
      </div>
    </>
  );
}
