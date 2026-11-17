// Reading and writing the savings file as CSV.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTable, toCsv } from "../../src/lib/savings-check/file.ts";

test("commas, semicolons and tabs are detected; a BOM and blank lines are ignored", () => {
  assert.deepEqual(parseTable("﻿A,B\r\n1,2\r\n\r\n3,4\r\n").rows, [{ A: "1", B: "2" }, { A: "3", B: "4" }]);
  assert.deepEqual(parseTable("A;B\n1;2").rows, [{ A: "1", B: "2" }]);
  assert.deepEqual(parseTable("A\tB\n1\t2").rows, [{ A: "1", B: "2" }]);
  assert.deepEqual(parseTable("").headers, []);
});

test("quoted cells keep separators, quotes and line breaks", () => {
  const t = parseTable('Name,Note\n"Smith, J","He said ""hi"""\n"Two\nlines",x');
  assert.deepEqual(t.rows, [{ Name: "Smith, J", Note: 'He said "hi"' }, { Name: "Two\nlines", Note: "x" }]);
});

test("short rows are padded; blank and repeated headers get unique names", () => {
  const t = parseTable("A,,A\n1,2,3\n4");
  assert.deepEqual(t.headers, ["A", "Column 2", "A (2)"]);
  assert.deepEqual(t.rows[1], { A: "4", "Column 2": "", "A (2)": "" });
});

test("writing a table back escapes what needs it and round-trips", () => {
  const headers = ["Name", "Note"];
  const rows = [{ Name: "Smith, J", Note: 'say "hi"' }, { Name: "Plain", Note: "" }];
  const csv = toCsv(headers, rows);
  assert.ok(csv.startsWith("﻿Name,Note\r\n"));
  assert.deepEqual(parseTable(csv).rows, rows);
});
