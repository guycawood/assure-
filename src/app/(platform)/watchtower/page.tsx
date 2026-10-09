import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers, getTickets } from "@/lib/data";
import { getInputsBySupplier, getMethodology } from "@/lib/scorecard-data";
import { scoreSupplier } from "@/lib/scorecard";
import { getHealth, type HealthRow } from "@/lib/health";
import { MODULES, type ModuleKey } from "@/modules/registry";
import { MSymbol } from "@/components/symbol";
import { Card, PageHead, Pill, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Watchtower" };

const TONE = { ok: "text-ok", warn: "text-warn", bad: "text-bad" } as const;

// Master Watchtower: every module's health in one place, rolled up from each module Watchtower.
export default async function MasterWatchtower() {
  await requireInternal();
  const supabase = await createClient();
  const mods = MODULES.filter((x) => x.key !== "watchtower");
  const [suppliers, tickets, m, inputs, crRes, ...healthLists] = await Promise.all([
    getSuppliers(supabase), getTickets(supabase), getMethodology(supabase, { status: "active" }), getInputsBySupplier(supabase),
    supabase.from("change_requests").select("status"),
    ...mods.map((x) => getHealth(supabase, x.key)),
  ]);
  const health = new Map<ModuleKey, HealthRow[]>(mods.map((x, i) => [x.key, healthLists[i] as HealthRow[]]));
  const today = new Date().toISOString().slice(0, 10);
  const overdue = tickets.filter((t) => t.status !== "resolved" && t.due_date && t.due_date < today).length;
  const pct = suppliers.length ? Math.round((suppliers.filter((s) => s.rag === "green").length / suppliers.length) * 100) : 0;
  const psl = m ? suppliers.filter((s) => scoreSupplier(m, inputs.get(s.id) ?? [], s.active).preferred).length : 0;
  // Assure+ health comes from its own data until it has a health view.
  health.set("assure", [
    { module: "assure", metric: "compliant", label: "Suppliers fully compliant (%)", value: pct, target: 90, status: pct >= 90 ? "ok" : pct >= 60 ? "warn" : "bad" },
    { module: "assure", metric: "overdue", label: "Overdue SRT tickets", value: overdue, target: 0, status: overdue ? "bad" : "ok" },
    { module: "assure", metric: "psl", label: "Preferred suppliers", value: psl, target: 0, status: "ok" },
  ]);
  const all = [...health.values()].flat();
  const red = all.filter((h) => h.status === "bad").length;
  const amber = all.filter((h) => h.status === "warn").length;
  const openCr = ((crRes.data ?? []) as { status: string }[]).filter((c) => !["verified_complete", "rejected"].includes(c.status)).length;

  return (
    <>
      <PageHead title="Watchtower" sub="One view of the whole platform. Each module has its own Watchtower for its rules and health; they all roll up here.">
        <Link href="/watchtower/flow" className="text-sm font-semibold text-accent hover:underline">How it fits together →</Link>
      </PageHead>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Live modules" value={`${mods.filter((x) => x.status === "live").length} of ${mods.length}`} icon={<MSymbol name="apps" size={20} />} />
        <Stat label="Needs action" value={red} tone={red ? "bad" : "ok"} hint="Health measures in the red" icon={<MSymbol name="error" size={20} />} />
        <Stat label="To watch" value={amber} tone={amber ? "warn" : "ok"} hint="Health measures in amber" icon={<MSymbol name="warning" size={20} />} />
        <Stat label="Open change requests" value={openCr} tone={openCr ? "warn" : undefined} icon={<MSymbol name="rule" size={20} />} />
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {mods.map((x) => {
          const rows = health.get(x.key) ?? [];
          const live = x.status === "live";
          const c = x.colour === "#9DC5ED" ? "#4896F7" : x.colour;
          return (
            <Card key={x.key} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: x.colour + "33", color: c }}><MSymbol name={x.icon} size={18} /></span>
                <h2 className="font-bold">{x.name}</h2>
                <span className="ml-auto">{live ? <Pill tone={rows.some((r) => r.status === "bad") ? "bad" : rows.some((r) => r.status === "warn") ? "warn" : "ok"}>Live</Pill> : <Pill>{x.phase}</Pill>}</span>
              </div>
              {rows.length ? (
                <ul className="space-y-1 text-sm">
                  {rows.slice(0, 4).map((r) => (
                    <li key={r.metric} className="flex items-baseline justify-between gap-2">
                      <span className="text-muted">{r.label}</span>
                      <span className={`font-bold tabular-nums ${TONE[r.status]}`}>{r.value}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{live ? "No health measures published yet." : `${x.tagline}. Health appears here once the module is live.`}</p>
              )}
              <div className="mt-auto flex gap-3 text-sm">
                <Link href={x.basePath} className="font-semibold text-accent hover:underline">Open</Link>
                <Link href={`${x.basePath}/watchtower`} className="font-semibold text-accent hover:underline">Module Watchtower</Link>
              </div>
            </Card>
          );
        })}
      </section>
    </>
  );
}
