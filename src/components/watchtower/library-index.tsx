import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLibraryCounts, getLibraryDefs } from "@/lib/library-data";
import { MODULES } from "@/modules/registry";
import { Card, Pill } from "@/components/ui";
import { MSymbol } from "@/components/symbol";

/** Library catalogue: one module's libraries, or every module's (master Watchtower). */
export async function LibraryIndex({ module, basePath }: { module?: string; basePath: string }) {
  const supabase = await createClient();
  const [defs, counts] = await Promise.all([getLibraryDefs(supabase, module), getLibraryCounts(supabase)]);
  const mods = MODULES.filter((m) => defs.some((d) => d.module === m.key));
  return (
    <div className="flex flex-col gap-5">
      {mods.map((m) => (
        <section key={m.key}>
          {!module && <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><MSymbol name={m.icon} size={18} style={{ color: m.colour === "#9DC5ED" ? "#4896F7" : m.colour }} /> {m.name}</h3>}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {defs.filter((d) => d.module === m.key).map((d) => {
              const c = counts.get(d.key) ?? { active: 0, pending: 0 };
              return (
                <Link key={d.key} href={`${basePath}/${d.key}`} className="group">
                  <Card className="h-full p-4 transition group-hover:shadow-raised">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold">{d.label}</p>
                      <span className="flex gap-1">
                        {d.requires_approval && <Pill tone="info">2-person</Pill>}
                        {c.pending > 0 && <Pill tone="warn">{c.pending} pending</Pill>}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{d.description}</p>
                    <p className="mt-3 text-xs font-semibold text-fg/70">{c.active} active record{c.active === 1 ? "" : "s"}</p>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
