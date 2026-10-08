import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEMO_USERS } from "./config";

// Minimal stand-in for the parts of Supabase the migrations rely on.
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

async function build(): Promise<PGlite> {
  const db = new PGlite();
  const root = join(process.env.ASSURE_ROOT || process.cwd(), "supabase");
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  }
  // Every seed file, in name order (demo_data.sql first, then one file per module).
  for (const f of readdirSync(join(root, "seed")).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(root, "seed", f), "utf8"));
  }

  // Demo users (after the seed, so the vendor links to DEMO-001 by email).
  for (const u of DEMO_USERS) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [u.id, u.email, JSON.stringify({ full_name: u.name })]);
  }
  const [admin, lead, agent, finance, procurement, head] = DEMO_USERS;
  await db.query("update public.profiles set srt_role = 'head' where id = $1", [head.id]);
  await db.query("update public.profiles set is_admin = true where id = $1", [admin.id]);
  await db.query("update public.profiles set srt_role = 'lead' where id = $1", [lead.id]);
  await db.query("update public.profiles set srt_role = 'agent' where id = $1", [agent.id]);
  await db.query("update public.profiles set srt_role = 'finance' where id = $1", [finance.id]);
  await db.query("update public.profiles set srt_role = 'procurement' where id = $1", [procurement.id]);

  // Lena governs Assure+ libraries; Pedro raised the sample change request.
  await db.query("insert into public.module_owners (module, user_id) values ('assure', $1) on conflict do nothing", [lead.id]);
  await db.query("update public.change_requests set requested_by = $1 where requested_by is null", [procurement.id]);

  // Spread ownership and assignments so the queues look lived-in.
  await db.query(
    `update public.suppliers set
       srt_owner = case when right(supplier_code, 1)::int % 2 = 0 then $1::uuid else $2::uuid end,
       procurement_owner = $3::uuid
     where supplier_code like 'DEMO-%'`,
    [agent.id, lead.id, procurement.id],
  );
  await db.query(
    `update public.srt_tickets set
       assignee = case when type = 'bank_change' then $3::uuid
                       when status = 'new' then null
                       when ticket_no % 3 = 0 then $2::uuid else $1::uuid end,
       owner = $4::uuid,
       created_by = $4::uuid
     where source_ref = 'demo'`,
    [agent.id, lead.id, finance.id, procurement.id],
  );
  return db;
}

const g = globalThis as unknown as { __assureDemoDb?: Promise<PGlite> };

/** One database per server process; survives hot reloads, resets on restart. */
export function demoDb(): Promise<PGlite> {
  if (!g.__assureDemoDb) {
    g.__assureDemoDb = build().catch((e) => {
      g.__assureDemoDb = undefined;
      throw e;
    });
  }
  return g.__assureDemoDb;
}
