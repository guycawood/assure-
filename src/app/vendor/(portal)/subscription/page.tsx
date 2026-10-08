import { requireVendorCompany, rows } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/srt";
import { human, SUBSCRIPTION_TIERS, tierName } from "@/lib/vendor";
import { Card, PageHead, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { ActionDialog } from "@/components/vendor/action-form";
import { requestPlan } from "../actions";

export const metadata = { title: "Subscription" };

type Req = { id: string; current_tier: string | null; requested_tier: string; status: string; note: string | null; created_at: string; decided_at: string | null };

export default async function SubscriptionPage() {
  const ctx = await requireVendorCompany();
  const c = ctx.company;
  const supabase = await createClient();
  const reqs = await rows<Req>(supabase.from("subscription_requests").select("id, current_tier, requested_tier, status, note, created_at, decided_at").order("created_at", { ascending: false }).limit(5));
  const open = reqs.find((r) => r.status === "open");
  const admin = ctx.permission === "admin";
  const active = c.subscription_status === "active" || c.subscription_status === "pending";

  return (
    <>
      <PageHead title="Subscription" sub="Your Assure+ plan with adm Indicia. Ask for a different plan here; our account team confirms every change with you, and only adm Indicia can change your plan." />
      <Card className="flex flex-wrap items-center gap-4 border-accent/30 bg-accent-soft/40 p-5">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface text-accent"><MSymbol name="workspace_premium" size={24} /></span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Current plan</p>
          <p className="font-display text-xl font-bold">{active ? tierName(c.subscription_tier) : "No active plan"}</p>
          <p className="text-xs text-muted">Status: {human(c.subscription_status)}{c.subscription_renewal ? ` · renews ${formatDate(c.subscription_renewal)}` : ""}</p>
        </div>
        {open && <Pill tone="warn">Request open: {open.requested_tier === "cancel" ? "cancel plan" : tierName(open.requested_tier)}</Pill>}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {SUBSCRIPTION_TIERS.map((t) => {
          const current = active && c.subscription_tier === t.key;
          return (
            <Card key={t.key} className={`relative flex flex-col gap-3 p-5 ${current ? "ring-2 ring-accent" : ""}`}>
              {"featured" in t && t.featured && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-brand-navy px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-white">Most popular</span>}
              <p className="text-lg font-extrabold" style={{ color: t.colour }}>{t.name}</p>
              <p className="font-display text-2xl font-bold">{t.price}<span className="text-sm font-normal text-muted"> a year</span></p>
              <ul className="space-y-1.5 text-sm">
                {t.features.map((f) => <li key={f} className="flex gap-2"><MSymbol name="check" size={18} className="text-accent" /><span className="text-muted">{f}</span></li>)}
              </ul>
              <div className="mt-auto pt-2">
                {current ? <p className="rounded-lg bg-accent-soft py-2 text-center text-sm font-semibold text-accent">Your plan</p>
                  : open ? <p className="rounded-lg bg-surface-2 py-2 text-center text-sm text-muted">{open.requested_tier === t.key ? "Requested" : "Request open"}</p>
                  : admin ? (
                    <ActionDialog label={active ? `Move to ${t.name}` : `Choose ${t.name}`} variant="primary" title={`Ask for the ${t.name} plan`} sub={`${t.price} a year. adm Indicia's account team will contact you to confirm.`}
                      action={requestPlan} hidden={{ tier: t.key }} submit="Send request">
                      <label className="label" htmlFor={`n-${t.key}`}>Anything we should know? (optional)</label>
                      <textarea id={`n-${t.key}`} name="note" rows={3} maxLength={1000} className="input" />
                    </ActionDialog>
                  ) : <p className="text-center text-xs text-muted">Ask your portal admin</p>}
              </div>
            </Card>
          );
        })}
      </div>

      {reqs.length > 0 && (
        <Card className="overflow-x-auto">
          <p className="border-b border-line px-5 py-3 font-display text-[0.95rem] font-bold">Your requests</p>
          <table className="w-full text-sm">
            <thead><tr><th className="th">Requested</th><th className="th">From</th><th className="th">To</th><th className="th">Status</th></tr></thead>
            <tbody>
              {reqs.map((r) => (
                <tr key={r.id}><td className="td">{formatDate(r.created_at)}</td><td className="td">{tierName(r.current_tier)}</td><td className="td">{r.requested_tier === "cancel" ? "Cancel plan" : tierName(r.requested_tier)}</td>
                  <td className="td"><Pill tone={r.status === "open" ? "warn" : r.status === "actioned" ? "ok" : "neutral"}>{r.status === "actioned" ? "Done" : human(r.status)}</Pill></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
