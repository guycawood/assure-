import Link from "next/link";
import { clsx } from "clsx";
import { Pill } from "@/components/ui";
import { NPS_TONE, RAG, STAGE, npsGroup, type LibOption, type MarketOption, type Person, type Rag } from "@/lib/crm";

// Small CRM building blocks (server components). Forms use ActionForm from components/sourcing/action-form.

export function RagPill({ rag, title }: { rag: Rag; title?: string }) {
  const r = RAG[rag] ?? RAG.green;
  return (
    <Pill tone={r.tone} title={title}>
      <span className={clsx("inline-block h-2 w-2 rounded-full", rag === "green" ? "bg-ok" : rag === "amber" ? "bg-warn" : "bg-bad")} aria-hidden />
      {r.label}
    </Pill>
  );
}

export function StagePill({ stage }: { stage: string }) {
  const s = STAGE[stage] ?? { label: stage, tone: "neutral" as const };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function ScorePill({ score }: { score: number }) {
  return <Pill tone={NPS_TONE[npsGroup(score)]} title={npsGroup(score)}>{score}/10</Pill>;
}

export function ClientLink({ id, name }: { id: string; name: string }) {
  return <Link href={`/crm/clients/${id}`} className="font-semibold hover:underline">{name}</Link>;
}

type Opt = { value: string; label: string };

export function Select({ name, options, value, empty, required, label, className }: {
  name: string; options: Opt[]; value?: string | null; empty?: string; required?: boolean; label: string; className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      <select name={name} defaultValue={value ?? ""} required={required} className="input">
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Input({ name, label, type = "text", value, required, placeholder, className, step }: {
  name: string; label: string; type?: string; value?: string | number | null; required?: boolean; placeholder?: string; className?: string; step?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      <input name={name} type={type} defaultValue={value ?? ""} required={required} placeholder={placeholder} step={step} className="input" />
    </label>
  );
}

export function TextArea({ name, label, value, rows = 3, placeholder, className, required }: {
  name: string; label: string; value?: string | null; rows?: number; placeholder?: string; className?: string; required?: boolean;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      <textarea name={name} defaultValue={value ?? ""} rows={rows} placeholder={placeholder} required={required} className="input" />
    </label>
  );
}

export const peopleOptions = (people: Person[]): Opt[] => people.map((p) => ({ value: p.id, label: p.name }));
export const libOptions = (lib: LibOption[]): Opt[] => lib.map((l) => ({ value: l.id, label: l.name }));
export const marketOptions = (markets: MarketOption[]): Opt[] => markets.map((m) => ({ value: m.code, label: `${m.name} (${m.code})` }));
export const clientOptions = (clients: { id: string; name: string }[]): Opt[] => clients.map((c) => ({ value: c.id, label: c.name }));

/** Collapsible form panel ("Add ..."), so lists stay readable. */
export function Disclosure({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="rounded-xl border border-line bg-surface shadow-card" open={open}>
      <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-accent">{summary}</summary>
      <div className="border-t border-line px-5 py-4">{children}</div>
    </details>
  );
}

/** Horizontal bars (label, value, share of max). */
export function Bars({ rows }: { rows: { label: string; value: number; text: string; tone?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2 px-5 py-4">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2.5 rounded-full bg-surface-2">
            <span className={clsx("block h-2.5 rounded-full", r.tone ?? "bg-accent")} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="tabular-nums font-semibold">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
