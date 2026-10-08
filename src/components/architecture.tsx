import Link from "next/link";
import { EXTERNAL_REPORTING, HORIZONTALS, LAYERS, MODULES, PORTALS, type ModuleKey } from "@/modules/registry";
import { MSymbol } from "@/components/symbol";

const text = (c: string) => (c === "#9DC5ED" || c === "#97DBD9" || c === "#78C7AE" || c === "#FFB05B" ? "#010062" : "#ffffff");

/**
 * The System Guy architecture (Guy's diagram): master Watchtower over a Watchtower per module, the module row,
 * Data Management / Supplier Engagement / Sustainability layers under every module, and the Client and Vendor portals.
 */
export function Architecture({ highlight, compact }: { highlight?: ModuleKey; compact?: boolean }) {
  const mods = MODULES.filter((m) => !HORIZONTALS.includes(m.key));
  const cols = { gridTemplateColumns: `repeat(${mods.length}, minmax(${compact ? 92 : 108}px, 1fr))` };
  const dim = (k: ModuleKey) => (highlight && highlight !== k ? "opacity-45 hover:opacity-100" : "");

  return (
    <div className="overflow-x-auto">
      <div className={`mx-auto space-y-2.5 ${compact ? "min-w-[920px]" : "min-w-[1040px]"}`}>
        <Link href="/watchtower" className={`mx-auto flex max-w-xl flex-col items-center rounded-xl bg-brand-navy px-6 py-3 text-center text-white transition hover:shadow-raised ${highlight && highlight !== "watchtower" ? "opacity-80" : ""}`}>
          <span className="flex items-center gap-2 font-bold"><MSymbol name="cell_tower" size={18} /> Watchtower</span>
          <span className="text-xs text-white/70">All users, libraries and methodology for every module</span>
        </Link>

        <div className="grid gap-2" style={cols}>
          {mods.map((m) => (
            <Link key={m.key} href={`${m.basePath}/watchtower`} title={`${m.name} Watchtower`}
              className={`flex items-center justify-center gap-1 rounded-lg border border-brand-navy/30 bg-brand-navy/[0.06] px-1.5 py-2 text-center text-[0.68rem] font-bold uppercase tracking-wide text-brand-navy transition hover:bg-brand-navy/10 ${dim(m.key)}`}>
              <MSymbol name="cell_tower" size={13} /> Watchtower
            </Link>
          ))}
        </div>

        <div className="grid gap-2" style={cols}>
          {mods.map((m) => (
            <Link key={m.key} href={`${m.basePath}/about`}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-3 text-center transition hover:shadow-raised ${dim(m.key)} ${highlight === m.key ? "ring-2 ring-brand-navy ring-offset-2" : ""}`}
              style={{ background: m.colour, color: text(m.colour) }}>
              <MSymbol name={m.icon} size={20} />
              <span className="text-[0.75rem] font-extrabold leading-tight">{m.name}</span>
              {m.status === "planned" && <span className="text-[0.58rem] font-bold uppercase opacity-80">{m.phase}</span>}
            </Link>
          ))}
        </div>

        {LAYERS.map((l) => (
          <Link key={l.key} href={l.href} className="group relative block rounded-lg px-4 py-2 text-center text-sm font-bold uppercase tracking-[0.12em] transition hover:shadow-raised" style={{ background: l.colour, color: text(l.colour) }}>
            {l.name}
            {l.key === "supplier" && <span className="ml-2 text-[0.62rem] font-semibold normal-case tracking-normal opacity-80">· vendors engage at these points</span>}
            {(!compact || l.key === "supplier") && (
              <div className="mt-1.5 grid gap-2 text-[0.62rem] font-semibold normal-case tracking-normal" style={cols}>
                {mods.map((m) => l.touches[m.key]
                  ? <span key={m.key} className="flex items-center justify-center gap-1 rounded bg-white/15 px-1 py-0.5 leading-tight">{l.key === "supplier" && <MSymbol name="handshake" size={12} />}{compact ? "" : l.touches[m.key]}</span>
                  : <span key={m.key} />)}
              </div>
            )}
          </Link>
        ))}

        <div className="grid grid-cols-2 gap-6 pt-3">
          {PORTALS.map((p) => (
            <Link key={p.key} href={p.href} className="mx-auto flex w-full max-w-xs items-center gap-3 rounded-xl border-2 bg-surface px-4 py-3 transition hover:shadow-raised" style={{ borderColor: p.colour }}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: p.colour + "22", color: p.colour }}><MSymbol name={p.icon} size={20} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-extrabold text-brand-navy">{p.name}</span>
                <span className="block text-[0.7rem] text-muted">{p.status === "live" ? "Live" : "Planned"} · external</span>
              </span>
            </Link>
          ))}
        </div>

        <div className="rounded-lg px-4 py-2 text-center text-sm font-bold uppercase tracking-[0.12em] text-white" style={{ background: EXTERNAL_REPORTING.colour }}>
          {EXTERNAL_REPORTING.name}
          {!compact && <span className="mt-1 block text-[0.66rem] font-semibold normal-case tracking-normal text-white/75">Clients and vendors each see only their own reports</span>}
        </div>
      </div>
    </div>
  );
}
