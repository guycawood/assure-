import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHealth } from "@/lib/health";
import { LAYERS, moduleByKey, type ModuleKey } from "@/modules/registry";
import { PEF_STAGES, STAGE_LABEL } from "@/lib/pef";
import { ButtonLink, Card, PageHead, Pill, Stat } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

export const metadata: Metadata = { title: "Impact Grade" };

const STAGE_ICON: Record<(typeof PEF_STAGES)[number], string> = {
  material: "layers", manufacturing: "precision_manufacturing", distribution: "local_shipping", use: "bolt", end_of_life: "recycling",
};

export default async function ImpactGradeHome() {
  await requireInternal();
  const supabase = await createClient();
  const health = await getHealth(supabase, "impact-grade");
  const touches = LAYERS.find((l) => l.key === "sustainability")?.touches ?? {};

  return (
    <>
      <PageHead crumbs={[{ label: "Impact Grade" }]} title="Impact Grade"
        sub="A product's environmental footprint across its whole life, measured one way for every spec (the PEF score) and turned into an Impact Grade (0-100, A-E).">
        <ButtonLink href="/impact-grade/watchtower/grade" variant="primary"><MSymbol name="calculate" size={18} /> Impact Grade calculator</ButtonLink>
        <ButtonLink href="/impact-grade/jobs"><MSymbol name="work" size={18} /> Jobs</ButtonLink>
        <ButtonLink href="/impact-grade/watchtower"><MSymbol name="cell_tower" size={18} /> Watchtower</ButtonLink>
      </PageHead>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {health.map((h) => (
          <Stat key={h.metric} label={h.label} value={h.metric === "ef_weighting_total" ? `${h.value}%` : h.value} tone={h.status} hint={h.metric === "ef_weighting_total" ? "Target 100%" : `Target ${h.target}`} />
        ))}
      </section>

      <section>
        <h2 className="mb-2 font-bold">Five stages, sixteen impact categories, one PEF score</h2>
        <div className="grid gap-3 md:grid-cols-5">
          {PEF_STAGES.map((s, i) => (
            <Card key={s} className="flex items-center gap-3 p-4 text-sm">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-sustainability/20 text-brand-sustainability"><MSymbol name={STAGE_ICON[s]} size={20} /></span>
              <span><span className="eyebrow block">Stage {i + 1}</span><span className="font-semibold">{STAGE_LABEL[s]}</span></span>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">
          Each stage is worked out from ecoinvent 3.12 factors in all 16 EF 3.1 impact categories, normalised and weighted into the PEF score.
          The PEF score is half of the Impact Grade; circular design and resource use from the spec make up the rest.
          The method is Anthesis&apos;s, and every table, factor and rule behind it is governed in the <Link className="text-accent hover:underline" href="/impact-grade/watchtower">Impact Grade Watchtower</Link>.
        </p>
      </section>

      <Card className="p-5 text-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-bold">Where the grade will be used</h2>
          <Pill tone="ok">Linked</Pill>
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          {(Object.entries(touches) as [ModuleKey, string][]).map(([k, what]) => {
            const m = moduleByKey(k);
            return (
              <li key={k} className="flex items-start gap-2">
                <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m?.colour }} />
                <span><span className="font-semibold">{m?.name ?? k}</span>: <span className="text-muted">{what}</span></span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Ideation concepts carry a provisional grade; every spec has a grade record worked out from its own data and its supplier&apos;s SRM scorecard, with the evidence tier of each input and a confidence that rises as better evidence arrives.
          Jobs roll those records up in <Link className="text-accent hover:underline" href="/impact-grade/jobs">Impact Grade by job</Link>, where each can be opened, edited and reviewed.
        </p>
      </Card>
    </>
  );
}
