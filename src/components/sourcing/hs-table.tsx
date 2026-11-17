import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Panel, Pill } from "@/components/ui";
import { ActionForm } from "@/components/sourcing/action-form";
import { setSpecHs } from "@/app/(platform)/sourcing/hs-actions";

type Declared = { supplier_id: string; supplier_name: string; hs_code: string; note: string | null; via: "declared" | "quote"; declared_at: string | null };
type Row = {
  spec_id: string; job_id: string; job_number: string; job_title: string; spec_no: number; title: string; is_draft: boolean;
  hs_code: string | null; source: "person" | "library" | "supplier" | null; note: string | null; set_at: string | null; set_by_name: string | null;
  suggestion: { hs_code: string | null; basis: "rule" | "product_default" | null; rule_code?: string; rule_name?: string };
  declared: Declared[];
};

const SOURCE = { person: "Entered by a person", library: "From the HS code library", supplier: "Taken from the supplier" } as const;
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * The HS code of every spec on a job, or on a supplier's orders: the code on the spec and where it came from, what the library
 * suggests for that product and material, and what each supplier declared. Staff can type a code, take the library's or a
 * supplier's, or clear it. The spec's code is what customs documents read.
 */
export async function HsTable({ jobId, supplierId, showJob }: { jobId?: string; supplierId?: string; showJob?: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("spec_hs_overview", { p_job: jobId ?? null, p_supplier: supplierId ?? null });
  const rows = (data as Row[] | null) ?? [];
  const missing = rows.filter((r) => !r.hs_code && !r.is_draft).length;
  const differs = rows.filter((r) => r.hs_code && r.declared.some((d) => d.hs_code !== r.hs_code)).length;

  return (
    <Panel title={`HS codes (${rows.length} spec${rows.length === 1 ? "" : "s"})`}
      sub="The code on the spec is what customs documents use. Check it against the library's suggestion and what the supplier declares, then keep it, change it or take another. Every change is logged on the job.">
      {error ? <p className="px-5 py-4 text-sm text-bad">The HS codes could not be loaded.</p> : rows.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No specs yet.</p> : (
        <>
          {(missing > 0 || differs > 0) && (
            <p className="border-b border-line bg-warn-soft px-5 py-2 text-sm">
              {missing > 0 && <><b>{missing}</b> spec{missing === 1 ? " has" : "s have"} no HS code. </>}
              {differs > 0 && <><b>{differs}</b> differ{differs === 1 ? "s" : ""} from what a supplier declared.</>}
            </p>
          )}
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const sug = r.suggestion?.hs_code ?? null;
              const hidden = { spec_id: r.spec_id };
              return (
                <li key={r.spec_id} className="space-y-2 px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={`/sourcing/specs/${r.spec_id}`} className="font-semibold hover:underline">{showJob ? `${r.job_number} · ` : ""}Spec {r.spec_no}: {r.title}</Link>
                    {r.is_draft && <Pill tone="warn">Draft</Pill>}
                    <span className="ml-auto flex items-center gap-2">
                      {r.hs_code ? <code className="rounded bg-surface-2 px-2 py-0.5 text-sm font-bold">{r.hs_code}</code> : <Pill tone="bad">No HS code</Pill>}
                      {r.hs_code && r.source && <Pill tone={r.source === "person" ? "info" : "neutral"}>{SOURCE[r.source]}</Pill>}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {sug ? <>Library suggests <b className="text-fg">{sug}</b> {r.suggestion.basis === "rule" ? `(rule ${r.suggestion.rule_code}: ${r.suggestion.rule_name})` : `(default for ${r.suggestion.rule_name})`}</> : "No library rule or product default fits this spec yet"}
                    {r.set_by_name && r.set_at ? ` · set by ${r.set_by_name}, ${day(r.set_at)}` : ""}{r.note ? ` · “${r.note}”` : ""}
                  </p>
                  {r.declared.length > 0 && (
                    <ul className="space-y-0.5 text-xs">
                      {r.declared.map((d) => (
                        <li key={`${d.supplier_id}${d.via}`} className="flex flex-wrap items-center gap-2">
                          <span className="text-muted">{d.supplier_name} {d.via === "quote" ? "quoted" : "declared"}</span>
                          <b>{d.hs_code}</b>
                          {d.hs_code === r.hs_code ? <Pill tone="ok">Same as the spec</Pill> : <Pill tone="warn">Differs</Pill>}
                          {d.note && <span className="text-muted">“{d.note}”</span>}
                          {d.hs_code !== r.hs_code && (
                            <ActionForm action={setSpecHs} hidden={{ ...hidden, source: "supplier", hs_code: d.hs_code, note: `Taken from ${d.supplier_name}` }} submit="Use this code" variant="secondary" inline />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer font-semibold text-accent">Enter or override the code</summary>
                    <div className="mt-2 flex flex-wrap items-start gap-4">
                      <ActionForm action={setSpecHs} hidden={{ ...hidden, source: "person" }} submit="Save" inline>
                        <input name="hs_code" defaultValue={r.hs_code ?? ""} placeholder="e.g. 4911.10" aria-label="HS code" className="input w-36 py-1.5" />
                        <input name="note" placeholder="Why (kept in the job activity)" aria-label="Reason" className="input min-w-[220px] py-1.5" />
                      </ActionForm>
                      {sug && sug !== r.hs_code && <ActionForm action={setSpecHs} hidden={{ ...hidden, source: "library", hs_code: sug, note: `Library: ${r.suggestion.rule_code ?? "product default"}` }} submit={`Use the library's ${sug}`} variant="secondary" inline />}
                      {r.hs_code && <ActionForm action={setSpecHs} hidden={{ ...hidden, hs_code: "" }} submit="Clear" variant="secondary" inline confirm="Clear this spec's HS code?" />}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
