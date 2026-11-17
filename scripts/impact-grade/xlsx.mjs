// Minimal .xlsx reader (no dependencies): unzips with node:zlib and returns each sheet's cells with their
// cached values and formulas. Enough for one-off imports of governed reference data; not a general parser.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

function unzip(buf) {
  // End of central directory: last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + size);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

/** Column letters to 1-based index. */
export const colIndex = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

/**
 * Open a workbook. `sheet(name)` returns { cells: Map<"A1", {v, f}>, get(ref), rows(fromRow, cols) }.
 * v is the cached value (number, string or boolean); f the formula text when there is one.
 */
export function openWorkbook(path) {
  const files = unzip(readFileSync(path));
  const text = (n) => files.get(n)?.toString("utf8") ?? "";
  const shared = [];
  for (const m of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  }
  const rels = text("xl/_rels/workbook.xml.rels");
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1];
    const target = /Target="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) relMap[id] = target.replace(/^\/?xl\//, "");
  }
  const sheets = {};
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = dec(/name="([^"]+)"/.exec(m[1])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[1])[1];
    sheets[name] = `xl/${relMap[rid]}`;
  }
  const cache = new Map();
  function sheet(name) {
    if (cache.has(name)) return cache.get(name);
    if (!sheets[name]) throw new Error(`No sheet "${name}"`);
    const xml = text(sheets[name]);
    const cells = new Map();
    for (const c of xml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const r = /r="([^"]+)"/.exec(attrs)?.[1];
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      const fm = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body);
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let v;
      if (t === "s") v = raw === undefined ? undefined : shared[Number(raw)];
      else if (t === "inlineStr") v = dec([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (t === "str" || t === "e") v = raw === undefined ? undefined : dec(raw);
      else if (t === "b") v = raw === "1";
      else v = raw === undefined ? undefined : Number(raw);
      if (v === undefined && !fm) continue;
      cells.set(r, { v, f: fm ? dec(fm[1]) : undefined });
    }
    const get = (ref) => cells.get(ref)?.v;
    /** Rows from `from` until the first row whose `keyCol` is empty, as objects keyed by the given column letters. */
    function rows(from, cols, keyCol = cols[0]) {
      const out = [];
      for (let r = from; ; r++) {
        if (get(`${keyCol}${r}`) === undefined || get(`${keyCol}${r}`) === "") {
          // allow short gaps: stop after 3 empty key cells in a row
          if ([1, 2, 3].every((k) => get(`${keyCol}${r + k}`) === undefined)) break;
          continue;
        }
        const o = { _row: r };
        for (const c of cols) o[c] = get(`${c}${r}`);
        out.push(o);
      }
      return out;
    }
    const s = { cells, get, rows };
    cache.set(name, s);
    return s;
  }
  return { sheet, sheetNames: Object.keys(sheets) };
}
