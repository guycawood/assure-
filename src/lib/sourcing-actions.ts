import "server-only";

// Shared helpers for Sourcing+, RFQ+ and Order Management+ server actions.
export type FormResult = { ok?: boolean; error?: string; message?: string };

/** Messages raised by our own SQL functions are written for users; anything else gets a generic message. */
export function friendly(error: { message: string; code?: string } | null | undefined, fallback = "That didn't save. Try again."): string | undefined {
  if (!error) return undefined;
  if (/permission denied|row-level security/i.test(error.message)) return "You don't have permission to do that.";
  if (error.code === "P0001" || error.code === "42501") return error.message;
  if (error.code === "23505") return "That already exists.";
  if (error.code === "23514") return "One of the values isn't allowed. Check the numbers and try again.";
  return fallback;
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
export const numOrNull = (fd: FormData, k: string) => {
  const s = str(fd, k);
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const id = (fd: FormData, k = "id") => {
  const s = str(fd, k);
  return s && UUID.test(s) ? s : null;
};
/** "1000, 2 500; 5000" -> [1000, 2500, 5000] */
export const numberList = (s: string | null) =>
  (s ?? "").split(/[,;\n]+/).map((x) => x.trim().replace(/\s/g, "")).filter(Boolean).map(Number);
