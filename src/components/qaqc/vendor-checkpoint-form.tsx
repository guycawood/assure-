"use client";

import { ActionForm } from "@/components/vendor/action-form";
import { aqlAccept, NEED_LABEL, type QaqcCheckpoint } from "@/lib/qaqc";
import { submitQaqc } from "@/app/vendor/(portal)/qaqc/actions";
import { useState } from "react";

type Body = { code: string; name: string; body_type: string | null };

/** One form per checkpoint: a file picker per required item, the key data that item needs, and the overall result. */
export function VendorCheckpointForm({ checkpoint, bodies }: { checkpoint: QaqcCheckpoint; bodies: Body[] }) {
  const [aql, setAql] = useState<{ sample?: number; major?: number }>({});
  const majorAql = checkpoint.aql?.major ? Number(checkpoint.aql.major) : null;
  const allowed = aqlAccept(aql.sample, majorAql);
  return (
    <ActionForm action={submitQaqc} submit="Upload and check" hidden={{ checkpoint: checkpoint.id, groups: String(checkpoint.required.length) }} resetOnOk>
      {checkpoint.required.map((r, g) => {
        const needs = new Set(r.needs ?? []);
        const photos = r.codes.includes("PHOTO_SET");
        return (
          <fieldset key={r.group} className="space-y-2 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{r.names}</legend>
            {r.codes.length > 1 ? (
              <select name={`type_${g}`} className="input" aria-label="Which document">
                {r.codes.map((c, i) => <option key={c} value={c}>{r.names.split(" or ")[i] ?? c}</option>)}
              </select>
            ) : <input type="hidden" name={`type_${g}`} value={r.codes[0]} />}
            <input type="file" name={`files_${g}`} multiple={photos} accept={photos ? "image/*" : "application/pdf,image/*,.xlsx,.docx,.csv"} className="block w-full text-sm" />
            {photos && checkpoint.min_photos > 0 && <p className="text-xs text-muted">At least {checkpoint.min_photos} photos (one file each).</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {needs.has("issued_on") && <label className="text-xs">Issue date<input type="date" name={`issued_on_${g}`} className="input" /></label>}
              {needs.has("inspection_date") && <label className="text-xs">Inspection date<input type="date" name={`inspection_date_${g}`} className="input" /></label>}
              {needs.has("expires_on") && <label className="text-xs">Expiry date<input type="date" name={`expires_on_${g}`} className="input" /></label>}
              {needs.has("certificate_number") && <label className="text-xs">Certificate number<input name={`cert_${g}`} className="input" maxLength={100} /></label>}
              {needs.has("body") && (
                <label className="text-xs">{NEED_LABEL.body.replace(/^./, (c) => c.toUpperCase())}
                  <select name={`body_${g}`} className="input" defaultValue="">
                    <option value="">Choose an approved body</option>
                    {bodies.map((b) => <option key={b.code} value={b.code}>{b.name}{b.body_type ? ` (${b.body_type.replace(/_/g, " ")})` : ""}</option>)}
                  </select>
                </label>
              )}
              {needs.has("aql") && (
                <>
                  <label className="text-xs">AQL sample size<input name={`sample_${g}`} inputMode="numeric" className="input" onChange={(e) => setAql((a) => ({ ...a, sample: Number(e.target.value) || undefined }))} /></label>
                  <label className="text-xs">Critical defects<input name={`critical_${g}`} inputMode="numeric" className="input" defaultValue="0" /></label>
                  <label className="text-xs">Major defects<input name={`major_${g}`} inputMode="numeric" className="input" onChange={(e) => setAql((a) => ({ ...a, major: Number(e.target.value) }))} /></label>
                  <label className="text-xs">Minor defects<input name={`minor_${g}`} inputMode="numeric" className="input" defaultValue="0" /></label>
                  {allowed != null && (
                    <p className={`text-xs sm:col-span-2 ${aql.major != null && aql.major > allowed ? "text-bad" : "text-muted"}`}>
                      At {checkpoint.aql?.name} a sample of {aql.sample} allows up to {allowed} major defect(s).
                    </p>
                  )}
                </>
              )}
              {needs.has("result") && (
                <label className="text-xs">Result on the report
                  <select name={`result_${g}`} className="input" defaultValue="pass"><option value="pass">Pass</option><option value="fail">Fail</option></select>
                </label>
              )}
            </div>
          </fieldset>
        );
      })}
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <label className="text-xs">This checkpoint is a
          <select name="result" className="input" defaultValue="pass"><option value="pass">Pass</option><option value="fail">Fail</option></select>
        </label>
        <label className="text-xs">Notes for adm Indicia (optional)<input name="notes" className="input" maxLength={2000} /></label>
      </div>
    </ActionForm>
  );
}
