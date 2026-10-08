import Link from "next/link";
import { clsx } from "clsx";
import { Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { jobStatus, route as routeMeta, EVENT_LABEL, type SourcingEvent } from "@/lib/sourcing";
import type { Tone } from "@/lib/srt";

/** Link-based tabs (state lives in the URL so tabs survive refresh and are shareable). */
export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: { key: string; label: string; icon?: string; count?: number }[] }) {
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?tab=${t.key}`}
          aria-current={current === t.key ? "page" : undefined}
          className={clsx(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold",
            current === t.key ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.icon && <MSymbol name={t.icon} size={18} />}
          {t.label}
          {t.count != null && <span className="rounded-full bg-surface-2 px-1.5 text-[0.7rem] text-muted">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function JobStatusPill({ status }: { status: string }) {
  const s = jobStatus(status);
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function RoutePill({ route, confidence }: { route: string | null | undefined; confidence?: number | null }) {
  const r = routeMeta(route);
  if (!r) return <Pill>Not triaged</Pill>;
  return <Pill tone={r.tone} title={r.description}>{r.label}{confidence != null && route !== "create" ? ` · ${Math.round(Number(confidence) * 100)}%` : ""}</Pill>;
}

export function StatusPill({ meta, value }: { meta: Record<string, { label: string; tone: Tone }>; value: string }) {
  const m = meta[value] ?? { label: value, tone: "neutral" as Tone };
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

/** Key/value grid for detail pages. */
export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="eyebrow">{k}</dt>
          <dd className="mt-0.5 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ActivityList({ events, people }: { events: SourcingEvent[]; people: Map<string, string> }) {
  if (events.length === 0) return <p className="px-5 py-4 text-sm text-muted">Nothing recorded yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
          <span className="w-40 shrink-0 text-xs text-muted">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
          <span className="font-semibold capitalize">{e.entity}</span>
          <span>{EVENT_LABEL[e.event] ?? e.event.replace(/_/g, " ")}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted" title={describe(e.detail)}>{describe(e.detail)}</span>
          <span className="text-xs text-muted">{e.actor ? people.get(e.actor) ?? "Someone" : "System"}</span>
        </li>
      ))}
    </ol>
  );
}

function describe(d: Record<string, unknown>) {
  return Object.entries(d ?? {})
    .filter(([k, v]) => v != null && v !== "" && !["demo"].includes(k) && typeof v !== "object")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(" · ");
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={clsx("th", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={clsx("td", className)}>{children}</td>;
}

export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
