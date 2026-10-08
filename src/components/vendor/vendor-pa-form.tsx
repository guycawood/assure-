"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaForm } from "@/components/vendor/pa-form";
import { FileUpload } from "@/components/file-upload";
import { MSymbol } from "@/components/symbol";
import { PHOTO_SLOTS, type ActionResult, type PaData } from "@/lib/vendor";
import { savePreAssessment } from "@/app/vendor/(portal)/actions";

/** Signed-in vendor's pre-assessment: save as draft, upload site photos (after the first save), submit. */
export function VendorPaForm({ id, initial, readOnly, supplierId, photoLabels }: {
  id: string | null; initial: PaData; readOnly: boolean; supplierId: string; photoLabels: string[];
}) {
  const router = useRouter();
  const [paId, setPaId] = useState(id);
  const save = async (data: PaData, submit: boolean): Promise<ActionResult> => {
    const r = await savePreAssessment(paId, data, submit);
    if (r.id) setPaId(r.id);
    router.refresh();
    return r;
  };
  const have = new Set(photoLabels.map((l) => l.toLowerCase()));
  const photos = (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="mb-1 text-sm font-bold text-brand-navy">Site photos</h3>
      <p className="mb-4 text-xs text-muted">One photo for each area helps adm Indicia assess your site without a visit. JPG or PNG, up to 15 MB.</p>
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
  );
  return <PaForm initial={initial} mode="vendor" readOnly={readOnly} save={save} photos={photos} />;
}
