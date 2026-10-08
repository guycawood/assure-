import { clsx } from "clsx";
import { MSymbol } from "@/components/symbol";
import { STAGE_KEYS, STAGE_LABELS, currentMilestone, shipmentMilestones, type Shipment } from "@/lib/logistics";

/** The seven-step journey for one shipment (planned → POD verified), derived from the records, never stored. */
export function Milestones({ shipment, deliveryStatus, compact }: { shipment: Pick<Shipment, "dispatch_date" | "actual_delivery_date" | "pod_status">; deliveryStatus?: string | null; compact?: boolean }) {
  const state = shipmentMilestones(shipment, deliveryStatus);
  const current = currentMilestone(state);
  return (
    <ol className={clsx("flex flex-wrap items-center gap-1", compact ? "text-[0.68rem]" : "text-xs")} aria-label="Shipment milestones">
      {STAGE_KEYS.map((k, i) => {
        const done = state[k];
        const isCurrent = !done && k === current;
        return (
          <li key={k} className="flex items-center gap-1">
            <span
              title={STAGE_LABELS[k]}
              className={clsx(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold",
                done ? "border-ok/40 bg-ok-soft text-ok" : isCurrent ? "border-warn/50 bg-warn-soft text-warn" : "border-line text-muted",
              )}
            >
              {done && <MSymbol name="check" size={12} />}
              {compact ? STAGE_LABELS[k].replace("POD ", "") : STAGE_LABELS[k]}
            </span>
            {i < STAGE_KEYS.length - 1 && <span aria-hidden className="text-line">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
