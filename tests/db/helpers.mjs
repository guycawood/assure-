// Shared PGlite harness for module DB tests. Each test file builds its own database:
//   const t = await setupDb();           // migrations applied, standard users created
//   await t.as("admin", "select ...");   // run as a user (RLS applies)
//   await t.asSuper("insert ...");       // bypass RLS for fixtures
//   await t.rejects(promise, /message/);
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export const ids = {
  admin: "00000000-0000-0000-0000-00000000000a",
  admin2: "00000000-0000-0000-0000-00000000000b",
  agent: "00000000-0000-0000-0000-0000000000a1",
  lead: "00000000-0000-0000-0000-0000000000a2",
  finance: "00000000-0000-0000-0000-0000000000a3",
  plain: "00000000-0000-0000-0000-0000000000a4",
  head: "00000000-0000-0000-0000-0000000000a5",
};

export async function setupDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const users = [
    [ids.admin, "admin@adm-indicia.com"], [ids.admin2, "admin2@adm-indicia.com"], [ids.agent, "agent@adm-indicia.com"],
    [ids.lead, "lead@adm-indicia.com"], [ids.finance, "finance@adm-indicia.com"], [ids.plain, "staff@adm-indicia.com"],
    [ids.head, "head@adm-indicia.com"],
  ];
  for (const [id, email] of users) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  await db.query("update public.profiles set is_admin = true where id = any($1)", [[ids.admin, ids.admin2]]);
  await db.query("update public.profiles set srt_role = 'agent' where id = $1", [ids.agent]);
  await db.query("update public.profiles set srt_role = 'lead' where id = $1", [ids.lead]);
  await db.query("update public.profiles set srt_role = 'finance' where id = $1", [ids.finance]);
  await db.query("update public.profiles set srt_role = 'head' where id = $1", [ids.head]);

  async function asSuper(sql, params) {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    return db.query(sql, params);
  }
  async function as(user, sql, params) {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ids[user] ?? user}', false); set role authenticated;`);
    try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
  }
  async function rejects(promise, pattern) {
    await assert.rejects(promise, (e) => pattern.test(e.message), `expected error matching ${pattern}`);
  }
  return { db, as, asSuper, rejects, ids };
}
