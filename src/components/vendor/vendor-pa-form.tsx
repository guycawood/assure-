"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaForm } from "@/components/vendor/pa-form";
import { FileUpload } from "@/components/file-upload";
import { MSymbol } from "@/components/symbol";
import { PHOTO_SLOTS, type ActionResult, type PaData } from "@/lib/vendor";
import { savePreAssessment } from "@/app/vendor/(portal)/actions";

export type ExtraQuestion = { id: string; text: string; type: string; options?: string[]; required?: boolean };

/** Signed-in vendor's pre-assessment: save as draft, upload site photos (after the first save), answer the extra questions, submit. */
export function VendorPaForm({ id, initial, readOnly, supplierId, photoLabels, extra = [] }: {
  id: string | null; initial: PaData; readOnly: boolean; supplierId: string; photoLabels: string[]; extra?: ExtraQuestion[];
}) {
  const router = useRouter();
  const [paId, setPaId] = useState(id);
  const [custom, setCustom] = useState<Record<string, string>>((initial.custom as Record<string, string> | undefined) ?? {});
  const save = async (data: PaData, submit: boolean): Promise<ActionResult> => {
    const r = await savePreAssessment(paId, { ...data, custom }, submit);
    if (r.id) setPaId(r.id);
    router.refresh();
    return r;
  };
  const have = new Set(photoLabels.map((l) => l.toLowerCase()));
  const set = (k: string, v: string) => setCustom((c) => ({ ...c, [k]: v }));
  const questions = extra.length > 0 && (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="mb-1 text-sm font-bold text-brand-navy">Additional questions</h3>
      <p className="mb-4 text-xs text-muted">These were added to the form by our procurement and sustainability teams. Fields marked * are needed before you submit.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {extra.map((q) => {
          const name = `extra-${q.id}`, val = custom[q.id] ?? "";
          const label = <label htmlFor={name} className="label">{q.text}{q.required !== false && " *"}</label>;
          if (q.type === "textarea") return <div key={q.id} className="sm:col-span-2">{label}<textarea id={name} rows={3} className="input" value={val} disabled={readOnly} onChange={(e) => set(q.id, e.target.value)} maxLength={1000} /></div>;
          if (q.type === "yes_no" || q.type === "single_choice" || q.type === "rating") {
            const opts = q.type === "yes_no" ? ["Yes", "No"] : q.type === "rating" ? ["1", "2", "3", "4", "5"] : q.options ?? [];
            return <div key={q.id}>{label}<select id={name} className="input" value={val} disabled={readOnly} onChange={(e) => set(q.id, e.target.value)}><option value="">Choose</option>{opts.map((o) => <option key={o}>{o}</option>)}</select></div>;
          }
          if (q.type === "multiple_choice") {
            const picked = val ? val.split("; ") : [];
            return (
              <fieldset key={q.id}><legend className="label">{q.text}{q.required !== false && " *"}</legend>
                {(q.options ?? []).map((o) => (
                  <label key={o} className="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={readOnly} checked={picked.includes(o)}
                    onChange={(e) => set(q.id, (e.target.checked ? [...picked, o] : picked.filter((x) => x !== o)).join("; "))} />{o}</label>
                ))}
              </fieldset>
            );
          }
          return <div key={q.id}>{label}<input id={name} type={q.type === "date" ? "date" : "text"} className="input" value={val} disabled={readOnly} onChange={(e) => set(q.id, e.target.value)} maxLength={1000} /></div>;
        })}
      </div>
    </section>
  );
  const photos = (
    <>
      {questions}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-1 text-sm font-bold text-brand-navy">Site photos</h3>
        <p className="mb-4 text-xs text-muted">One photo for each area helps us assess your site without a visit. JPG or PNG, up to 15 MB.</p>
        {!paId ? <p className="text-sm text-muted">Save a draft first, then upload your photos here.</p> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PHOTO_SLOTS.map((p) => (
              <div key={p.key} className="rounded-xl border border-line p-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  {have.has(p.label.toLowerCase()) ? <MSymbol name="check_circle" size={18} fill className="text-ok" /> : <MSymbol name="photo_camera" size={18} className="text-muted" />}
                  {p.label}
                </p>
                {!readOnly && <FileUpload module="assure" entityType="pre_assessment" entityId={paId} supplierId={supplierId} label={p.label} accept="image/*" compact />}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
  return <PaForm initial={initial} mode="vendor" readOnly={readOnly} save={save} photos={photos} />;
}
