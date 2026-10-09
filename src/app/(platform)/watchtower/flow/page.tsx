import type { Metadata } from "next";
import { CONNECTIONS, SOURCING_HUB_FLOW } from "@/modules/flow";
import { EXTERNAL_REPORTING, LAYERS, PORTALS, moduleByKey } from "@/modules/registry";
import { Architecture } from "@/components/architecture";
import { MSymbol } from "@/components/symbol";
import { Card, PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "How the modules connect" };

// System Guy architecture and the handoffs that link the standalone modules into one workflow.
export default function FlowMap() {
  return (
    <>
      <PageHead
        crumbs={[{ label: "Watchtower", href: "/watchtower" }, { label: "How the modules connect" }]}
        title="How System Guy fits together"
        sub="Every module stands alone with its own Watchtower, governed by the master Watchtower. Data Management, Supplier Engagement, Sustainability and Internal Reporting run under every module. Clients and vendors come in through their own portals, with External Reporting tailored to each."
      />

      <Card className="p-5"><Architecture /></Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LAYERS.map((l) => (
          <Card key={l.key} className="overflow-hidden">
            <div className="h-1.5" style={{ background: l.colour }} />
            <div className="p-5">
              <h2 className="font-bold">{l.name}</h2>
              <p className="mt-1 text-sm text-muted">{l.summary}</p>
            </div>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {PORTALS.map((p) => (
          <Card key={p.key} className="flex gap-3 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: p.colour + "22", color: p.colour }}><MSymbol name={p.icon} size={22} /></span>
            <div><h2 className="font-bold">{p.name}</h2><p className="mt-1 text-sm text-muted">{p.summary}</p></div>
          </Card>
        ))}
        <Card className="overflow-hidden md:col-span-2">
          <div className="h-1.5" style={{ background: EXTERNAL_REPORTING.colour }} />
          <div className="p-5"><h2 className="font-bold">{EXTERNAL_REPORTING.name}</h2><p className="mt-1 text-sm text-muted">{EXTERNAL_REPORTING.summary}</p></div>
        </Card>
      </section>

      <Card className="overflow-x-auto">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="font-bold">Every handoff</h2>
          <p className="text-xs text-muted">What passes from one module to another. These links are what make standalone modules one workflow, and each is recorded so it can be audited and reported.</p>
        </div>
        <table className="w-full text-sm">
          <thead><tr><th className="th">From</th><th className="th"></th><th className="th">To</th><th className="th">What passes</th></tr></thead>
          <tbody>
            {CONNECTIONS.map((c, i) => {
              const f = moduleByKey(c.from)!, t = moduleByKey(c.to)!;
              return (
                <tr key={i}>
                  <td className="td"><span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: f.colour + "40" }}>{f.name}</span></td>
                  <td className="td w-8 text-muted"><MSymbol name="arrow_forward" size={16} /></td>
                  <td className="td"><span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: t.colour + "40" }}>{t.name}</span></td>
                  <td className="td">{c.what}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="font-bold">Sourcing Hub end to end: today and the Wave 2 target</h2>
          <p className="text-xs text-muted">The current Sourcing Hub process from job to local finance, and where each step lives in System Guy. Sourcing ends at estimate approval; Stocktool and NAV stay the finance records.</p>
        </div>
        <table className="w-full text-sm">
          <thead><tr><th className="th">#</th><th className="th">Step</th><th className="th">Today</th><th className="th">Target (Wave 2)</th><th className="th">Module</th></tr></thead>
          <tbody>
            {SOURCING_HUB_FLOW.map((s) => {
              const m = moduleByKey(s.module)!;
              return (
                <tr key={s.n} className="align-top">
                  <td className="td font-mono text-xs text-muted">{s.n}</td>
                  <td className="td font-semibold">{s.step}{s.vendor && <span className="ml-1.5 inline-flex align-middle text-brand-tech" title="Vendor engages here (vendor portal)"><MSymbol name="handshake" size={16} /></span>}</td>
                  <td className="td text-muted">{s.today}{s.pain && <span className="mt-1 block text-xs text-warn">Gap: {s.pain}</span>}</td>
                  <td className="td">{s.wave2}</td>
                  <td className="td"><span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: m.colour + "40" }}>{m.name}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
