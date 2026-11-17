// Survey template editor text: round trip, stable question codes across versions, and validation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { countQuestions, parseTemplateText, templateToText, validateTemplate } from "../../src/lib/survey-template.ts";

const V1 = { sections: [
  { key: "strategy", label: "Strategy", questions: [{ code: "Q01", text: "We understand your business." }, { code: "Q02", text: "Our advice supports your plans." }] },
  { key: "people", label: "People", questions: [{ code: "Q03", text: "Our people are proactive." }] },
] };

test("a template round-trips through its editor text unchanged", () => {
  const text = templateToText(V1);
  assert.match(text, /^# Strategy\nQ01 \| We understand your business\.\nQ02 \|/);
  assert.deepEqual(parseTemplateText(text, V1).sections, V1.sections);
  assert.equal(countQuestions(V1), 3);
});

test("statements without a code keep the code of the same wording; new ones take the next free code", () => {
  const edited = "# Strategy\nOur advice supports your plans.\nWe understand your business.\nWe explain our thinking clearly.\n\n# People\nOur people are proactive.";
  const r = parseTemplateText(edited, V1);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.sections[0].questions, [{ code: "Q02", text: "Our advice supports your plans." }, { code: "Q01", text: "We understand your business." }, { code: "Q04", text: "We explain our thinking clearly." }]);
  assert.deepEqual(r.sections.map((s) => s.key), ["strategy", "people"]);                           // sections keep their keys
});

test("a reworded statement is a new statement; a removed one frees nothing", () => {
  const r = parseTemplateText("# Strategy\nWe really understand your business.\n# People\nOur people are proactive.", V1);
  assert.deepEqual(r.sections[0].questions[0].code, "Q04");                                           // not Q01: the old wording is gone
  assert.equal(r.sections[1].questions[0].code, "Q03");
});

test("new sections get a key; two sections with the same name get different keys", () => {
  const r = parseTemplateText("# Creativity & innovation\nWe bring new ideas.\n# Creativity & innovation\nWe challenge the brief.", undefined);
  assert.deepEqual(r.sections.map((s) => s.key), ["creativity_innovation", "creativity_innovation_2"]);
  assert.deepEqual(r.sections.flatMap((s) => s.questions.map((q) => q.code)), ["Q01", "Q02"]);
});

test("mistakes in the text are reported with the line", () => {
  assert.match(parseTemplateText("We do things.", undefined).error, /Line 1: start with a section name/);
  assert.match(parseTemplateText("# \nx", undefined).error, /Line 1: write the section name/);
  assert.match(parseTemplateText("# A\nQ01 | one\nQ01 | two", undefined).error, /Line 3: the code Q01 is used twice/);
  assert.match(parseTemplateText("# A\n" + "x".repeat(301), undefined).error, /Line 2: keep each statement/);
});

test("validation: at least one statement per section, a sensible size, and the comment threshold", () => {
  const ok = { scale: "1 = poor, 5 = excellent", comment_at_or_below: 3, sections: V1.sections, tools: [] };
  assert.equal(validateTemplate(ok), null);
  assert.match(validateTemplate({ ...ok, sections: [] }), /at least one section/);
  assert.match(validateTemplate({ ...ok, sections: [{ key: "a", label: "Empty", questions: [] }] }), /has no statements/);
  assert.match(validateTemplate({ ...ok, comment_at_or_below: 7 }), /0 to 4/);
  assert.match(validateTemplate({ ...ok, sections: [{ key: "a", label: "Big", questions: Array.from({ length: 61 }, (_, i) => ({ code: `Q${i + 1}`, text: "x" })) }] }), /at most 60/);
});
