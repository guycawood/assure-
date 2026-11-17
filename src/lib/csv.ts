// A small CSV reader for imports (quotes, commas inside quotes, doubled quotes, CRLF, a leading BOM, and comma, semicolon or tab separators).
// Exporting from Excel as "CSV UTF-8" gives a file this reads as is.

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Rows as objects. Header names are lower-cased with spaces and dashes turned into underscores; `aliases` maps other spellings to the expected names. */
export function csvObjects(text: string, aliases: Record<string, string> = {}): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const norm = (h: string) => h.trim().toLowerCase().replace(/[\s\-/]+/g, "_").replace(/[^a-z0-9_]/g, "");
  const head = rows[0].map((h) => { const n = norm(h); return aliases[n] ?? n; });
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export const ITEM_ALIASES: Record<string, string> = {
  producttype: "product_type", type: "product_type", clt_code: "product_code", clt_code_2026: "product_code", code: "product_code", client_code: "product_code",
  sub_code: "subcode", sub: "subcode", spec: "spec_detail", spec_detail: "spec_detail", unit: "uom", uom_sh: "uom", min: "qty_min", max: "qty_max",
  qty_range_min: "qty_min", qty_range_max: "qty_max", baseline: "baseline_price", baseline_sell_unit_price: "baseline_price", price_2025: "baseline_price",
  baseline_volume: "baseline_qty", qty_2025: "baseline_qty", saving_method: "baseline_match", baseline_sell_unit_price_converted: "baseline_price",
  baseline_converted_qty: "baseline_qty", cat: "category", channel_: "channel", metho_saving_last_updated: "baseline_match",
};
export const BID_ALIASES: Record<string, string> = {
  sub_code: "subcode", item: "subcode", vendor: "supplier", supplier_name: "supplier", unit_price: "price", bid: "price",
};

export const ITEM_TEMPLATE = "product_type,product_code,subcode,channel,category,spec_detail,uom,qty_min,qty_max,baseline_price,baseline_match,baseline_qty\n" +
  "Banner,CLT32001_V26,CLT32001_V26_R1,DT,Print,\"Aluminium panel 3-4mm with printed PP sticker\",SQCM,300,9999,105.77,PY,1000\n" +
  "Banner,CLT32001_V26,CLT32001_V26_R2,DT,Print,\"Aluminium panel 3-4mm with printed PP sticker\",SQCM,10000,49999,131.05,Similar,500\n";
export const BID_TEMPLATE = "subcode,supplier,price,note\nCLT32001_V26_R1,Supplier A,80,\nCLT32001_V26_R1,Supplier B,85,\nCLT32001_V26_R2,Supplier A,73,\n";
