import Link from "next/link";
import { ArrowRight, Check, CircleDashed } from "lucide-react";
import { ABOUT } from "@/modules/about";
import { PROCESS } from "@/modules/flow";
import { HORIZONTALS, MODULES, moduleByKey, type ModuleKey } from "@/modules/registry";
import { MSymbol } from "@/components/symbol";
import { Card, PageHead, Pill } from "@/components/ui";

/** "About this module": the same layout for every module, from src/modules/about.ts. */
export function ModuleAboutPage({ moduleKey, standalone }: { moduleKey: ModuleKey; standalone?: boolean }) {
  const m = moduleByKey(moduleKey)!;
  const a = ABOUT[moduleKey];
  const flow = MODULES.filter((x) => !HORIZONTALS.includes(x.key));

  const body = (
    <>
      <PageHead crumbs={[{ label: m.name, href: m.basePath }, { label: "About" }]} title={`About ${m.name}`} />

      {/* Hero */}
      <Card className="relative overflow-hidden p-0">
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: m.colour }} aria-hidden />
        <div className="flex flex-col gap-5 p-7 pl-9 md:flex-row md:items-center">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: m.colour + "26", color: m.colour }}>
            <MSymbol name={m.icon} size={28} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{m.tagline} · {m.status === "live" ? "Live" : m.phase}</p>
            <h2 className="mt-1 text-[1.45rem] font-bold leading-snug tracking-[-0.01em]">{a.headline}</h2>
            <p className="mt-2 max-w-[80ch] text-muted">{a.summary}</p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold">Process flow</h3>
          <Link href="/watchtower/flow" className="text-sm font-semibold text-accent hover:underline">See how all modules connect →</Link>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PROCESS[moduleKey].map((s, i) => {
            const h = s.handoff ? moduleByKey(s.handoff) : null;
            return (
              <li key={s.step} className="relative flex flex-col rounded-xl border border-line bg-surface-2/60 p-3.5">
                <span className="mb-2 grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white" style={{ background: m.colour }}>{i + 1}</span>
                <p className="font-semibold leading-snug">{s.step}</p>
                <p className="mt-1 text-sm text-muted">{s.detail}</p>
                {h && (
                  <Link href={`${h.basePath}/about`} className="mt-auto inline-flex w-fit items-center gap-1 pt-2.5 text-xs font-bold" style={{ color: "#010062" }}>
                    <span className="rounded-full px-2 py-0.5" style={{ background: h.colour + "33" }}>↔ {h.name}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      {a.pillars && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {a.pillars.map((p) => (
            <Card key={p.title} className="p-4">
              <p className="font-bold" style={{ color: m.colour }}>{p.title}</p>
              <p className="mt-1 text-sm text-muted">{p.body}</p>
            </Card>
          ))}
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-5">
          <h3 className="mb-3 font-bold">What it does</h3>
          <ul className="divide-y divide-line">
            {a.functions.map((f) => (
              <li key={f.title} className="flex items-start gap-3 py-2.5">
                {f.status === "live"
                  ? <Check size={16} className="mt-0.5 shrink-0 text-ok" aria-label="Live" />
                  : <CircleDashed size={16} className="mt-0.5 shrink-0 text-muted" aria-label="Planned" />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{f.title}</p>
                  <p className="text-sm text-muted">{f.body}</p>
                </div>
                <Pill tone={f.status === "live" ? "ok" : "neutral"}>{f.status === "live" ? "Live" : "Planned"}</Pill>
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h3 className="mb-2 font-bold">Who uses it</h3>
            <ul className="flex flex-wrap gap-1.5">{a.who.map((w) => <li key={w} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold">{w}</li>)}</ul>
          </Card>
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <h3 className="mb-1.5 font-bold">Takes in</h3>
              <ul className="space-y-1 text-sm text-muted">{a.inputs.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <h3 className="mb-1.5 font-bold">Hands on</h3>
              <ul className="space-y-1 text-sm text-muted">{a.outputs.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </Card>
        </div>
      </section>

      {a.lifecycle && (
        <Card className="p-5">
          <h3 className="mb-3 font-bold">The vendor lifecycle</h3>
          <ol className="flex flex-wrap items-center gap-2">
            {a.lifecycle.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: m.colour, opacity: 0.55 + i * 0.15 }}>{s}</span>
                {i < a.lifecycle!.length - 1 && <ArrowRight size={16} className="text-muted" aria-hidden />}
              </li>
            ))}
          </ol>
          {a.promise && a.value && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><p className="eyebrow mb-1.5">Our promise</p><ul className="space-y-1 text-sm">{a.promise.map((x) => <li key={x}>{x}</li>)}</ul></div>
              <div><p className="eyebrow mb-1.5">Your value</p><ul className="space-y-1 text-sm">{a.value.map((x) => <li key={x}>{x}</li>)}</ul></div>
            </div>
          )}
        </Card>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="p-5"><p className="eyebrow mb-1.5" style={{ color: "#3f8f76" }}>Sustainability</p><p className="text-sm">{a.sustainability}</p></Card>
        <Card className="p-5"><p className="eyebrow mb-1.5" style={{ color: "#c8243a" }}>Data</p><p className="text-sm">{a.data}</p></Card>
        <Card className="p-5"><p className="eyebrow mb-1.5" style={{ color: "#2f6fb5" }}>Governance</p><p className="text-sm">{a.governance}</p></Card>
      </section>

      <Card className="p-5">
        <h3 className="mb-1 font-bold">Where it sits</h3>
        <p className="mb-4 text-sm text-muted">{m.flow}</p>
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {flow.map((x, n) => (
            <li key={x.key} className="flex items-center gap-2">
              <Link href={`${x.basePath}/about`} className="rounded-full border px-3 py-1 font-semibold transition hover:shadow-card"
                style={x.key === m.key ? { background: x.colour, borderColor: x.colour, color: "#010062" } : { borderColor: x.colour }}>
                {x.name}
              </Link>
              {n < flow.length - 1 && <ArrowRight size={14} className="text-muted" aria-hidden />}
            </li>
          ))}
        </ol>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {HORIZONTALS.map((k) => moduleByKey(k)!).map((h) => (
            <Link key={h.key} href={`${h.basePath}/about`} className="rounded-lg border px-3 py-1.5 text-center text-sm font-semibold transition hover:shadow-card"
              style={{ borderColor: h.colour, background: h.key === m.key ? h.colour : h.colour + "1a", color: "#010062" }}>
              {h.name} · across every stage
            </Link>
          ))}
        </div>
      </Card>
    </>
  );

  return standalone ? <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">{body}</div> : body;
}
