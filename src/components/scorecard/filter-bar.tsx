import Link from "next/link";
import { clsx } from "clsx";
import { btn } from "@/components/ui";
import { ROUTES, hrefWith, toggleRoute, type Options, type ScorecardParams } from "@/lib/scorecard-reporting";

/**
 * The same filters on every scorecard page: AAC route toggle (links) plus business unit, market, brand and date range
 * (a GET form, so the filters live in the URL and survive refresh). `keep` holds fixed params (tab, preview).
 */
export function FilterBar({ base, params, options, keep = {}, clients }: {
  base: string; params: ScorecardParams; options: Options | null; keep?: Record<string, string | null | undefined>;
  clients?: { id: string; name: string }[];
}) {
  const sel = new Set((params.routes ?? "").split(",").filter(Boolean));
  const allOn = sel.size === 0;
  const anyFilter = !!(params.routes || params.bu || params.market || params.brand || params.from || params.to || params.client);
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <div>
        <p className="label">AAC route</p>
        <div className="inline-flex overflow-hidden rounded-lg border border-line" role="group" aria-label="AAC route">
          {ROUTES.map((r) => {
            const on = allOn || sel.has(r.key);
            return (
              <Link key={r.key} href={hrefWith(base, params, { routes: toggleRoute(allOn ? ROUTES.map((x) => x.key).join(",") : params.routes, r.key) }, keep)}
                aria-pressed={on} className={clsx("px-3 py-1.5 text-xs font-bold uppercase tracking-wide", on ? "text-white" : "bg-surface text-muted hover:text-fg")}
                style={on ? { background: r.color } : undefined}>
                {r.label}
              </Link>
            );
          })}
        </div>
      </div>
      <form action={base} method="get" className="flex flex-1 flex-wrap items-end gap-3">
        {Object.entries(keep).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
        {params.view && <input type="hidden" name="view" value={params.view} />}
        {params.kpi && <input type="hidden" name="kpi" value={params.kpi} />}
        {params.routes && <input type="hidden" name="routes" value={params.routes} />}
        {clients && (
          <Sel name="client" label="Client" value={params.client} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        )}
        <Sel name="bu" label="Business unit" value={params.bu} options={(options?.business_units ?? []).map((b) => ({ value: b, label: b }))} />
        <Sel name="market" label="Market" value={params.market} options={(options?.markets ?? []).map((m) => ({ value: m.code, label: m.name ?? m.code }))} />
        <Sel name="brand" label="Brand" value={params.brand} options={(options?.brands ?? []).map((b) => ({ value: b, label: b }))} />
        <div>
          <label className="label" htmlFor="sc-from">From</label>
          <input id="sc-from" name="from" type="month" className="input w-36" defaultValue={params.from?.slice(0, 7) ?? ""} min={options?.months?.first ?? undefined} max={options?.months?.last ?? undefined} />
        </div>
        <div>
          <label className="label" htmlFor="sc-to">To</label>
          <input id="sc-to" name="to" type="month" className="input w-36" defaultValue={params.to?.slice(0, 7) ?? ""} min={options?.months?.first ?? undefined} max={options?.months?.last ?? undefined} />
        </div>
        <button type="submit" className={btn.primary}>Apply</button>
        {anyFilter && <Link href={hrefWith(base, { view: params.view, kpi: params.kpi }, {}, keep)} className={btn.secondary}>Clear</Link>}
      </form>
    </div>
  );
}

function Sel({ name, label, value, options }: { name: string; label: string; value?: string; options: { value: string; label: string }[] }) {
  return (
    <div className="min-w-[9rem]">
      <label className="label" htmlFor={`sc-${name}`}>{label}</label>
      <select id={`sc-${name}`} name={name} className="input" defaultValue={value ?? ""}>
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
