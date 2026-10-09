import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { moduleByKey, type ModuleKey } from "@/modules/registry";
import { ButtonLink, Card, PageHead, Stat, type Crumb } from "@/components/ui";
import { MSymbol } from "@/components/symbol";
import { LibraryIndex } from "./library-index";
import { LibraryView, type LibrarySearch } from "./library-view";
import { RecordHistory } from "./record-history";
import { ChangeRequests } from "./change-requests";
import { AuditTrail } from "./audit-trail";
import { getHealth } from "@/lib/health";

/**
 * Serves a Watchtower under `base`:
 *   (none)                     module Watchtower overview
 *   libraries                  library catalogue
 *   libraries/<key>            library screen
 *   libraries/<key>/<id>       record versions + history
 *   change-requests            change request queue
 *   audit                      audit trail
 * module undefined = master Watchtower (all modules).
 */
export async function WatchtowerRoute({ module, base, slug, sp }: { module?: ModuleKey; base: string; slug: string[]; sp: LibrarySearch }) {
  const m = module ? moduleByKey(module) : undefined;
  const root: Crumb[] = m ? [{ label: m.name, href: m.basePath }, { label: "Watchtower", href: base }] : [{ label: "Watchtower", href: base }];
  const [section, key, id] = slug;

  if (!section) return m ? <ModuleWatchtower module={m.key} base={base} /> : notFound();
  if (section === "libraries" && !key) {
    return (
      <>
        <PageHead crumbs={[...root, { label: "Libraries" }]} title={m ? `${m.name} libraries` : "Governed libraries"}
          sub={m ? `The reference lists and rules ${m.name} runs on. Changes are versioned and audited.` : "Every module's libraries in one place. Changes are versioned, audited and, where marked, approved by a second person."} />
        <LibraryIndex module={module} basePath={`${base}/libraries`} />
      </>
    );
  }
  if (section === "libraries" && key && !id) return <LibraryView libraryKey={key} basePath={`${base}/libraries/${key}`} sp={sp} crumbs={[...root, { label: "Libraries", href: `${base}/libraries` }, { label: "Library" }]} />;
  if (section === "libraries" && key && id) return <RecordHistory libraryKey={key} recordId={id} crumbs={[...root, { label: "Libraries", href: `${base}/libraries` }, { label: "Library", href: `${base}/libraries/${key}` }, { label: "History" }]} />;
  if (section === "change-requests") return <ChangeRequests module={module} view={sp.view} crumbs={[...root, { label: "Change requests" }]} />;
  if (section === "audit") return <AuditTrail module={module} crumbs={[...root, { label: "Audit trail" }]} />;
  notFound();
}

/** A module's own Watchtower: health, its libraries, change requests and audit. */
async function ModuleWatchtower({ module, base }: { module: ModuleKey; base: string }) {
  const m = moduleByKey(module)!;
  const supabase = await createClient();
  const [{ data: defs }, { data: crs }, { data: audit }, health] = await Promise.all([
    supabase.from("library_definitions").select("key").eq("module", module),
    supabase.from("change_requests").select("status").eq("module", module),
    supabase.from("library_audit").select("id").eq("module", module).limit(1000),
    getHealth(supabase, module),
  ]);
  const openCr = ((crs ?? []) as { status: string }[]).filter((c) => !["verified_complete", "rejected"].includes(c.status)).length;
  return (
    <>
      <PageHead crumbs={[{ label: m.name, href: m.basePath }, { label: "Watchtower" }]} title={`${m.name} Watchtower`}
        sub={`The rules, libraries and methodology ${m.name} runs on, governed here and rolled up into the master Watchtower.`}>
        <ButtonLink href="/watchtower"><MSymbol name="cell_tower" size={18} /> Master Watchtower</ButtonLink>
      </PageHead>
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Libraries" value={(defs ?? []).length} hint="Governed reference lists" icon={<MSymbol name="library_books" size={20} />} />
        <Stat label="Open change requests" value={openCr} tone={openCr ? "warn" : undefined} hint="Awaiting review or verification" icon={<MSymbol name="rule" size={20} />} />
        <Stat label="Recorded changes" value={(audit ?? []).length} hint="In the audit trail" icon={<MSymbol name="manage_history" size={20} />} />
      </section>
      {health.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">Module health</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {health.map((h) => (
              <Stat key={h.metric} label={h.label} value={h.value} tone={h.status} hint={`Target ${h.target}`} />
            ))}
          </div>
        </section>
      )}
      {m.status === "planned" && (
        <Card className="px-5 py-3.5 text-sm text-muted">{m.name} is {m.phase.toLowerCase()} work. Its libraries can be set up now so the module starts from governed data. Health metrics appear here once it&apos;s live.</Card>
      )}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">Libraries</h2>
          <div className="flex gap-3 text-sm font-semibold">
            <Link href={`${base}/change-requests`} className="text-accent hover:underline">Change requests</Link>
            <Link href={`${base}/audit`} className="text-accent hover:underline">Audit trail</Link>
          </div>
        </div>
        <LibraryIndex module={module} basePath={`${base}/libraries`} />
      </section>
    </>
  );
}
