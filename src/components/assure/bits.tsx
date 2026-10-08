import Link from "next/link";
import { clsx } from "clsx";
import { Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { optLabel, optTone, type Opt } from "@/lib/assure";
import { formatDate } from "@/lib/srt";

/** Pill coloured and labelled from an option list. */
export function OptPill({ list, value, title }: { list: Opt[]; value: string | null | undefined; title?: string }) {
  if (!value) return <span className="text-muted">—</span>;
  return <Pill tone={optTone(list, value)} title={title}>{optLabel(list, value)}</Pill>;
}

/** Link tabs driven by a query parameter. */
export function Tabs({ tabs, active, base, param = "tab", keep }: {
  tabs: { key: string; label: string; count?: number }[]; active: string; base: string; param?: string; keep?: Record<string, string | undefined>;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="Sections">
      {tabs.map((t) => {
        const q = new URLSearchParams(Object.entries({ ...keep, [param]: t.key }).filter(([, v]) => v) as [string, string][]);
        return (
          <Link key={t.key} href={`${base}?${q}`} aria-current={t.key === active ? "page" : undefined}
            className={clsx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", t.key === active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-xs">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Filter chips that set one query parameter, keeping the rest. */
export function Chips({ label, param, options, active, keep }: {
  label?: string; param: string; options: { value: string; label: string; count?: number }[]; active?: string; keep: Record<string, string | undefined>;
}) {
  const href = (v?: string) => {
    const q = new URLSearchParams(Object.entries({ ...keep, [param]: v }).filter(([, x]) => x) as [string, string][]);
    return `?${q}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {label && <span className="mr-1 text-muted">{label}</span>}
      {[{ value: "", label: "All" }, ...options].map((o) => (
        <Link key={o.value || "all"} href={href(o.value || undefined)}
          className={clsx("rounded-full border px-2.5 py-0.5", (active ?? "") === o.value ? "border-accent bg-accent-soft font-semibold" : "border-line hover:border-accent/40")}>
          {o.label}{o.count !== undefined && <span className="ml-1 text-muted">{o.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Bar({ value, tone = "accent" }: { value: number; tone?: "accent" | "ok" | "warn" | "bad" }) {
  const c = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${value}%`}>
      <span className={clsx("block h-full rounded-full", c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export function Score({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const v = Number(value);
  return <span className={clsx("font-semibold tabular-nums", v >= 80 ? "text-ok" : v >= 60 ? "text-warn" : "text-bad")}>{Math.round(v)}</span>;
}

/** Definition list of label/value pairs. */
export function Facts({ items, cols = 2 }: { items: [string, React.ReactNode][]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={clsx("grid gap-x-6 gap-y-3 text-sm", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{k}</dt>
          <dd className="mt-0.5 break-words">{v === null || v === undefined || v === "" ? <span className="text-muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export type CalEvent = { date: string; label: string; href?: string; tone: "ok" | "warn" | "bad" | "info" | "accent" | "neutral"; icon?: string };
const evTone = {
  ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent", neutral: "bg-surface-2 text-muted",
};

/** Month grid (Monday first) with up to 3 events per day and "+N more". */
export function MonthCalendar({ weeks, month, events }: { weeks: string[][]; month: string; events: CalEvent[] }) {
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-xs">
        <thead><tr>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <th key={d} className="th">{d}</th>)}</tr></thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w[0]}>
              {w.map((d) => {
                const ev = byDay.get(d) ?? [];
                return (
                  <td key={d} className={clsx("h-24 border border-line p-1 align-top", !d.startsWith(month) && "bg-surface-2/50 text-muted")}>
                    <div className={clsx("mb-1 font-semibold", d === today && "inline-block rounded-full bg-accent px-1.5 text-accent-fg")}>{Number(d.slice(8))}</div>
                    <div className="space-y-0.5">
                      {ev.slice(0, 3).map((e, i) => {
                        const inner = <span className={clsx("flex items-center gap-1 truncate rounded px-1 py-0.5", evTone[e.tone])} title={e.label}>{e.icon && <MSymbol name={e.icon} size={12} />}<span className="truncate">{e.label}</span></span>;
                        return e.href ? <Link key={i} href={e.href} className="block">{inner}</Link> : <div key={i}>{inner}</div>;
                      })}
                      {ev.length > 3 && <div className="text-muted">+{ev.length - 3} more</div>}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonthNav({ month, label, base }: { month: string; label: string; base: string }) {
  const [y, m] = month.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return (
    <div className="flex items-center gap-2 text-sm">
      <Link href={`${base}?month=${prev}`} className="rounded-lg border border-line px-2 py-1" aria-label="Previous month"><MSymbol name="chevron_left" size={18} /></Link>
      <Link href={base} className="rounded-lg border border-line px-2.5 py-1 font-semibold">Today</Link>
      <Link href={`${base}?month=${next}`} className="rounded-lg border border-line px-2 py-1" aria-label="Next month"><MSymbol name="chevron_right" size={18} /></Link>
      <span className="ml-2 font-display text-base font-bold">{label}</span>
    </div>
  );
}

export const Date_ = ({ d }: { d: string | null | undefined }) => (d ? <span className="whitespace-nowrap">{formatDate(d)}</span> : <span className="text-muted">—</span>);

export function SupplierLink({ id, name, tab }: { id: string; name: string | undefined; tab?: string }) {
  return <Link href={`/assure/suppliers/${id}${tab ? `?tab=${tab}` : ""}`} className="font-semibold hover:text-accent">{name ?? "Unknown supplier"}</Link>;
}
