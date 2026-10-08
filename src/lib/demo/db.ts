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

  // Client Portal: Claire Martin approves for the Heineken (demo) account; Lena manages its jobs (gets client decisions).
  const client = DEMO_USERS.find((u) => u.role === "Client");
  if (client) {
    await db.query("update public.profiles set user_type = 'client' where id = $1", [client.id]);
    await db.query(
      "insert into public.client_users (user_id, client_id, role, granted_by) select $1, id, 'approver', $2 from public.sourcing_clients where code = 'HNK' on conflict do nothing",
      [client.id, admin.id],
    );
    await db.query("update public.jobs set manager = $1 where manager is null and client_id = (select id from public.sourcing_clients where code = 'HNK')", [lead.id]);
    await db.query(
      "insert into public.client_comments (brief_id, client_id, body, author, created_at) select b.id, b.client_id, $2, $1, now() - interval '2 days' from public.briefs b where b.brief_code = 'BR-2026-00001' and b.client_id is not null",
      [client.id, "Could the header carry the 0.0 pack shot as well as the tournament creative?"],
    );
  }
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
