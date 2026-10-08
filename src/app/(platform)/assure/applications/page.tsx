import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/srt";
import { Empty, PageHead, Panel, Pill } from "@/components/ui";
import { ApplicationDecision, PlanDecision } from "./decide";

export const metadata: Metadata = { title: "Applications & plans" };

type App = { id: string; application_ref: string; company_name: string; contact_name: string; contact_email: string; country: string | null; major_category: string | null; data: Record<string, unknown>; status: string; review_note: string | null; created_at: string };
type Req = { id: string; supplier_id: string; current_tier: string | null; requested_tier: string; note: string | null; status: string; created_at: string };

const TONE: Record<string, "info" | "warn" | "ok" | "bad" | "neutral"> = { new: "info", reviewing: "warn", invited: "ok", rejected: "bad", duplicate: "neutral" };

// Supplier Engagement intake: public vendor applications and vendors' plan change requests.
export default async function Applications() {
  await requireInternal();
  const supabase = await createClient();
  const [{ data: apps }, { data: reqs }, { data: sups }] = await Promise.all([
    supabase.from("vendor_applications").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("subscription_requests").select("*").eq("status", "open").order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id, name, supplier_code"),
  ]);
  const supName = new Map(((sups ?? []) as { id: string; name: string; supplier_code: string | null }[]).map((s) => [s.id, s]));
  const list = (apps ?? []) as App[];
  const open = list.filter((a) => ["new", "reviewing"].includes(a.status));

  return (
    <>
      <PageHead crumbs={[{ label: "Assure+", href: "/assure" }, { label: "Applications & plans" }]} title="Applications & plans"
        sub="New vendors who applied through the public application form, and existing vendors asking to change their plan." />

      <Panel title={`Vendor applications · ${open.length} open`} sub="Inviting a vendor marks the application; then raise a new-vendor ticket on the SRT desk to start onboarding.">
        {list.length === 0 ? <Empty title="No applications yet">They arrive from the public page at /apply.</Empty> : (
          <ul className="divide-y divide-line">
            {list.map((a) => (
              <li key={a.id} className="space-y-2 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{a.application_ref}</span>
                  <span className="font-bold">{a.company_name}</span>
                  <Pill tone={TONE[a.status] ?? "neutral"}>{a.status}</Pill>
                  <span className="text-xs text-muted">{[a.major_category, a.country].filter(Boolean).join(" · ")} · {a.contact_name} ({a.contact_email}) · {timeAgo(a.created_at)}</span>
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-accent">Application details</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3">{JSON.stringify(a.data, null, 2)}</pre>
                </details>
                {a.review_note && <p className="text-xs text-muted">Note: {a.review_note}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <ApplicationDecision id={a.id} status={a.status} />
                  {a.status === "invited" && <Link href={`/assure/srt/tickets/new?prospect=${encodeURIComponent(a.company_name)}`} className="text-xs font-semibold text-accent hover:underline">Raise new-vendor ticket →</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Plan change requests · ${(reqs ?? []).length}`} sub="Vendors can request a plan; only procurement, the Procurement head or an admin can change it.">
        {(reqs ?? []).length === 0 ? <Empty title="No open requests" /> : (
          <ul className="divide-y divide-line">
            {((reqs ?? []) as Req[]).map((r) => {
              const s = supName.get(r.supplier_id);
              return (
                <li key={r.id} className="space-y-2 px-5 py-4 text-sm">
                  <p><Link href={`/assure/suppliers/${r.supplier_id}`} className="font-bold hover:underline">{s?.name ?? "Supplier"}</Link> <span className="text-muted">{s?.supplier_code}</span> wants <b className="capitalize">{r.requested_tier}</b> (now {r.current_tier ?? "none"}) · {timeAgo(r.created_at)}</p>
                  {r.note && <p className="text-xs text-muted">“{r.note}”</p>}
                  <PlanDecision id={r.id} supplierId={r.supplier_id} tier={r.requested_tier} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
