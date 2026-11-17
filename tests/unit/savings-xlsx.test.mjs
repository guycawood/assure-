// Excel workbooks (.xlsx) in the savings check: a real workbook is built here, read back, turned into a check table and run through the engine.
import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { pickSheet, readWorkbook } from "../../src/lib/savings-check/xlsx.ts";
import { gridToTable, toCsv } from "../../src/lib/savings-check/file.ts";
import { runChecks, annotate, normaliseRow } from "../../src/lib/savings-check/engine.ts";
import { buildRules } from "../../src/lib/savings-check/templates.ts";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

// Shared strings so the workbook looks like one Excel saved.
const strings = ["Note", "Cover sheet only", "Job", "Buy price", "Bill closed date", "Premium?", "JOB-1", "JOB-2"];
const s = (text) => strings.indexOf(text);
const sheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8"?><worksheet ${NS}><sheetData>${rows.map((cells, r) => `<row r="${r + 1}">${cells.map((c, i) => {
  const ref = String.fromCharCode(65 + i) + (r + 1);
  if (c === null) return "";
  if (typeof c === "string") return `<c r="${ref}" t="s"><v>${s(c)}</v></c>`;
  if (typeof c === "boolean") return `<c r="${ref}" t="b"><v>${c ? 1 : 0}</v></c>`;
  if (c && c.date) return `<c r="${ref}" s="1"><v>${c.date}</v></c>`;
  return `<c r="${ref}"><v>${c}</v></c>`;
}).join("")}</row>`).join("")}</sheetData></worksheet>`;

function workbook() {
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cover" sheetId="1" r:id="rId1"/><sheet name="Savings" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><styleSheet ${NS}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst ${NS} count="${strings.length}" uniqueCount="${strings.length}">${strings.map((x) => `<si><t>${x}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": sheetXml([["Note"], ["Cover sheet only"]]).replace("<row r=\"2\">", "<row r=\"2\">").replace("Cover sheet only", "Cover sheet only"),
    "xl/worksheets/sheet2.xml": sheetXml([
      [null, null, null, null],                                              // a blank row above the headings, as many exported sheets have
      ["Job", "Buy price", "Bill closed date", "Premium?"],
      ["JOB-1", 100, { date: serial(2026, 8, 15) }, true],
      ["JOB-2", 0, { date: serial(2026, 3, 1) }, false],
    ]),
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

test("a workbook is read sheet by sheet, with typed cells", async () => {
  const sheets = await readWorkbook(workbook());
  assert.deepEqual(sheets.map((x) => x.sheet), ["Cover", "Savings"]);
  const data = sheets[1].data.filter((r) => r.some((c) => c !== null));
  assert.deepEqual(data[0], ["Job", "Buy price", "Bill closed date", "Premium?"]);
  assert.deepEqual([data[1][0], data[1][1], data[1][3]], ["JOB-1", 100, true]);
  assert.ok(data[1][2] instanceof Date);
  assert.equal(data[1][2].toISOString().slice(0, 10), "2026-08-15");
});

test("the sheet to check is the one named, else the first with data; a missing name lists the real ones", async () => {
  const sheets = await readWorkbook(workbook());
  assert.equal(pickSheet(sheets).sheet.sheet, "Savings");                                      // the data sheet has more rows than the cover
  assert.equal(pickSheet(sheets, "savings").sheet.sheet, "Savings");                            // case does not matter
  assert.match(pickSheet(sheets, "Totals").error, /no sheet called "Totals".*Cover, Savings/);
  assert.match(pickSheet([{ sheet: "Empty", data: [] }]).error, /No sheet/);
});

test("a sheet becomes a table (blank rows above the headings skipped) and runs through the rules like a CSV", async () => {
  const sheets = await readWorkbook(workbook());
  const table = gridToTable(pickSheet(sheets).sheet.data);
  assert.deepEqual(table.headers, ["Job", "Buy price", "Bill closed date", "Premium?"]);
  assert.equal(table.rows.length, 2);
  const map = { job_ref: "Job", buy_price: "Buy price", closed_date: "Bill closed date", premium_flag: "Premium?" };
  const res = runChecks(table.rows, { column_map: map, rules: buildRules("required_fields", { fields: ["job_ref"], nonzero: ["buy_price"] }) });
  assert.deepEqual(res.rows.map((r) => r.approval), ["pass", "issue"]);                         // JOB-2 has a zero buy price
  const read = normaliseRow(table.rows[0], { column_map: map });
  assert.deepEqual([read.buy_price, read.closed_date, read.premium_flag], [100, "2026-08-15", true]);   // typed numbers, dates and yes/no are read as such
  const before = runChecks(table.rows, { column_map: map, rules: buildRules("hold_period", { to: "2026-06-30" }) });
  assert.deepEqual(before.rows.map((r) => r.approval), ["pass", "hold"]);                       // a spreadsheet date falls in the right period
  const csv = toCsv([...table.headers, "Check approval", "Check comments"], annotate(table.rows, res.rows));
  assert.match(csv, /JOB-1,100,2026-08-15,TRUE|JOB-1,100,2026-08-15,true/i);                    // dates are written as dates
  assert.match(csv, /JOB-2,0,2026-03-01,.*Issue/);
});

test("an empty or unreadable workbook is refused with a clear error", async () => {
  await assert.rejects(readWorkbook(new Uint8Array([1, 2, 3, 4])));
  assert.deepEqual(gridToTable([[], [null, ""]]), { headers: [], rows: [] });
});
