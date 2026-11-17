export type ExtraQuestion = { id: string; text: string; type: string; options?: string[]; required?: boolean };
export type SavedAnswers = Record<string, { text: string; value: string }> | null | undefined;

/** The extra questions SRM has added to a vendor form. Inputs are named custom_<id>; the save action gathers them. */
export function ExtraFields({ questions }: { questions: ExtraQuestion[] }) {
  if (questions.length === 0) return null;
  return (
    <>
      <input type="hidden" name="custom_present" value="1" />
      {questions.map((q) => {
        const name = `custom_${q.id}`, req = q.required !== false;
        const label = <span className="label">{q.text}{req && " *"}</span>;
        if (q.type === "textarea") return <label key={q.id} className="text-sm sm:col-span-2">{label}<textarea name={name} rows={2} required={req} maxLength={1000} className="input" /></label>;
        if (q.type === "yes_no" || q.type === "rating" || q.type === "single_choice") {
          const opts = q.type === "yes_no" ? ["Yes", "No"] : q.type === "rating" ? ["1", "2", "3", "4", "5"] : q.options ?? [];
          return <label key={q.id} className="text-sm">{label}<select name={name} required={req} className="input" defaultValue=""><option value="">Choose</option>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>;
        }
        if (q.type === "multiple_choice") {
          return <fieldset key={q.id} className="text-sm sm:col-span-2"><legend className="label">{q.text}{req && " *"}</legend>{(q.options ?? []).map((o) => <label key={o} className="mr-4 inline-flex items-center gap-1.5"><input type="checkbox" name={name} value={o} />{o}</label>)}</fieldset>;
        }
        return <label key={q.id} className="text-sm">{label}<input name={name} type={q.type === "date" ? "date" : "text"} required={req} maxLength={1000} className="input" /></label>;
      })}
    </>
  );
}

/** Answers saved with an entry, shown under its name. */
export function SavedExtra({ custom }: { custom: SavedAnswers }) {
  const rows = Object.values(custom ?? {});
  if (rows.length === 0) return null;
  return <div className="mt-1 space-y-0.5">{rows.map((r, i) => <div key={i} className="text-xs text-muted"><span className="font-medium">{r.text}</span> {r.value}</div>)}</div>;
}
