import { clsx } from "clsx";
import { Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { APPROVAL, BRIEF_STATUS, ECO_DIM_LABEL, ECO_TAG, type ApprovalStatus, type BriefStatus, type Eco, bundleEco } from "@/lib/briefing";

export function BriefStatusPill({ status }: { status: BriefStatus }) {
  const s = BRIEF_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function ApprovalPill({ status }: { status: ApprovalStatus | null }) {
  if (!status) return null;
  const s = APPROVAL[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

/** Marks AI output as a creative suggestion: dashed and italic, so it never looks like a measured figure. */
export function CreativeSuggestionLabel({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border border-dashed border-warn/60 bg-warn-soft px-2 py-0.5 text-[0.7rem] font-semibold italic text-warn", className)}>
      <MSymbol name="auto_awesome" size={13} /> Creative suggestion · not data-verified
    </span>
  );
}

export function DemoNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-info/50 bg-info-soft px-3 py-2 text-sm text-info" role="note">
      <MSymbol name="science" size={18} className="mt-0.5" />
      <p><b>Demo suggestions — no AI key configured.</b> These concepts are built by simple rules from the brief and the approved substrate library so the flow can be tried offline. Set <code>ANTHROPIC_API_KEY</code> to use Claude.</p>
    </div>
  );
}

export function EcoTagInline({ eco }: { eco: Eco | null | undefined }) {
  if (!eco) return null;
  const t = ECO_TAG[eco.tag];
  return <Pill tone={t.tone} title="Indicative eco grade (AI estimate, not measured)"><MSymbol name="eco" size={13} /> {Math.round(eco.score)} · {t.label}</Pill>;
}

export function EcoGradeBadge({ eco }: { eco: Eco | null | undefined }) {
  if (!eco) return null;
  const dims = Object.entries(eco.dimensions).filter(([, v]) => v != null);
  return (
    <div className="space-y-1 rounded-lg border border-line bg-surface-2/70 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <MSymbol name="eco" size={15} className="text-ok" />
        <span className="eyebrow">Indicative eco grade</span>
        <span className="text-xs font-bold">{Math.round(eco.score)}/100</span>
        <EcoTagInline eco={eco} />
      </div>
      {dims.length > 0 && (
        <p className="flex flex-wrap gap-x-3 text-[0.7rem] text-muted">
          {dims.map(([k, v]) => <span key={k}>{ECO_DIM_LABEL[k] ?? k}: <b className="text-fg">{Math.round(v as number)}</b></span>)}
        </p>
      )}
      {eco.rationale && <p className="text-[0.7rem] leading-snug text-muted">{eco.rationale}</p>}
    </div>
  );
}

export function BundleEcoSummary({ ecos }: { ecos: (Eco | null)[] }) {
  const b = bundleEco(ecos);
  if (!b) return null;
  const t = ECO_TAG[b.tag];
  return (
    <div className="rounded-xl border border-ok/30 bg-ok-soft/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MSymbol name="eco" size={18} className="text-ok" />
        <span className="text-sm font-bold">Bundle eco footprint</span>
        <span className="text-xs text-muted">{b.count} selected</span>
        <span className="ml-auto flex items-baseline gap-1.5">
          <span className="font-display text-2xl font-bold tabular-nums">{Math.round(b.score)}</span>
          <span className="text-xs text-muted">/100</span>
          <Pill tone={t.tone}>{t.label}</Pill>
        </span>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
        {Object.entries(b.dimensions).map(([k, v]) => v != null && <span key={k}>Avg {ECO_DIM_LABEL[k]}: <b className="text-fg">{Math.round(v)}</b></span>)}
      </p>
      <p className="mt-1 text-[0.7rem] text-muted">Indicative average across the selected suggestions. Not a governed Impact Grade.</p>
    </div>
  );
}
