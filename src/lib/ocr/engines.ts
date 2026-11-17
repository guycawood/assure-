import "server-only";
import { inflateSync } from "node:zlib";

// Reads the text out of an uploaded file. OCR_ENGINE chooses how:
//   builtin (default): plain text files and PDFs that carry real text. No account needed. Scans and photos cannot be read, which the checks report.
//   azure: Azure AI Document Intelligence (prebuilt-read) for PDFs, scans and photos. Needs AZURE_DI_ENDPOINT and AZURE_DI_KEY.
export type ReadResult = { ok: true; text: string; engine: string } | { ok: false; error: string; permanent: boolean; engine: string };
type Input = { bytes: Buffer; contentType: string; fileName: string };

export const engineName = () => (process.env.OCR_ENGINE === "azure" ? "azure" : "builtin");

export async function readFileText(i: Input): Promise<ReadResult> {
  return engineName() === "azure" ? readAzure(i) : readBuiltin(i);
}

// ---------------------------------------------------------------------------
// Built in
// ---------------------------------------------------------------------------
function unescapePdf(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, g: string) => {
    if (g === "n" || g === "r") return " ";
    if (g === "t") return " ";
    if (g === "b" || g === "f") return "";
    if (/^[0-7]+$/.test(g)) return String.fromCharCode(parseInt(g, 8));
    return g;
  });
}

/** Pull the shown text out of a PDF's content streams (Tj and TJ operators). Works for ordinary text PDFs, not for scans or fonts without a text map. */
export function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const chunks: string[] = [raw];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length, end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try { chunks.push(inflateSync(buf.subarray(start, end)).toString("latin1")); } catch { /* not a Flate stream */ }
    re.lastIndex = end;
  }
  const out: string[] = [];
  for (const c of chunks) {
    for (const t of c.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) out.push(unescapePdf(t[1]));
    for (const arr of c.matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
      out.push([...arr[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((x) => unescapePdf(x[1])).join(""));
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

async function readBuiltin({ bytes, contentType, fileName }: Input): Promise<ReadResult> {
  const engine = "builtin";
  if (/^text\//.test(contentType) || /\.(txt|csv|md)$/i.test(fileName)) return { ok: true, text: bytes.toString("utf8"), engine };
  if (contentType === "application/pdf" || /\.pdf$/i.test(fileName)) return { ok: true, text: pdfText(bytes), engine };
  if (/^image\//.test(contentType)) return { ok: false, error: "This is a picture. Reading pictures needs the OCR service (OCR_ENGINE=azure).", permanent: true, engine };
  return { ok: false, error: `Cannot read ${contentType || "this file type"}.`, permanent: true, engine };
}

// ---------------------------------------------------------------------------
// Azure AI Document Intelligence
// ---------------------------------------------------------------------------
async function readAzure({ bytes, contentType }: Input): Promise<ReadResult> {
  const engine = "azure";
  const endpoint = process.env.AZURE_DI_ENDPOINT?.replace(/\/$/, ""), key = process.env.AZURE_DI_KEY;
  if (!endpoint || !key) return { ok: false, error: "The OCR service is not configured (AZURE_DI_ENDPOINT, AZURE_DI_KEY).", permanent: true, engine };
  try {
    const start = await fetch(`${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`, {
      method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": contentType || "application/octet-stream" }, body: new Uint8Array(bytes) });
    if (start.status !== 202) {
      const msg = ((await start.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `OCR service returned ${start.status}`;
      return { ok: false, error: msg, permanent: !(start.status === 429 || start.status >= 500), engine };
    }
    const op = start.headers.get("operation-location");
    if (!op) return { ok: false, error: "The OCR service gave no result address.", permanent: false, engine };
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(op, { headers: { "Ocp-Apim-Subscription-Key": key } });
      const j = (await res.json()) as { status?: string; analyzeResult?: { content?: string }; error?: { message?: string } };
      if (j.status === "succeeded") return { ok: true, text: j.analyzeResult?.content ?? "", engine };
      if (j.status === "failed") return { ok: false, error: j.error?.message ?? "The OCR service could not read the file.", permanent: true, engine };
    }
    return { ok: false, error: "The OCR service took too long.", permanent: false, engine };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error", permanent: false, engine };
  }
}
