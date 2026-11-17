// Reading and writing the savings file as CSV. Handles a leading BOM, comma, semicolon or tab separators, quoted cells with embedded
// separators, quotes and line breaks, and blank lines. The header row is kept exactly as written because the client's column map names it.

export type Table = { headers: string[]; rows: Record<string, unknown>[] };

function sniff(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0][0] : ",";
}

export function parseTable(text: string): Table {
  const src = text.replace(/^﻿/, "");
  const sep = sniff(src.split(/\r?\n/, 1)[0] ?? "");
  const grid: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) grid.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) grid.push(row);
  if (grid.length === 0) return { headers: [], rows: [] };
  return gridToTable(grid);
}

/** Headings made unique: a blank or repeated heading would collide as an object key. */
function uniqueHeaders(row: unknown[]): string[] {
  const seen = new Map<string, number>();
  return row.map((h, i) => {
    const base = (h instanceof Date ? h.toISOString().slice(0, 10) : String(h ?? "")).trim() || `Column ${i + 1}`, n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

const blankCell = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Turn rows of cells (from a CSV or a spreadsheet sheet) into a table. The first row that has anything in it is the heading row; rows that are
 * entirely empty are dropped. Spreadsheet cells keep their type (numbers, dates, yes/no) so the checks read them as they were typed.
 */
export function gridToTable(grid: unknown[][]): Table {
  const start = grid.findIndex((r) => r.some((c) => !blankCell(c)));
  if (start < 0) return { headers: [], rows: [] };
  const headers = uniqueHeaders(grid[start]);
  const rows = grid.slice(start + 1).filter((r) => r.some((c) => !blankCell(c))).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows };
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? (Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10)) : String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Comma-separated text with a BOM so Excel opens it as UTF-8. Cell order follows the headers. */
export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return "﻿" + [headers.map(esc).join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n") + "\r\n";
}
