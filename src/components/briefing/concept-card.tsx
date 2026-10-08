import { clsx } from "clsx";
import { Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { money, SPEC_TYPE_LABEL, type SpecConcept, type SubstrateSpecs } from "@/lib/briefing";
import { EcoGradeBadge } from "./labels";

const ICON: Record<string, string> = { "2d": "description", "3d": "view_in_ar", promo_merch: "redeem", design: "brush", custom_goods_services: "handyman" };

/** Claude does not generate images: a styled placeholder stands in for the concept visual. */
export function ConceptVisual({ concept }: { concept: Pick<SpecConcept, "name" | "suggested_spec_type" | "suggested_length" | "suggested_width" | "suggested_depth" | "suggested_unit" | "suggested_substrate_name"> }) {
  const dims = [concept.suggested_length, concept.suggested_width, concept.suggested_depth].filter((x) => x != null);
  return (
    <div className="relative grid aspect-[16/7] w-full place-items-center overflow-hidden rounded-lg border border-line" style={{ background: "linear-gradient(135deg, #B776BC22, #9DC5ED33 60%, #F0F7F7)" }} aria-hidden>
      <div className="absolute inset-3 rounded-md border border-dashed border-[#B776BC66]" />
      <div className="flex flex-col items-center gap-1 text-center text-[#6b3d70]">
        <MSymbol name={ICON[concept.suggested_spec_type] ?? "category"} size={30} />
        <p className="max-w-[90%] text-xs font-bold leading-tight">{concept.name}</p>
        {dims.length > 0 && <p className="text-[0.65rem] font-semibold opacity-80">{dims.join(" × ")} {concept.suggested_unit ?? ""}</p>}
      </div>
      <span className="absolute bottom-1.5 right-2 text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Visual placeholder</span>
    </div>
  );
}

export function SubstrateChips({ specs }: { specs: SubstrateSpecs }) {
  const items: string[] = [];
  if (specs.substrate_type) items.push(specs.substrate_type);
  if (specs.grammage_gsm != null) items.push(`${specs.grammage_gsm} gsm`);
  if (specs.thickness_mm != null) items.push(`${specs.thickness_mm} mm`);
  if (specs.recycled_content_percent != null) items.push(`${specs.recycled_content_percent}% recycled`);
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {items.map((t) => <span key={t} className="rounded border border-line bg-surface px-1.5 text-[0.65rem]">{t}</span>)}
      {specs.fsc_certified && <span className="rounded border border-ok/40 px-1.5 text-[0.65rem] text-ok">FSC</span>}
      {specs.verification_status && <span className="rounded border border-line px-1.5 text-[0.65rem] capitalize text-muted">{specs.verification_status.replace(/_/g, " ")}</span>}
    </span>
  );
}

export function ConceptCard({ concept: c, top, actions, compact }: { concept: SpecConcept; top?: boolean; actions?: React.ReactNode; compact?: boolean }) {
  return (
    <article className={clsx("flex flex-col gap-2 rounded-xl border p-3", top ? "border-[#B776BC] bg-[#B776BC0d]" : "border-line bg-surface")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="mr-1 text-sm font-bold">{c.name}</h3>
        {top && <Pill tone="accent"><MSymbol name="star" size={13} fill /> Top pick</Pill>}
        {c.suggested_spec_type && <Pill>{SPEC_TYPE_LABEL[c.suggested_spec_type] ?? c.suggested_spec_type}</Pill>}
        {c.fit_score != null && <Pill tone="info" title="How well the AI thinks this fits the brief (indicative)">Fit {c.fit_score}</Pill>}
      </div>
      {!compact && <ConceptVisual concept={c} />}
      <p className="text-[0.8rem] text-muted">{c.creative_direction}</p>
      {c.suggested_substrate_name && (
        <div className="rounded-lg border border-line bg-surface-2/70 px-2.5 py-2">
          <p className="flex items-center gap-1 text-xs font-semibold"><MSymbol name="layers" size={14} /> {c.suggested_substrate_name}
            {!c.suggested_substrate_id && <span className="font-normal text-bad"> · not in the approved library</span>}</p>
          {c.substrate_specs && <SubstrateChips specs={c.substrate_specs} />}
        </div>
      )}
      {(c.suggested_length || c.suggested_width) && (
        <p className="text-xs"><span className="text-muted">Size:</span> {c.suggested_length ?? "?"} × {c.suggested_width ?? "?"}{c.suggested_depth ? ` × ${c.suggested_depth}` : ""} {c.suggested_unit ?? ""}</p>
      )}
      <EcoGradeBadge eco={c.eco} />
      {(c.indicative_unit_price != null || c.indicative_total != null) && (
        <div className="rounded-lg border border-line bg-surface-2/70 px-2.5 py-2 text-xs">
          <p className="eyebrow">Indicative price</p>
          <p className="mt-0.5">
            {c.indicative_unit_price != null && <b>{money(c.indicative_unit_price, c.price_currency ?? "GBP")}/unit</b>}
            {c.indicative_total != null && <span className="text-muted"> · total {money(Math.round(c.indicative_total), c.price_currency ?? "GBP")}{c.indicative_quantity ? ` for ${c.indicative_quantity.toLocaleString("en-GB")} units` : ""}</span>}
          </p>
          {c.price_basis && <p className="text-[0.7rem] text-muted">Basis: {c.price_basis}</p>}
        </div>
      )}
      {c.rationale && <p className="text-xs text-muted">{c.rationale}</p>}
      {c.risks?.length > 0 && <p className="text-xs text-warn">Risks: {c.risks.join("; ")}</p>}
      {actions && <div className="mt-auto pt-1">{actions}</div>}
    </article>
  );
}
