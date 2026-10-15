"use client";

import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { btn } from "@/components/ui";
import { submitSurvey } from "../../actions";

export type SurveyPage = {
  kind: "survey" | "job"; title: string; client_name: string; first_name: string; owner_name?: string; state: "open" | "answered" | "closed";
  sections?: { key: string; label: string; questions: { code: string; text: string }[] }[]; scale?: string; comment_at_or_below?: number; tools?: string[];
  services?: { id: string; name: string }[]; project_number?: string; spend?: number | null; currency?: string | null;
};

const Scale = ({ name, value, max, min = 1, onChange }: { name: string; value: number | undefined; max: number; min?: number; onChange: (v: number) => void }) => (
  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={name}>
    {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => (
      <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}
        className={clsx("grid h-9 w-9 place-items-center rounded-lg border text-sm font-semibold", value === n ? "border-accent bg-accent text-accent-fg" : "border-line hover:bg-surface-2")}>{n}</button>
    ))}
  </div>
);

export function SurveyForm({ token, page }: { token: string; page: SurveyPage }) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [npsScore, setNps] = useState<number>();
  const [text, setText] = useState({ start: "", continue: "", stop: "", comment: "" });
  const [aware, setAware] = useState<string[]>([]);
  const [interested, setInterested] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [testimonial, setTestimonial] = useState(false);
  const [overall, setOverall] = useState<number>();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const limit = page.comment_at_or_below ?? 3;
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  if (done) return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
      <h1 className="font-display text-xl font-bold">Thank you{page.first_name ? `, ${page.first_name}` : ""}</h1>
      <p className="mt-1 text-sm text-muted">We have your answers. {page.owner_name ? `${page.owner_name} and the team` : "Your account team"} will follow up.</p>
    </section>
  );

  const submit = () => start(async () => {
    setError(null);
    const answers = page.kind === "job" ? { overall, comment: text.comment }
      : { scores, comments, nps: npsScore, start: text.start, continue: text.continue, stop: text.stop, services_aware: aware, services_interested: interested, tools, testimonial };
    const res = await submitSurvey(token, answers);
    if (res.error) setError(res.error); else setDone(true);
  });

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div>
        <h1 className="font-display text-[1.6rem] font-bold leading-tight">{page.kind === "job" ? `How did ${page.title} go?` : page.title}</h1>
        <p className="mt-1 text-sm text-muted">{page.first_name ? `Hello ${page.first_name}. ` : ""}{page.kind === "job" ? "Two quick questions about this project for " : "Please tell us how adm Indicia is doing for "}{page.client_name}.
          {page.kind === "survey" && ` Score each statement from 1 (${(page.scale ?? "1 = poor").split(",")[0].replace(/^1\s*=\s*/, "")}) to 5. If you give ${limit} or lower, tell us why so we can fix it.`}</p>
      </div>

      {page.kind === "job" ? (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <p className="text-sm">Project {page.project_number}{page.spend != null ? ` · ${page.currency ?? ""} ${Math.round(page.spend).toLocaleString("en-GB")}` : ""}</p>
          <p className="font-semibold">Overall, how was your experience? (1 = poor, 5 = excellent)</p>
          <Scale name="Overall experience" value={overall} max={5} onChange={setOverall} />
          <label className="block"><span className="label">{overall != null && overall <= 3 ? "What could we have done better? (required)" : "Anything to add?"}</span>
            <textarea className="input" rows={3} maxLength={4000} value={text.comment} onChange={(e) => setText({ ...text, comment: e.target.value })} /></label>
        </section>
      ) : (
        <>
          {page.sections?.map((s) => (
            <section key={s.key} className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <h2 className="font-display text-base font-bold">{s.label}</h2>
              {s.questions.map((q) => (
                <div key={q.code} className="space-y-2">
                  <p className="text-sm">{q.text}</p>
                  <Scale name={q.text} value={scores[q.code]} max={5} onChange={(v) => setScores({ ...scores, [q.code]: v })} />
                  {scores[q.code] != null && scores[q.code] <= limit && (
                    <textarea className="input" rows={2} maxLength={2000} required placeholder="What should we do better? (required)" aria-label={`Comment on ${q.text}`}
                      value={comments[q.code] ?? ""} onChange={(e) => setComments({ ...comments, [q.code]: e.target.value })} />
                  )}
                </div>
              ))}
            </section>
          ))}
          <section className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="font-display text-base font-bold">Overall</h2>
            <p className="text-sm">How likely are you to recommend adm Indicia to a colleague? (0 = not at all, 10 = extremely likely)</p>
            <Scale name="Recommend" value={npsScore} min={0} max={10} onChange={setNps} />
            {(["start", "continue", "stop"] as const).map((k) => (
              <label key={k} className="block"><span className="label">What should we {k === "start" ? "start doing" : k === "continue" ? "continue doing" : "stop doing"}?</span>
                <textarea className="input" rows={2} maxLength={2000} value={text[k]} onChange={(e) => setText({ ...text, [k]: e.target.value })} /></label>
            ))}
          </section>
          {page.services && page.services.length > 0 && (
            <section className="space-y-3 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <h2 className="font-display text-base font-bold">Our services</h2>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr><th className="th">Service</th><th className="th text-center">I knew you offer this</th><th className="th text-center">Tell me more</th></tr></thead>
                <tbody>{page.services.map((s) => (
                  <tr key={s.id}><td className="td">{s.name}</td>
                    <td className="td text-center"><input type="checkbox" aria-label={`Aware of ${s.name}`} checked={aware.includes(s.id)} onChange={() => toggle(aware, setAware, s.id)} /></td>
                    <td className="td text-center"><input type="checkbox" aria-label={`Interested in ${s.name}`} checked={interested.includes(s.id)} onChange={() => toggle(interested, setInterested, s.id)} /></td></tr>))}</tbody>
              </table></div>
              {page.tools && page.tools.length > 0 && (
                <fieldset><legend className="label">Which of our technology tools are most valuable to you?</legend>
                  <div className="flex flex-wrap gap-3">{page.tools.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tools.includes(t)} onChange={() => toggle(tools, setTools, t)} />{t}</label>))}</div>
                </fieldset>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={testimonial} onChange={(e) => setTestimonial(e.target.checked)} />
                I&apos;m happy to be contacted about a testimonial or case study.</label>
            </section>
          )}
        </>
      )}
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <button type="submit" disabled={pending} className={btn.primary}>{pending ? "Sending…" : "Send my answers"}</button>
    </form>
  );
}
