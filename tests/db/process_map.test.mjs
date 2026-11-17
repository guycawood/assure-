// The process map must only point at steps that exist in the global process snapshot,
// and every "built" or "partly built" step must say where it is done.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { STEP_MAP } from "../../src/lib/process/step-map.ts";

const snap = JSON.parse(fs.readFileSync(new URL("../../src/lib/process/gbt-snapshot.json", import.meta.url), "utf8"));
const known = new Set(snap.processes.flatMap((p) => p.steps.map((s) => `${p.id}:${s.id}`)));

test("every mapped step exists in the process snapshot", () => {
  const missing = Object.keys(STEP_MAP).filter((k) => !known.has(k));
  assert.deepEqual(missing, []);
});

test("built and partly built steps say where they are done", () => {
  const bad = Object.entries(STEP_MAP).filter(([, m]) => (m.status === "built" || m.status === "partial") && !(m.at && m.at.length));
  assert.deepEqual(bad.map(([k]) => k), []);
});

test("partly built and not built steps say what is missing", () => {
  const bad = Object.entries(STEP_MAP).filter(([, m]) => (m.status === "partial" || m.status === "not_built") && !m.note);
  assert.deepEqual(bad.map(([k]) => k), []);
});

test("the snapshot no longer mentions retired systems", () => {
  assert.ok(!/kodiak/i.test(JSON.stringify(snap)));
});
