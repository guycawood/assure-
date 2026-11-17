"use client";

import { useState } from "react";
import { ActionForm, Field } from "@/components/sourcing/action-form";
import { TEMPLATES, type ParamDef } from "@/lib/savings-check/templates";
import { addRulesFromTemplate } from "@/app/(platform)/crm/clients/rules-actions";

const HINT: Partial<Record<ParamDef["type"], string>> = {
  list: "One per line, or separated by commas.", map: "One per line: name = value", groups: "One per line: Category: owner, owner",
};
const init = (d: ParamDef) => (Array.isArray(d.default) ? (d.default as string[]).join("\n") : d.default === undefined ? "" : String(d.default));

/** Pick a kind of check and fill in its values. The form is built from the template's own parameter list. */
export function RuleTemplateForm({ clientId, tableKeys = [] }: { clientId: string; tableKeys?: { key: string; kind: "list" | "lookup" }[] }) {
  const [key, setKey] = useState("required_fields");
  const t = TEMPLATES[key];
  return (
    <ActionForm action={addRulesFromTemplate} hidden={{ client_id: clientId, template: key }} submit="Add this check" variant="secondary" className="space-y-3">
      <Field label="Kind of check" htmlFor="tpl"><select id="tpl" className="input" value={key} onChange={(e) => setKey(e.target.value)}>{Object.values(TEMPLATES).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></Field>
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">{t.what}</p>
      <div key={key} className="grid gap-3 md:grid-cols-2">
        {t.params.map((d) => {
          const name = `p_${d.key}`, hint = d.hint ?? HINT[d.type];
          return (
            <Field key={d.key} label={d.label} htmlFor={name} hint={hint} className={d.type === "map" || d.type === "groups" || d.key === "comment" ? "md:col-span-2" : undefined}>
              {d.type === "list" || d.type === "map" || d.type === "groups"
                ? <textarea id={name} name={name} rows={d.type === "list" ? 2 : 3} defaultValue={init(d)} className="input" />
                : <><input id={name} name={name} list={d.key === "table_ref" || d.key === "list" ? `tk-${d.key}` : undefined} type={d.type === "number" ? "number" : d.type === "date" ? "date" : "text"} step={d.type === "number" ? "any" : undefined} defaultValue={init(d)} className="input" />{(d.key === "table_ref" || d.key === "list") && <datalist id={`tk-${d.key}`}>{tableKeys.filter((x) => x.kind === (d.key === "list" ? "list" : "lookup")).map((x) => <option key={x.key} value={x.key} />)}</datalist>}</>}
            </Field>
          );
        })}
      </div>
    </ActionForm>
  );
}
