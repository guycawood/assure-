import { clsx } from "clsx";
import { Panel } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { formatDate } from "@/lib/srt";
import type { Brief, BriefEvent, BriefRevision } from "@/lib/briefing";

const when = (iso: string | null | undefined) => (iso ? `${formatDate(iso.slice(0, 10))}, ${new Date(iso).toISOString().slice(11, 16)}` : "");

const STAGES = [
  { key: "draft", label: "Drafted", icon: "edit_note" },
  { key: "submitted", label: "Submitted", icon: "send" },
  { key: "in_ideation", label: "Approved, in ideation", icon: "auto_awesome" },
  { key: "spec_created", label: "Spec created in Sourcing+", icon: "note_add" },
];
const ORDER = STAGES.map((s) => s.key);

export function ProgressTimeline({ brief, events, name }: { brief: Brief; events: BriefEvent[]; name: (id: string | null) => string }) {
  const archived = brief.status === "archived";
  const lastLive = [...events].reverse().find((e) => e.to_status && e.to_status !== "archived")?.to_status ?? "draft";
  const reached = archived ? Math.max(0, ORDER.indexOf(lastLive)) : Math.max(0, ORDER.indexOf(brief.status));
  const dateFor = (k: string) => {
    const ev = [...events].reverse().find((e) => (k === "draft" ? e.event === "created" : e.to_status === k && e.event !== "revised"));
    return ev ? `${when(ev.at)} · ${name(ev.actor)}` : null;
  };
  return (
    <Panel title="Progress" actions={archived ? <span className="flex items-center gap-1 text-xs text-muted"><MSymbol name="archive" size={15} /> Archived</span> : undefined}>
      <ol className="space-y-1 p-5">
        {STAGES.map((s, i) => {
          const done = i <= reached;
          const current = !archived && i === reached;
          const date = done ? dateFor(s.key) : null;
          return (
            <li key={s.key} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <span className={clsx("grid h-7 w-7 place-items-center rounded-full border-2", done ? "border-accent bg-accent text-accent-fg" : "border-line text-muted")}>
                  <MSymbol name={done && !current ? "check" : s.icon} size={15} />
                </span>
                {i < STAGES.length - 1 && <span className={clsx("mt-1 min-h-[16px] w-0.5 grow", i < reached ? "bg-accent" : "bg-line")} />}
              </div>
              <div className="pb-3 pt-1">
                <p className={clsx("text-sm font-semibold", !done && "text-muted")}>{s.label} {current && <span className="ml-1 text-[0.65rem] font-bold uppercase tracking-wide text-accent">Current</span>}</p>
                <p className="text-xs text-muted">{date ?? (done ? "Reached" : "Pending")}</p>
                {s.key === "submitted" && brief.approval_status && done && (
                  <p className={clsx("text-xs font-semibold", brief.approval_status === "approved" ? "text-ok" : brief.approval_status === "changes_requested" ? "text-bad" : "text-warn")}>
                    {brief.approval_status === "approved" ? "Approved" : brief.approval_status === "changes_requested" ? "Changes requested" : "Awaiting review"}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

const trunc = (s: string | null | undefined, n = 90) => (!s ? "(empty)" : s.length > n ? s.slice(0, n) + "…" : s);

export function RevisionHistory({ revisions, name }: { revisions: BriefRevision[]; name: (id: string | null) => string }) {
  if (!revisions.length) return null;
  return (
    <Panel title="Version history" sub={`${revisions.length} revision${revisions.length === 1 ? "" : "s"} after submission. Append-only: earlier versions are never lost.`}>
      <ol className="space-y-4 p-5">
        {[...revisions].reverse().map((r) => (
          <li key={r.id} className="space-y-1.5 border-l-2 border-line pl-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span><b className="text-accent">v{r.version}</b> · <b>{name(r.revised_by)}</b></span>
              <span className="text-muted">{when(r.revised_at)}</span>
            </div>
            <ul className="space-y-1">
              {r.changes.map((c, j) => (
                <li key={j} className="text-xs leading-relaxed">
                  <b>{c.field}:</b> <span className="text-muted line-through">{trunc(c.before)}</span> <span className="text-muted">→</span> <span>{trunc(c.after)}</span>
                </li>
              ))}
            </ul>
            <details className="group">
              <summary className="cursor-pointer select-none text-xs font-semibold text-accent hover:underline">View the version before this change</summary>
              <dl className="mt-2 grid gap-x-4 gap-y-1.5 rounded-lg border border-line bg-surface-2/60 p-3 sm:grid-cols-2">
                {r.previous_version.map((f) => (
                  <div key={f.field} className="text-xs">
                    <dt className="eyebrow">{f.field}</dt>
                    <dd className="whitespace-pre-wrap break-words text-muted">{trunc(f.value, 160)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
