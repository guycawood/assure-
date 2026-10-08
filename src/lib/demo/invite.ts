import "server-only";
import { randomUUID } from "node:crypto";
import { demoDb } from "./db";

/**
 * Demo only: stand in for "the vendor clicks the email link and registers".
 * Creates (or finds) a user for the invited email so the normal sign-up trigger
 * links them to their company, exactly as a real registration would.
 */
export async function registerDemoInvitee(token: string): Promise<string | null> {
  const db = await demoDb();
  const look = await db.query<{ r: { valid: boolean; email?: string } }>("select public.lookup_vendor_invite($1) as r", [token]);
  const info = look.rows[0]?.r;
  if (!info?.valid || !info.email) return null;
  const existing = await db.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [info.email]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, info.email]);
  return id;
}
