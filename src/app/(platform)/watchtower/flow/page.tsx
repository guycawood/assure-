import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ASSURE_TOUCHPOINTS, CONNECTIONS, PROCESS } from "@/modules/flow";
import { HORIZONTALS, MODULES, moduleByKey } from "@/modules/registry";
import { MSymbol } from "@/components/symbol";
import { Card, PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "How the modules connect" };

// Platform flow map: Watchtower over the top, the workflow modules left to right, Assure+ underneath every stage.
export default function FlowMap() {
  const flow = MODULES.filter((m) => !HORIZONTALS.includes(m.key));
  const wt = moduleByKey("watchtower")!;
  const as = moduleByKey("assure")!;
  const cols = { gridTemplateColumns: `repeat(${flow.length}, minmax(180px, 1fr))` };

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
      <PageHead
        crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "How the modules connect" }]}
        title="How the modules connect"
        sub="The workflow runs left to right from brief to shelf. Watchtower governs every module from above; Assure+ runs underneath every stage as the horizontal that decides who can do the work and gives vendors their portal."
      />

      <Card className="overflow-x-auto p-5">
        <div className="min-w-[1000px] space-y-3">
          {/* Watchtower band */}
          <Link href="/watchtower/about" className="block rounded-xl border px-4 py-2.5 text-center text-sm font-bold"
            style={{ borderColor: wt.colour, background: wt.colour + "26", color: "#010062" }}>
            Watchtower · health, rules, change requests and shared libraries for every module
          </Link>

          {/* Workflow stages */}
          <div className="grid gap-3" style={cols}>
            {flow.map((m, i) => {
              return (
                <div key={m.key} className="relative">
                  <Link href={`${m.basePath}/about`} className="flex h-full flex-col rounded-xl border-2 bg-surface p-3.5 transition hover:shadow-raised" style={{ borderColor: m.colour }}>
                    <span className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: m.colour + "33", color: m.colour }}><MSymbol name={m.icon} size={15} /></span>
                      <span className="font-bold">{m.name}</span>
                    </span>
                    <ol className="mt-2.5 space-y-1 text-xs text-muted">
                      {PROCESS[m.key].map((s, n) => <li key={s.step}><span className="font-bold text-fg/70">{n + 1}.</span> {s.step}</li>)}
                    </ol>
                  </Link>
                  {i < flow.length - 1 && (
                    <span className="absolute -right-3 top-1/2 z-10 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-muted shadow-card" aria-hidden>
                      <ArrowRight size={13} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Assure+ touchpoints under each stage */}
          <div className="grid gap-3" style={cols}>
            {flow.map((m) => (
              <div key={m.key} className="flex flex-col items-center">
                <span className="h-4 w-0.5" style={{ background: as.colour }} aria-hidden />
                <span className="w-full rounded-lg px-2.5 py-1.5 text-center text-[0.72rem] font-semibold" style={{ background: as.colour + "14", color: "#3b1a86" }}>
                  {ASSURE_TOUCHPOINTS[m.key]}
                </span>
              </div>
            ))}
          </div>
          <Link href="/assure/about" className="block rounded-xl px-4 py-2.5 text-center text-sm font-bold text-white" style={{ background: as.colour }}>
            Assure+ · internal supply chain management + external vendor portal, under every stage
          </Link>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="font-bold">Every handoff</h2>
          <p className="text-xs text-muted">What passes from one module to another. Each handoff is a recorded event, so it is auditable and reportable.</p>
        </div>
        <table className="w-full text-sm">
          <thead><tr><th className="th">From</th><th className="th"></th><th className="th">To</th><th className="th">What passes</th></tr></thead>
          <tbody>
            {CONNECTIONS.map((c, i) => {
              const f = moduleByKey(c.from)!, t = moduleByKey(c.to)!;
              return (
                <tr key={i}>
                  <td className="td"><span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: f.colour + "33" }}>{f.name}</span></td>
                  <td className="td w-8 text-muted"><ArrowRight size={14} aria-hidden /></td>
                  <td className="td"><span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: t.colour + "33" }}>{t.name}</span></td>
                  <td className="td">{c.what}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
