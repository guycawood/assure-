import Link from "next/link";
import { Panel } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { fmtPct, type WhatWorked } from "@/lib/shopper-iq";

/** Shopper IQ insight shown where briefs are written: which touchpoints executed best for this brand / client before. */
export function WhatWorkedPanel({ items, brand, client }: { items: WhatWorked[]; brand?: string | null; client?: string | null }) {
  const scope = items[0]?.scope;
  const who = scope === "brand" ? brand : scope === "client" ? client : "all clients";
  return (
    <Panel title="What worked before" sub={items.length ? `From Shopper IQ, for ${who}. Execution scores are in-store assessments; uplift only where a source is named.` : "From Shopper IQ"}
      actions={<Link href="/shopper-iq/insights" className="text-xs font-semibold text-accent hover:underline">Shopper IQ →</Link>}>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">No effectiveness records yet for this client or brand.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((w) => (
            <li key={w.touchpoint} className="flex items-start gap-3 px-5 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#EE4E621f] text-[#c8243a]"><MSymbol name="insights" size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{w.touchpoint}{w.p2pStage ? <span className="font-normal text-muted"> · {w.p2pStage}</span> : null}</p>
                <p className="text-xs text-muted">{w.examples.join(" · ")}</p>
              </div>
              <div className="text-right text-xs">
                <p><b className="text-sm tabular-nums">{Math.round(w.avgScore)}</b><span className="text-muted">/100</span></p>
                {w.avgUplift != null && <p className="text-ok" title={`${w.measured} measured record(s)`}>{fmtPct(w.avgUplift)} uplift</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
