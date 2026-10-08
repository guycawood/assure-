import Link from "next/link";
import { clsx } from "clsx";
import {
  effectiveGateState,
  RAG_LABEL,
  TIER_LABEL,
  TIER_TONE,
  type GateDefinition,
  type Rag,
  type SupplierGate,
  type Tone,
} from "@/lib/srt";

const toneClass: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-surface-2 text-muted",
};

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.72rem] font-bold", toneClass[tone])}>
      {children}
    </span>
  );
}

export function RagDot({ rag }: { rag: Rag }) {
  return (
    <span
      title={RAG_LABEL[rag]}
      aria-label={RAG_LABEL[rag]}
      className={clsx("inline-block h-2.5 w-2.5 shrink-0 rounded-full", rag === "green" ? "bg-ok" : rag === "amber" ? "bg-warn" : "bg-bad")}
    />
  );
}

export function TierPill({ tier }: { tier: number | null }) {
  if (!tier) return <Pill tone="ok">Clear</Pill>;
  return (
    <Pill tone={TIER_TONE[tier]} title={TIER_LABEL[tier]}>
      T{tier}
    </Pill>
  );
}

const gateCell: Record<string, string> = {
  verified: "bg-ok border-ok",
  not_required: "bg-ok/40 border-ok/40",
  received: "bg-info border-info",
  requested: "bg-warn border-warn",
  rejected: "bg-bad-soft border-bad",
  expired: "bg-bad-soft border-bad",
  missing: "bg-surface-2 border-line",
};

/** One cell per onboarding gate, in gate order. Critical gaps show red. */
export function GateStrip({ defs, gates }: { defs: GateDefinition[]; gates: SupplierGate[] }) {
  const byKey = new Map(gates.map((g) => [g.gate_key, g]));
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label="Onboarding gate status">
      {defs.map((d) => {
        const g = byKey.get(d.key);
        const st = g ? effectiveGateState(g) : "missing";
        const cls = st === "missing" && d.critical ? "bg-bad-soft border-bad" : gateCell[st];
        return <i key={d.key} title={`${d.label}: ${st.replace("_", " ")}`} className={clsx("block h-4 w-2 rounded-sm border", cls)} />;
      })}
    </span>
  );
}

export function GateLegend() {
  const items: [string, string][] = [
    ["bg-ok border-ok", "Verified"],
    ["bg-info border-info", "Received, to check"],
    ["bg-warn border-warn", "Requested"],
    ["bg-bad-soft border-bad", "Critical gap, rejected or expired"],
    ["bg-surface-2 border-line", "Missing"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <i className={clsx("block h-3 w-2 rounded-sm border", c)} />
          {l}
        </span>
      ))}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={clsx("rounded-xl border border-line bg-surface shadow-card", className)}>{children}</section>;
}

/** Card with a titled header row (and optional actions on the right). */
export function Panel({ title, sub, actions, className, children }: { title: string; sub?: string; actions?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <Card className={clsx("min-w-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="font-display text-[0.95rem] font-bold">{title}</h2>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export type Crumb = { label: string; href?: string };

export function PageHead({ title, sub, crumbs, children }: { title: string; sub?: string; crumbs?: Crumb[]; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-1">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {c.href ? <Link href={c.href} className="hover:text-fg">{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <span aria-hidden className="text-line">/</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="font-display text-[1.6rem] font-bold leading-tight tracking-[-0.01em]">{title}</h1>
        {sub && <p className="mt-1 max-w-[75ch] text-[0.9rem] text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** KPI tile. tone colours the value; hint is the line under it. */
export function Stat({ label, value, hint, tone, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "ok" | "warn" | "bad"; icon?: React.ReactNode }) {
  return (
    <Card className="flex items-start gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="eyebrow">{label}</p>
        <p className={clsx("mt-1 font-display text-[1.75rem] font-bold leading-none tabular-nums", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</p>
        {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
      </div>
      {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</span>}
    </Card>
  );
}

export const btn = {
  primary: "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg shadow-sm transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50",
  secondary: "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-fg shadow-sm transition hover:border-accent/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 disabled:opacity-50",
  danger: "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-bad shadow-sm transition hover:border-bad/50 hover:bg-bad-soft disabled:opacity-50",
};

export function ButtonLink({ href, variant = "secondary", children }: { href: string; variant?: keyof typeof btn; children: React.ReactNode }) {
  return (
    <Link href={href} className={btn[variant]}>
      {children}
    </Link>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex max-w-[70ch] flex-col items-start gap-2 px-6 py-10 text-muted">
      <h2 className="font-display text-base font-bold text-fg">{title}</h2>
      {children}
    </div>
  );
}
