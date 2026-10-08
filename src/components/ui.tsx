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
    <span title={title} className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-xs font-semibold", toneClass[tone])}>
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
  return <section className={clsx("rounded-md border border-line bg-surface", className)}>{children}</section>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[1.7rem] font-bold leading-tight">{title}</h1>
        {sub && <p className="mt-0.5 max-w-[70ch] text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export const btn = {
  primary: "inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-accent bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:brightness-110 disabled:opacity-60",
  secondary: "inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-muted disabled:opacity-60",
  danger: "inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-bad hover:border-bad disabled:opacity-60",
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
    <div className="flex max-w-[70ch] flex-col items-start gap-2 px-4 py-8 text-muted">
      <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
      {children}
    </div>
  );
}
