import Link from "next/link";
import type { ModuleDef } from "@/modules/registry";
import { MSymbol } from "@/components/symbol";
import { Architecture } from "@/components/architecture";
import { ButtonLink, Card, PageHead } from "@/components/ui";

/** Overview for a module that isn't built yet: what it will do, its Watchtower, and where it sits. */
export function ModuleLanding({ m }: { m: ModuleDef }) {
  return (
    <>
      <PageHead title={m.name} sub={`${m.tagline}. ${m.phase}: coming next.`}>
        <ButtonLink href={`${m.basePath}/about`}><MSymbol name="info" size={18} /> About {m.name}</ButtonLink>
        <ButtonLink href={`${m.basePath}/watchtower`} variant="primary"><MSymbol name="cell_tower" size={18} /> {m.name} Watchtower</ButtonLink>
      </PageHead>

      <Card className="relative overflow-hidden p-0">
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: m.colour }} aria-hidden />
        <div className="p-6 pl-8">
          <h2 className="mb-2 font-bold">What it will do</h2>
          <ul className="list-disc space-y-1 pl-5">{m.scope.map((s) => <li key={s}>{s}</li>)}</ul>
          <p className="mt-4 text-sm text-muted">{m.flow}</p>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-bold">Where it sits in System Guy</h2>
        <Architecture highlight={m.key} compact />
        <p className="mt-3 text-xs text-muted">Its rules and libraries are already governed in its <Link href={`${m.basePath}/watchtower`} className="font-semibold text-accent underline">module Watchtower</Link>.</p>
      </Card>
    </>
  );
}
