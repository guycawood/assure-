import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHead, Panel, Pill, Stat } from "@/components/ui";
import type { Tone } from "@/lib/srt";
import snapshot from "@/lib/process/gbt-snapshot.json";
import { STATUS_LABEL, STEP_MAP, type StepStatus } from "@/lib/process/step-map";

export const metadata: Metadata = { title: "Process map" };

type Step = { id: string; type: string; lane: string; text: string; system: string | null; target: string | null };
type Process = { id: string; name: string; variant: string | null; lanes: Record<string, string>; steps: Step[] };
const processes = snapshot.processes as unknown as Process[];

const TONE: Record<StepStatus | "unassessed", Tone> = { built: "ok", partial: "warn", manual: "info", retired: "neutral", not_built: "bad", unassessed: "neutral" };
const keyOf = (p: Process, s: Step) => `${p.id}:${s.id}`;
// Decisions and end points are part of the flow, not work to build.
const isWork = (s: Step) => s.type !== "start" && s.type !== "end" && s.type !== "decision";

function counts(p: Process) {
  const c = { built: 0, partial: 0, manual: 0, retired: 0, not_built: 0, unassessed: 0, total: 0 };
  for (const s of p.steps) {
    if (!isWork(s) && !STEP_MAP[keyOf(p, s)]) continue;
    c.total++;
    c[STEP_MAP[keyOf(p, s)]?.status ?? "unassessed"]++;
  }
  return c;
}

export default async function ProcessMap({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const chosen = processes.find((x) => x.id === p) ?? null;
  const all = processes.map((x) => ({ x, c: counts(x) }));
  const total = all.reduce((n, r) => n + r.c.total, 0);
  const sum = (k: "built" | "partial" | "not_built" | "unassessed") => all.reduce((n, r) => n + r.c[k], 0);
  const known = new Set(processes.flatMap((x) => x.steps.map((s) => keyOf(x, s))));
  const stale = Object.keys(STEP_MAP).filter((k) => !known.has(k));

  return (
    <>
      <PageHead
        crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "Process map" }]}
        title="Process map"
        sub={`The global process and where System Guy does each step. Steps come from the Global Business Transformation artifact (snapshot ${snapshot.capturedAt}). A step is only marked built when the system does what the step says.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Steps to cover" value={total} hint={`${processes.length} processes`} />
        <Stat label="Built" value={sum("built")} tone="ok" />
        <Stat label="Partly built" value={sum("partial")} tone="warn" />
        <Stat label="Not built" value={sum("not_built")} tone="bad" hint="Assessed, a gap" />
        <Stat label="Not assessed yet" value={sum("unassessed")} hint="No decision made on these yet" />
      </div>

      {stale.length > 0 && (
        <Card className="border-warn/40 bg-warn-soft px-5 py-3 text-sm text-warn">
          {stale.length} mapped step{stale.length === 1 ? "" : "s"} no longer exist in the process snapshot: {stale.join(", ")}. Fix them in <code>src/lib/process/step-map.ts</code>.
        </Card>
      )}

      {!chosen ? (
        <Panel title="Processes" sub="Open one to see each step and where it is done.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase text-muted">
                <th className="px-5 py-2">Process</th><th className="px-3 py-2">Steps</th><th className="px-3 py-2">Built</th><th className="px-3 py-2">Partly</th><th className="px-3 py-2">Not built</th><th className="px-3 py-2">Not assessed</th><th className="px-5 py-2">Progress</th>
              </tr></thead>
              <tbody>
                {all.map(({ x, c }) => (
                  <tr key={x.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5"><Link className="font-semibold hover:underline" href={`/watchtower/process?p=${x.id}`}>{x.name}</Link>{x.variant && <span className="ml-2 text-xs text-muted">{x.variant}</span>}</td>
                    <td className="px-3 py-2.5">{c.total}</td><td className="px-3 py-2.5">{c.built}</td><td className="px-3 py-2.5">{c.partial}</td><td className="px-3 py-2.5">{c.not_built}</td><td className="px-3 py-2.5">{c.unassessed}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex h-2 w-40 overflow-hidden rounded-full bg-line" title={`${c.built} built, ${c.partial} partly`}>
                        <div className="bg-ok" style={{ width: `${c.total ? (c.built / c.total) * 100 : 0}%` }} />
                        <div className="bg-warn" style={{ width: `${c.total ? (c.partial / c.total) * 100 : 0}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <Panel title={chosen.name} sub={chosen.variant ?? undefined} actions={<Link href="/watchtower/process" className="text-sm font-semibold text-accent hover:underline">All processes</Link>}>
          {chosen.steps.length === 0 ? <p className="px-5 py-4 text-sm text-muted">This process has no steps in the snapshot yet.</p> : (
            <ul className="divide-y divide-line">
              {chosen.steps.map((s) => {
                const m = STEP_MAP[keyOf(chosen, s)];
                const status = m?.status ?? "unassessed";
                const flow = !isWork(s) && !m;
                return (
                  <li key={s.id} className="grid gap-2 px-5 py-3 text-sm md:grid-cols-[4.5rem_1fr_9rem]">
                    <span className="font-mono text-xs text-muted">{s.id}</span>
                    <div className="min-w-0">
                      <p className={flow ? "text-muted" : "font-medium"}>{s.text}{flow && <span className="ml-2 text-xs">({s.type === "decision" ? "decision" : s.type === "end" ? "end" : "start"})</span>}</p>
                      <p className="text-xs text-muted">{chosen.lanes[s.lane] ?? s.lane}{s.target ? ` · target: ${s.target}` : ""}</p>
                      {m?.note && <p className="mt-1 text-xs">{m.note}</p>}
                      {m && (m.at?.length || m.fn) && (
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          {m.at?.map((l) => <Link key={l.href} href={l.href} className="font-semibold text-accent hover:underline">{l.label}</Link>)}
                          {m.fn && <code className="rounded bg-line px-1.5 py-0.5">{m.fn}</code>}
                        </p>
                      )}
                    </div>
                    <div className="md:text-right">{!flow && <Pill tone={TONE[status]}>{STATUS_LABEL[status]}</Pill>}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}
