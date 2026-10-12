import type { Metadata } from "next";
import Link from "next/link";
import { JOURNEY, LANES, type Lane } from "@/modules/journey";
import { moduleByKey } from "@/modules/registry";
import { DEMO_USERS, isDemoMode } from "@/lib/demo/config";
import { Card, PageHead } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "End-to-end journey" };

// The whole process, campaign to payment, as a walk-through: who acts, where the approval gates are, and a link to
// open each step in the demo as the right person.
export default function Journey() {
  const demo = isDemoMode();
  const all = JOURNEY.flatMap((s) => s.steps);
  const count = (l: Lane) => all.filter((s) => s.lane === l).length;
  let n = 0;
  return (
    <>
      <PageHead crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "End-to-end journey" }]} title="End-to-end journey"
        sub="Every step from campaign to payment, who does it, and where approvals sit. Open any step in the demo to try it as that person." />

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 text-sm">
        {(Object.keys(LANES) as Lane[]).map((l) => (
          <span key={l} className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: LANES[l].colour }} />{LANES[l].label} <span className="text-muted">({count(l)})</span></span>
        ))}
        <span className="inline-flex items-center gap-1.5"><MSymbol name="verified_user" size={18} className="text-accent" /> Approval gate ({all.filter((s) => s.gate).length})</span>
        <span className="inline-flex items-center gap-1.5"><span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn">Being built</span> ({all.filter((s) => s.planned).length})</span>
        <Link href="/watchtower/flow" className="ml-auto font-semibold text-accent hover:underline">How the modules connect</Link>
      </Card>

      {JOURNEY.map((stage) => (
        <Card key={stage.key} className="overflow-x-auto">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="font-bold">{stage.title}</h2>
            <p className="text-xs text-muted">{stage.summary}</p>
          </div>
          <table className="w-full min-w-[56rem] text-sm">
            <thead><tr><th className="th w-10">#</th><th className="th">Who</th><th className="th">Step</th><th className="th">Approval</th><th className="th">Module</th><th className="th text-right">Try it</th></tr></thead>
            <tbody>
              {stage.steps.map((s) => {
                n += 1;
                const m = moduleByKey(s.module);
                const person = DEMO_USERS.find((u) => u.id === s.as);
                return (
                  <tr key={s.step} className="align-top">
                    <td className="td font-mono text-xs text-muted">{n}</td>
                    <td className="td"><span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: LANES[s.lane].colour + "40" }}>{LANES[s.lane].label}</span></td>
                    <td className="td"><span className="font-semibold">{s.step}</span>{s.planned && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[0.68rem] font-bold text-warn">Being built</span>}
                      <span className="block text-xs text-muted">{s.detail}</span></td>
                    <td className="td text-xs">{s.gate ? <span className="inline-flex items-start gap-1.5"><MSymbol name="verified_user" size={16} className="mt-px shrink-0 text-accent" />{s.gate}</span> : <span className="text-muted">—</span>}</td>
                    <td className="td">{m && <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: m.colour + "40" }}>{m.name}</span>}</td>
                    <td className="td whitespace-nowrap text-right text-xs">
                      {demo && person
                        ? <a href={`/auth/demo?user=${person.id}&next=${encodeURIComponent(s.href)}`} className="font-semibold text-accent hover:underline" title="Signs you in as this demo person and opens the screen">Open as {person.name.split(" (")[0]}</a>
                        : <Link href={s.href} className="font-semibold text-accent hover:underline">Open</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ))}
    </>
  );
}
