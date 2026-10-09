import Link from "next/link";
import { BadgeCheck, FileText, Search, UserPlus } from "lucide-react";
import { requireVendor, rows, rpcList, type PushRow, type VendorPoRow, type VendorRfqRow } from "@/lib/vendor-data";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/demo/config";
import { formatDate, RFI_COLUMNS, type VendorRfi } from "@/lib/srt";
import { daysUntil, human, money, statusTone, tierName } from "@/lib/vendor";
import { ButtonLink, Card, Empty, Panel, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { Stepper, type Step } from "@/components/stepper";

export const metadata = { title: "Dashboard" };

const VENDOR_STEPS: Step[] = [
  { label: "Registered", icon: UserPlus },
  { label: "Your information", icon: FileText },
  { label: "adm Indicia review", icon: Search },
  { label: "Approved", icon: BadgeCheck },
];

type Todo = { icon: string; title: string; detail: string; href: string; due?: string | null; tone?: "bad" | "warn" | "info" };

export default async function VendorDashboard() {
  const ctx = await requireVendor();
  if (!ctx.company) {
    return (
      <Card className="max-w-2xl p-6">
        <h1 className="mb-1 font-display text-xl font-bold">Your account isn&apos;t linked to a vendor yet</h1>
        <p className="text-sm text-muted">We couldn&apos;t match {ctx.profile.email} to a vendor. Ask your adm Indicia contact, or your company&apos;s portal admin, to invite this email address.</p>
      </Card>
    );
  }
  const c = ctx.company;
  const supabase = await createClient();
  const [rfqs, pushes, pos, certs, tasks, ncrs, issues, surveys, contracts, rfis, deliveries, deployments] = await Promise.all([
    rpcList<VendorRfqRow>("rfq_vendor_list"),
    rpcList<PushRow>("triage_push_list"),
    rpcList<VendorPoRow>("po_vendor_list"),
    rows<{ id: string; cert_type_name: string; expiry_date: string | null; expiry_status: string; verification_status: string }>(supabase.from("vendor_certificates").select("id, cert_type_name, expiry_date, expiry_status, verification_status")),
    rows<{ id: string; title: string; status: string; due_date: string | null; priority: string }>(supabase.from("action_plan_tasks").select("id, title, status, due_date, priority").in("status", ["open", "in_progress"])),
    rows<{ id: string; ncr_ref: string; title: string; acknowledgement_status: string; due_date: string | null }>(supabase.from("vendor_ncrs").select("id, ncr_ref, title, acknowledgement_status, due_date, status").eq("status", "open")),
    rows<{ id: string; title: string; severity: string }>(supabase.from("vendor_performance_issues").select("id, title, acknowledgement_status, severity").eq("acknowledgement_status", "pending")),
    rows<{ id: string; template_name: string; due_date: string | null }>(supabase.from("vendor_survey_responses").select("id, template_name, status, due_date").in("status", ["draft", "rejected"])),
    rows<{ id: string; title: string; due_date: string | null }>(supabase.from("vendor_contracts").select("id, title, status, due_date").in("status", ["sent", "viewed", "in_review"])),
    rows<VendorRfi>(supabase.from("vendor_rfis").select(RFI_COLUMNS).order("sent_at", { ascending: false }).limit(1)),
    rpcList<{ delivery_number: string; planned_delivery_date: string | null; remaining: number; status: string; shipments: { shipment_number: string; pod_status: string }[] }>("logistics_vendor_deliveries"),
    rpcList<{ id: string; deployment_code: string; outlet_name: string; planned_date: string | null; stage: string }>("execution_vendor_deployments"),
  ]);

  const openRfqs = rfqs.filter((r) => r.open && r.invitation_status !== "declined" && r.quote_status !== "submitted");
  const pendingPush = pushes.filter((p) => p.status === "pending");
  const poWaiting = pos.filter((p) => p.status === "issued");
  const alerts = certs.filter((x) => x.verification_status !== "rejected" && (x.expiry_status === "expired" || x.expiry_status === "expiring_soon"));
  const expired = alerts.filter((x) => x.expiry_status === "expired");
  const rejected = certs.filter((x) => x.verification_status === "rejected");
  const rfi = rfis[0];

  const todos = ([] as Todo[]).concat(
    openRfqs.map((r) => ({ icon: "request_quote", title: `Quote: ${r.title}`, detail: `${r.rfq_number} · ${r.line_count} line${r.line_count === 1 ? "" : "s"}${r.quote_status === "draft" ? " · draft saved" : ""}`, href: `/vendor/quotes/${r.rfq_id}`, due: r.due_at, tone: "info" as const })),
    pendingPush.map((p) => ({ icon: "price_check", title: `Confirm price: ${p.spec_title}`, detail: `${p.quantity} at ${money(p.unit_price, p.currency)} · ${p.job_number}`, href: "/vendor/pushed-prices", due: p.respond_by, tone: "info" as const })),
    poWaiting.map((p) => ({ icon: "inventory_2", title: `Accept PO ${p.po_number}`, detail: `${p.title} · ${money(p.total_value, p.currency)}`, href: `/vendor/orders/${p.id}`, due: p.delivery_date, tone: "warn" as const })),
    contracts.map((k) => ({ icon: "contract", title: `Sign: ${k.title}`, detail: "Waiting for your signature", href: `/vendor/contracts/${k.id}`, due: k.due_date, tone: "warn" as const })),
    ncrs.filter((n) => n.acknowledgement_status === "pending").map((n) => ({ icon: "report", title: `Respond to ${n.ncr_ref}`, detail: n.title, href: "/vendor/quality", due: n.due_date, tone: "bad" as const })),
    issues.map((i) => ({ icon: "monitoring", title: "Performance issue", detail: i.title, href: "/vendor/performance", tone: i.severity === "critical" ? "bad" as const : "warn" as const })),
    surveys.map((v) => ({ icon: "quiz", title: `Survey: ${v.template_name}`, detail: "Waiting for your answers", href: `/vendor/surveys/${v.id}`, due: v.due_date, tone: "info" as const })),
    tasks.map((k) => ({ icon: "checklist", title: k.title, detail: `Action plan · ${human(k.status)} · ${human(k.priority)} priority`, href: "/vendor/action-plans", due: k.due_date })),
    rejected.map((x) => ({ icon: "verified", title: `Re-upload ${x.cert_type_name}`, detail: "adm Indicia couldn't accept this certificate", href: "/vendor/compliance", tone: "bad" as const })),
    deliveries.filter((d) => d.remaining > 0 && ["planned", "booked", "dispatched", "in_transit"].includes(d.status)).map((d) => ({ icon: "local_shipping", title: `Ship ${d.delivery_number}`, detail: `${d.remaining} still to ship`, href: "/vendor/shipping", due: d.planned_delivery_date, tone: "info" as const })),
    deliveries.flatMap((d) => d.shipments.filter((s) => s.pod_status === "not_received" || s.pod_status === "rejected").map((s) => ({ icon: "receipt_long", title: `Upload POD for ${s.shipment_number}`, detail: s.pod_status === "rejected" ? "adm Indicia rejected the POD" : d.delivery_number, href: "/vendor/shipping", tone: s.pod_status === "rejected" ? "bad" as const : "warn" as const }))),
    deployments.filter((d) => d.stage === "delivered").map((d) => ({ icon: "construction", title: `Install at ${d.outlet_name}`, detail: d.deployment_code, href: "/vendor/installations", due: d.planned_date, tone: "info" as const })),
  ).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const openTasks = tasks.length + ncrs.filter((n) => n.acknowledgement_status === "pending").length + issues.length + surveys.length + contracts.length;

  return (
    <>
      {isDemoMode() && <p className="rounded-lg border border-line bg-warn-soft px-3 py-2 text-sm"><b>Demo mode.</b> You are seeing {c.name}&apos;s view of the vendor portal.</p>}

      <section className="overflow-hidden rounded-2xl border border-line text-white shadow-card" style={{ background: "linear-gradient(120deg,#010062 0%,#1d2a7a 55%,#2E9E8F 140%)" }}>
        <div className="flex flex-wrap items-center gap-5 px-6 py-6">
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-white/60">Welcome back</p>
            <h1 className="font-display text-[1.7rem] font-bold leading-tight">{c.name}</h1>
            <p className="mt-1 text-sm text-white/75">{[c.supplier_code, c.category, c.market].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/vendor/subscription" className="rounded-xl bg-white/10 px-4 py-2.5 text-sm hover:bg-white/15">
              <span className="block text-[0.65rem] font-bold uppercase tracking-wider text-white/60">Plan</span>
              <span className="font-bold">{tierName(c.subscription_tier)}</span>
            </Link>
            <div className="rounded-xl bg-white/10 px-4 py-2.5 text-sm">
              <span className="block text-[0.65rem] font-bold uppercase tracking-wider text-white/60">Status</span>
              <span className="font-bold">{human(c.status)}</span>
            </div>
          </div>
        </div>
        {alerts.length > 0 && (
          <Link href="/vendor/compliance" className="flex items-center gap-2 border-t border-white/15 bg-black/15 px-6 py-2.5 text-sm hover:bg-black/25">
            <MSymbol name="warning" size={18} className={expired.length ? "text-red-300" : "text-amber-300"} />
            <span>
              {expired.length > 0 && <b>{expired.length} certificate{expired.length > 1 ? "s have" : " has"} expired. </b>}
              {alerts.length - expired.length > 0 && <>{alerts.length - expired.length} expire{alerts.length - expired.length > 1 ? "" : "s"} within 90 days. </>}
              Upload renewals to keep trading.
            </span>
            <MSymbol name="chevron_right" size={18} className="ml-auto" />
          </Link>
        )}
      </section>

      {rfi && rfi.status !== "cancelled" && (
        <Card className="px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-display font-bold">Vendor onboarding</p>
            {(rfi.status === "sent" || rfi.status === "returned") && <ButtonLink href="/vendor/information-request" variant="primary">Complete your information</ButtonLink>}
          </div>
          <Stepper steps={VENDOR_STEPS} current={rfi.status === "submitted" ? 2 : rfi.status === "approved" ? 3 : 1} failedAt={rfi.status === "rejected" ? 2 : undefined} />
          {rfi.status === "returned" && rfi.review_note && <p className="mt-3 rounded-lg bg-warn-soft p-3 text-sm"><b>adm Indicia asked for changes:</b> {rfi.review_note}</p>}
          {(rfi.status === "sent" || rfi.status === "returned") && <p className="mt-2 text-xs text-muted">Please complete by {formatDate(rfi.expires_at)}.</p>}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open tasks" value={openTasks} hint="Actions, NCRs, issues, surveys and signatures" icon={<MSymbol name="task_alt" />} tone={openTasks ? "warn" : undefined} />
        <Stat label="Open quote requests" value={openRfqs.length} hint={openRfqs[0] ? `Next due ${formatDate(openRfqs.map((r) => r.due_at).sort()[0])}` : "Nothing to price"} icon={<MSymbol name="request_quote" />} />
        <Stat label="POs to accept" value={poWaiting.length} hint={pendingPush.length ? `${pendingPush.length} pushed price${pendingPush.length > 1 ? "s" : ""} to confirm` : "Purchase orders waiting for you"} icon={<MSymbol name="inventory_2" />} tone={poWaiting.length ? "warn" : undefined} />
        <Stat label="Compliance alerts" value={alerts.length + rejected.length} hint={`${expired.length} expired · ${rejected.length} rejected`} icon={<MSymbol name="verified" />} tone={expired.length || rejected.length ? "bad" : alerts.length ? "warn" : "ok"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Needs your attention" sub="Everything waiting for you, soonest first">
          {todos.length === 0 ? <Empty title="You're all caught up">Nothing is waiting for you right now.</Empty> : (
            <ul className="divide-y divide-line">
              {todos.slice(0, 12).map((t, i) => {
                const d = daysUntil(t.due);
                return (
                  <li key={i}>
                    <Link href={t.href} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${t.tone === "bad" ? "bg-bad-soft text-bad" : t.tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"}`}><MSymbol name={t.icon} size={18} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.title}</span>
                        <span className="block truncate text-xs text-muted">{t.detail}</span>
                      </span>
                      {t.due && <Pill tone={d !== null && d < 0 ? "bad" : d !== null && d <= 3 ? "warn" : "neutral"}>{d !== null && d < 0 ? "Overdue" : `Due ${formatDate(t.due)}`}</Pill>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Purchase orders" actions={<ButtonLink href="/vendor/orders">All orders</ButtonLink>}>
          {pos.length === 0 ? <Empty title="No purchase orders yet" /> : (
            <ul className="divide-y divide-line">
              {pos.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link href={`/vendor/orders/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{p.po_number}</span>
                      <span className="block truncate text-xs text-muted">{p.title} · {money(p.total_value, p.currency)}</span>
                    </span>
                    <Pill tone={statusTone(p.status)}>{p.status === "issued" ? "To accept" : human(p.status)}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
