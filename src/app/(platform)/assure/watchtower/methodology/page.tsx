import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSuppliers } from "@/lib/data";
import { getInputsBySupplier, getMethodology } from "@/lib/scorecard-data";
import { fmtScore, scoreSupplier } from "@/lib/scorecard";
import { btn, Card, PageHead, Pill } from "@/components/ui";
import { MethodologyEditor } from "./editor";
import { discardDraft } from "../actions";

export const metadata: Metadata = { title: "Edit scoring methodology" };

// Admin-only. Edits apply to the draft; the preview compares the saved draft with the live version.
export default async function EditMethodology() {
  await requireAdmin();
  const supabase = await createClient();
  const [draft, active, suppliers, inputs] = await Promise.all([
    getMethodology(supabase, { status: "draft" }),
    getMethodology(supabase, { status: "active" }),
    getSuppliers(supabase),
    getInputsBySupplier(supabase),
  ]);
  if (!draft || !active) redirect("/assure/watchtower");

  const diff = suppliers.map((s) => {
    const a = scoreSupplier(active, inputs.get(s.id) ?? [], s.active);
    const d = scoreSupplier(draft, inputs.get(s.id) ?? [], s.active);
    return { s, a, d, delta: (d.overall ?? 0) - (a.overall ?? 0) };
  });
  const pslA = diff.filter((x) => x.a.preferred).length;
  const pslD = diff.filter((x) => x.d.preferred).length;
  const changed = diff.filter((x) => x.a.preferred !== x.d.preferred);
  const movers = [...diff].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).filter((x) => Math.abs(x.delta) >= 0.005).slice(0, 8);

  return (
    <>
      <PageHead title={`Draft methodology v${draft.version}`} sub={`Copied from live version ${active.version}. Nothing changes for anyone until you activate it.`}>
        <Link href="/assure/watchtower" className={btn.secondary}>Back to Watchtower</Link>
        <form action={discardDraft.bind(null, draft.id)}><button className={btn.danger}>Discard draft</button></form>
      </PageHead>

      <Card className="p-4">
        <h2 className="mb-2 font-display text-lg font-semibold">Effect of the saved draft</h2>
        <p className="text-sm">
          Preferred suppliers: <b>{pslA}</b> now → <b>{pslD}</b> with this draft.
          {changed.length > 0 && <> {changed.length} supplier{changed.length === 1 ? "" : "s"} would change PSL status.</>}
        </p>
        {movers.length > 0 ? (
          <table className="mt-3 w-full text-sm">
            <thead><tr><th className="th">Supplier</th><th className="th text-right">Live</th><th className="th text-right">Draft</th><th className="th text-right">Change</th><th className="th">PSL</th></tr></thead>
            <tbody>
              {movers.map(({ s, a, d, delta }) => (
                <tr key={s.id}>
                  <td className="td">{s.name}</td>
                  <td className="td text-right tabular-nums">{fmtScore(a.overall)}</td>
                  <td className="td text-right tabular-nums">{fmtScore(d.overall)}</td>
                  <td className={`td text-right tabular-nums ${delta > 0 ? "text-ok" : "text-bad"}`}>{delta > 0 ? "+" : ""}{delta.toFixed(2)}</td>
                  <td className="td">{a.preferred === d.preferred ? <span className="text-muted">no change</span> : d.preferred ? <Pill tone="ok">joins PSL</Pill> : <Pill tone="bad">leaves PSL</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-1 text-sm text-muted">No score changes yet. Edit below and save the draft to preview.</p>
        )}
      </Card>

      <MethodologyEditor draft={draft} />
    </>
  );
}
