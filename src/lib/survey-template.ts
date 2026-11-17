// Survey template editing. A template is sections of statements scored 1 to 5, a comment threshold, a scale caption and a list of tools.
// People edit it as plain text; this turns the text into the stored shape and keeps question codes stable so answers from earlier waves
// still line up with the same statement. No relative imports: it runs in the app and in plain Node tests.

export type SurveyQuestion = { code: string; text: string };
export type SurveySection = { key: string; label: string; questions: SurveyQuestion[] };
export type SurveyTemplate = { scale: string; comment_at_or_below: number; sections: SurveySection[]; tools: string[] };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "section";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const CODE_LINE = /^(Q\d{2,3})\s*\|\s*(.+)$/i;

/** The editor text: a "# Section" line, then one statement per line as "Q01 | statement". */
export function templateToText(t: Pick<SurveyTemplate, "sections">): string {
  return t.sections.map((s) => [`# ${s.label}`, ...s.questions.map((q) => `${q.code} | ${q.text}`)].join("\n")).join("\n\n");
}

export type ParseResult = { sections: SurveySection[]; error?: string };

/**
 * Read the editor text. A line "Q07 | text" keeps its code; a line with only text takes the code of the same wording in the previous version,
 * or the next free one. A section keeps its key when its label is unchanged.
 */
export function parseTemplateText(text: string, previous?: Pick<SurveyTemplate, "sections">): ParseResult {
  const prevQ = (previous?.sections ?? []).flatMap((s) => s.questions);
  const prevS = previous?.sections ?? [];
  const used = new Set<string>();
  let max = Math.max(0, ...prevQ.map((q) => Number(q.code.replace(/\D/g, "")) || 0));
  const sections: SurveySection[] = [];
  const keys = new Set<string>();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pending: { line: string; at: number }[] = [];
  let cur: SurveySection | null = null;
  for (const [i, line] of lines.entries()) {
    if (line.startsWith("#")) {
      const label = line.replace(/^#+\s*/, "").trim();
      if (!label) return { sections: [], error: `Line ${i + 1}: write the section name after #` };
      const old = prevS.find((s) => same(s.label, label));
      let key = old?.key ?? slug(label);
      for (let n = 2; keys.has(key); n++) key = `${slug(label)}_${n}`;
      keys.add(key);
      cur = { key, label, questions: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) return { sections: [], error: `Line ${i + 1}: start with a section name, for example # Strategy` };
    const m = line.match(CODE_LINE);
    const qText = (m ? m[2] : line).trim();
    if (qText.length > 300) return { sections: [], error: `Line ${i + 1}: keep each statement to 300 characters` };
    if (m) {
      const code = m[1].toUpperCase();
      if (used.has(code)) return { sections: [], error: `Line ${i + 1}: the code ${code} is used twice` };
      used.add(code);
      max = Math.max(max, Number(code.replace(/\D/g, "")));
      cur.questions.push({ code, text: qText });
    } else {
      cur.questions.push({ code: "", text: qText });
      pending.push({ line: qText, at: sections.length - 1 });
    }
  }
  // Statements written without a code: reuse the code of the same wording in the previous version, else take the next free one.
  for (const s of sections) for (const q of s.questions) {
    if (q.code) continue;
    const old = prevQ.find((p) => same(p.text, q.text) && !used.has(p.code));
    if (old) { q.code = old.code; used.add(old.code); continue; }
    do { max++; } while (used.has(`Q${String(max).padStart(2, "0")}`));
    q.code = `Q${String(max).padStart(2, "0")}`;
    used.add(q.code);
  }
  return { sections };
}

export function validateTemplate(t: SurveyTemplate): string | null {
  if (t.sections.length === 0) return "Add at least one section.";
  if (t.sections.length > 20) return "A survey can have at most 20 sections.";
  const total = t.sections.reduce((n, s) => n + s.questions.length, 0);
  for (const s of t.sections) {
    if (s.label.length > 80) return `Keep the section name "${s.label.slice(0, 20)}…" to 80 characters.`;
    if (s.questions.length === 0) return `The section "${s.label}" has no statements.`;
  }
  if (total > 60) return "A survey can have at most 60 statements. People stop answering long surveys.";
  if (!Number.isInteger(t.comment_at_or_below) || t.comment_at_or_below < 0 || t.comment_at_or_below > 4) return "Ask for a comment at a score of 0 to 4 or lower (0 means never).";
  if (t.scale.length > 80) return "Keep the scale caption short.";
  if (t.tools.length > 12) return "List at most 12 tools.";
  return null;
}

export const countQuestions = (t: Pick<SurveyTemplate, "sections">) => t.sections.reduce((n, s) => n + s.questions.length, 0);
