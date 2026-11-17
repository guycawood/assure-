// Reading an Excel workbook (.xlsx) into rows of cells, one list per sheet. The conversion into the check table is gridToTable in file.ts.
// Older .xls and .xlsb files are binary formats this reader does not handle; the person is asked to save as .xlsx or CSV.
import readExcelFile from "read-excel-file/node";

export type SheetGrid = { sheet: string; data: unknown[][] };

export async function readWorkbook(bytes: Uint8Array): Promise<SheetGrid[]> {
  const sheets = (await readExcelFile(Buffer.from(bytes))) as { sheet: string; data: unknown[][] }[];
  return sheets.map((s) => ({ sheet: s.sheet, data: s.data }));
}

/** The sheet to check: the one named, else the one with the most rows (it needs at least a heading row and one line of data). */
export function pickSheet(sheets: SheetGrid[], wanted?: string | null): { sheet: SheetGrid } | { error: string } {
  const names = sheets.map((s) => s.sheet);
  if (wanted && wanted.trim()) {
    const found = sheets.find((s) => s.sheet.trim().toLowerCase() === wanted.trim().toLowerCase());
    return found ? { sheet: found } : { error: `There is no sheet called "${wanted.trim()}". The sheets in this file are: ${names.join(", ") || "none"}.` };
  }
  // Cover and notes sheets are short; the data sheet is the one with the most filled rows.
  const filled = (s: SheetGrid) => s.data.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== "")).length;
  const best = sheets.reduce<SheetGrid | null>((b, s) => (filled(s) > (b ? filled(b) : 0) ? s : b), null);
  return best && filled(best) >= 2 ? { sheet: best } : { error: "No sheet in this file has a heading row and lines of data." };
}
