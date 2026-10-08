import Link from "next/link";
import { HORIZONTALS, MODULES, moduleByKey, type ModuleDef } from "@/modules/registry";
import { Card } from "@/components/ui";

/** Landing page for a module that isn't built yet: what it will do and where it sits in the flow. */
export function ModuleLanding({ m }: { m: ModuleDef }) {
  const Icon = m.icon;
  const i = MODULES.findIndex((x) => x.key === m.key);
  const assure = moduleByKey("assure");
  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4 py-8 md:px-8">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg" style={{ background: m.colour + "33", color: m.colour }}>
          <Icon size={26} aria-hidden />
        </span>
        <div>
          <p className="eyebrow">{m.phase} · coming next</p>
          <h1 className="font-display text-[1.9rem] font-bold leading-tight">{m.name}</h1>
          <p className="text-muted">{m.tagline}</p>
        </div>
      </div>

      <Card className="p-5">
        <h2 className="mb-2 font-display text-lg font-semibold">What it will do</h2>
        <ul className="list-disc space-y-1 pl-5">
          {m.scope.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 font-display text-lg font-semibold">Where it sits</h2>
        <p className="mb-4 text-muted">{m.flow}</p>
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {MODULES.filter((x) => !HORIZONTALS.includes(x.key)).map((x, n, arr) => (
            <li key={x.key} className="flex items-center gap-2">
              <Link
                href={x.basePath}
                className="rounded-full border px-3 py-1 font-semibold"
                style={x.key === m.key ? { background: x.colour, borderColor: x.colour, color: "#010062" } : { borderColor: x.colour }}
              >
                {x.name}
              </Link>
              {n < arr.length - 1 && <span aria-hidden className="text-muted">→</span>}
            </li>
          ))}
        </ol>
        {assure && (
          <Link href={assure.basePath} className="mt-2 block rounded-full border px-3 py-1 text-center text-sm font-semibold"
            style={{ borderColor: assure.colour, background: assure.colour + "1a" }}>
            {assure.name} runs under every stage: vendor eligibility, onboarding, scoring and the vendor portal
          </Link>
        )}
        <p className="mt-3 text-xs text-muted">Every module has its own Watchtower, rolled up into the master Watchtower. Region and market are recorded separately on every record.</p>
      </Card>

      <p className="text-sm text-muted">
        Module {i + 1} of {MODULES.length}. See <Link href="/watchtower" className="font-semibold text-accent underline">Watchtower</Link> for live status across the platform.
      </p>
    </main>
  );
}
