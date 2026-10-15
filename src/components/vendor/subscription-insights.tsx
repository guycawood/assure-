import Link from "next/link";
import { formatDate } from "@/lib/srt";
import { money, SUBSCRIPTION_TIERS, tierName } from "@/lib/vendor";
import { Panel } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

// The SRM insights a vendor pays for, on the portal overview. Each insight belongs to the plan feature that
// includes it; insights above the vendor's plan show locked with the plan that unlocks them.

type Tier = (typeof SUBSCRIPTION_TIERS)[number]["key"];
const RANK: Record<Tier, number> = { silver: 1, gold: 2, platinum: 3, diamond: 4 };

export type InsightData = {
  tier: string | null;
  active: boolean;
  scores: { period: string; composite_score: number | null; sustainability_score: number | null }[];
  certs: { expiry_status: string; verification_status: string }[];
  pos: { po_date: string; total_value: number; currency: string; status: string }[];
  rfqs: { invitation_status: string; quote_status: string | null; due_at: string }[];
  pushes: { status: string }[];
  reviews: { meeting_date: string | null; next_review_date: string | null; title: string }[];
};

type Insight = { tier: Tier; feature: string; icon: string; label: string; value: string; hint: string; href: string };

const n0 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Number(n).toFixed(0));

function build(d: InsightData): Insight[] {
  const today = new Date().toLocaleDateString("en-CA");
  const month = today.slice(0, 7);
  const yearAgo = new Date(Date.now() - 365 * 864e5).toLocaleDateString("en-CA");

  const [latest, prev] = d.scores;
  const delta = latest?.composite_score != null && prev?.composite_score != null ? Number(latest.composite_score) - Number(prev.composite_score) : null;

  const live = d.certs.filter((c) => c.verification_status !== "rejected");
  const valid = live.filter((c) => c.expiry_status !== "expired").length;

  const monthPos = d.pos.filter((p) => p.po_date?.slice(0, 7) === month && p.status !== "cancelled");
  const byCcy = new Map<string, number>();
  monthPos.forEach((p) => byCcy.set(p.currency, (byCcy.get(p.currency) ?? 0) + Number(p.total_value)));
  const monthValue = [...byCcy.entries()].map(([c, v]) => money(v, c)).join(" + ");

  const recent = d.rfqs.filter((r) => (r.due_at ?? "").slice(0, 10) >= yearAgo);
  const quoted = recent.filter((r) => r.quote_status === "submitted").length;
  const won = d.pos.filter((p) => p.po_date >= yearAgo && p.status !== "cancelled").length;

  const next = d.reviews
    .map((r) => ({ date: r.meeting_date && r.meeting_date.slice(0, 10) >= today ? r.meeting_date : r.next_review_date, title: r.title }))
    .filter((r) => r.date && r.date.slice(0, 10) >= today)
    .sort((a, b) => a.date!.localeCompare(b.date!))[0];

  const decided = d.pushes.filter((p) => p.status === "accepted" || p.status === "declined");
  const accepted = decided.filter((p) => p.status === "accepted").length;
  const pending = d.pushes.filter((p) => p.status === "pending").length;

  return [
    { tier: "silver", feature: "Performance scorecard", icon: "monitoring", label: "SRM score", value: n0(latest?.composite_score),
      hint: latest ? `${latest.period}${delta !== null ? ` · ${delta >= 0 ? "up" : "down"} ${Math.abs(delta).toFixed(0)} on ${prev.period}` : ""}` : "Scores are recorded each quarter", href: "/vendor/performance" },
    { tier: "silver", feature: "Compliance tracker", icon: "verified", label: "Certificates in date", value: live.length ? `${valid} / ${live.length}` : "—",
      hint: live.length - valid > 0 ? `${live.length - valid} expired: renew to keep trading` : "Everything is in date", href: "/vendor/compliance" },
    { tier: "silver", feature: "Monthly reporting", icon: "calendar_month", label: "Orders this month", value: String(monthPos.length),
      hint: monthPos.length ? monthValue : "No purchase orders yet this month", href: "/vendor/orders" },
    { tier: "gold", feature: "Priority tender access", icon: "request_quote", label: "Quotes sent, last 12 months", value: recent.length ? `${quoted} / ${recent.length}` : "—",
      hint: `${won} order${won === 1 ? "" : "s"} won in the same period`, href: "/vendor/quotes" },
    { tier: "gold", feature: "Quarterly business review", icon: "groups", label: "Next business review", value: next ? formatDate(next.date) : "Not booked",
      hint: next ? next.title : "Your account manager will propose a date", href: "/vendor/reviews" },
    { tier: "platinum", feature: "Impact Grade certification support", icon: "eco", label: "Sustainability score", value: n0(latest?.sustainability_score),
      hint: "From your SRM scorecard; feeds Impact Grade on the specs you supply", href: "/vendor/performance" },
    { tier: "platinum", feature: "NTI leakage reporting", icon: "query_stats", label: "NTI leakage", value: "In your report",
      hint: "Reported in your monthly pack while the live view is built", href: "/vendor/performance" },
    { tier: "diamond", feature: "First-look opportunities", icon: "price_check", label: "Pushed prices", value: decided.length ? `${Math.round((accepted / decided.length) * 100)}% accepted` : "—",
      hint: pending ? `${pending} waiting for you to confirm` : "We offer you work at a stated price before it goes to tender", href: "/vendor/pushed-prices" },
  ];
}

export function SubscriptionInsights({ data }: { data: InsightData }) {
  const rank = data.active && data.tier && data.tier in RANK ? RANK[data.tier as Tier] : 0;
  const items = build(data);
  const unlocked = items.filter((i) => RANK[i.tier] <= rank).length;
  return (
    <Panel title="Your SRM insights" sub={rank ? `${tierName(data.tier)} plan · ${unlocked} of ${items.length} insights included` : "Choose a plan to see your SRM insights"}
      actions={<Link href="/vendor/subscription" className="text-sm font-semibold text-accent hover:underline">{rank === 4 ? "Your plan" : "Compare plans"}</Link>}>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((i) => {
          const open = RANK[i.tier] <= rank;
          const t = SUBSCRIPTION_TIERS.find((x) => x.key === i.tier)!;
          return open ? (
            <Link key={i.feature} href={i.href} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 hover:bg-surface-2">
              <span className="flex items-center gap-2 text-xs text-muted"><MSymbol name={i.icon} size={16} className="text-accent" />{i.feature}</span>
              <span className="text-xs font-semibold">{i.label}</span>
              <span className="font-display text-xl font-bold tabular-nums">{i.value}</span>
              <span className="text-xs text-muted">{i.hint}</span>
            </Link>
          ) : (
            <Link key={i.feature} href="/vendor/subscription" className="flex flex-col gap-1 rounded-xl border border-dashed border-line bg-surface-2/60 p-4 text-muted hover:bg-surface-2">
              <span className="flex items-center gap-2 text-xs"><MSymbol name="lock" size={16} />{i.feature}</span>
              <span className="text-xs font-semibold">{i.label}</span>
              <span className="text-sm">Included in <b style={{ color: t.colour }}>{t.name}</b></span>
              <span className="text-xs">Upgrade to unlock</span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}
