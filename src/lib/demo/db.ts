import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_USERS } from "./config";

// Demo database: the same SQL as production (Postgres with all rules), running in-process on PGlite.
// It is kept on disk in .demo-data/pg so everything recorded survives restarts, and every table is mirrored
// to .demo-data/csv/<table>.csv a few seconds after any change, so the data can be opened in Excel.
// New migrations and seed files are applied automatically on start. DEMO_PERSIST=0 keeps it in memory only.

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

const repoRoot = () => process.env.ASSURE_ROOT || process.cwd();
export const dataDir = () => process.env.DEMO_DATA_DIR || join(repoRoot(), ".demo-data");
export const csvDir = () => join(dataDir(), "csv");
const pgDir = () => join(dataDir(), "pg");
const persist = () => process.env.DEMO_PERSIST !== "0";

const sqlFiles = (folder: string) => readdirSync(join(repoRoot(), "supabase", folder)).filter((f) => f.endsWith(".sql")).sort();
const readSql = (folder: string, f: string) => readFileSync(join(repoRoot(), "supabase", folder, f), "utf8");

/** Demo users and the wiring that makes the queues look lived-in. Runs once, when the database is first created. */
async function wireDemoUsers(db: PGlite) {
  for (const u of DEMO_USERS) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict (id) do nothing", [u.id, u.email, JSON.stringify({ full_name: u.name })]);
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
}

async function freshBuild(db: PGlite) {
  await db.exec(SUPABASE_STUBS);
  await db.exec("create schema demo_meta; create table demo_meta.applied (kind text, name text, at timestamptz default now(), primary key (kind, name));");
  for (const f of sqlFiles("migrations")) {
    await db.exec(readSql("migrations", f));
    await db.query("insert into demo_meta.applied (kind, name) values ('migration', $1)", [f]);
  }
  // Every seed file, in name order (demo_data.sql first, then one file per module).
  for (const f of sqlFiles("seed")) {
    await db.exec(readSql("seed", f));
    await db.query("insert into demo_meta.applied (kind, name) values ('seed', $1)", [f]);
  }
  await wireDemoUsers(db);
}

/** Existing on-disk database: apply only migrations and seeds added since it was created. */
async function catchUp(db: PGlite) {
  const { rows } = await db.query<{ kind: string; name: string }>("select kind, name from demo_meta.applied");
  const done = new Set(rows.map((r) => `${r.kind}:${r.name}`));
  for (const kind of ["migration", "seed"] as const) {
    for (const f of sqlFiles(kind === "migration" ? "migrations" : "seed")) {
      if (done.has(`${kind}:${f}`)) continue;
      try {
        await db.exec(readSql(kind === "migration" ? "migrations" : "seed", f));
        await db.query("insert into demo_meta.applied (kind, name) values ($1, $2)", [kind, f]);
        console.log(`[demo db] applied new ${kind} ${f}`);
      } catch (e) {
        console.error(`[demo db] could not apply ${kind} ${f}: ${(e as Error).message}. Use "Reset demo data" in Watchtower → Data management.`);
        if (kind === "migration") throw e;
      }
    }
  }
  // Demo users added to config since the database was created.
  for (const u of DEMO_USERS) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict (id) do nothing", [u.id, u.email, JSON.stringify({ full_name: u.name })]);
  }
}

async function build(): Promise<PGlite> {
  if (!persist()) {
    const db = new PGlite();
    await freshBuild(db);
    return db;
  }
  mkdirSync(dataDir(), { recursive: true });
  const db = new PGlite(pgDir());
  const { rows } = await db.query<{ t: string | null }>("select to_regclass('demo_meta.applied')::text as t");
  if (!rows[0]?.t) {
    console.log(`[demo db] creating a new demo database in ${pgDir()}`);
    await freshBuild(db);
  } else {
    await catchUp(db);
  }
  void writeCsvSnapshot(db);
  return db;
}

const g = globalThis as unknown as { __assureDemoDb?: Promise<PGlite>; __assureCsvTimer?: ReturnType<typeof setTimeout>; __assureCsvAt?: string };

/** One database per server process; kept on disk so it survives restarts. */
export function demoDb(): Promise<PGlite> {
  if (!g.__assureDemoDb) {
    g.__assureDemoDb = build().catch((e) => {
      g.__assureDemoDb = undefined;
      throw e;
    });
  }
  return g.__assureDemoDb;
}

// ---------------------------------------------------------------------------
// CSV mirror
// ---------------------------------------------------------------------------
const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : v instanceof Uint8Array ? `<${v.byteLength} bytes>` : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function listTables(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1");
  return rows.map((r) => r.t);
}

/** Write every public table to .demo-data/csv/<table>.csv (read as the database owner, so nothing is hidden). */
export async function writeCsvSnapshot(db?: PGlite): Promise<{ tables: number; dir: string }> {
  if (!persist()) return { tables: 0, dir: "" };
  const d = db ?? (await demoDb());
  mkdirSync(csvDir(), { recursive: true });
  const tables = await listTables(d);
  for (const t of tables) {
    const res = await d.query<Record<string, unknown>>(`select * from public."${t.replace(/"/g, "")}"`);
    const cols = res.fields.map((f) => f.name);
    const lines = [cols.join(","), ...res.rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))];
    writeFileSync(join(csvDir(), `${t}.csv`), "﻿" + lines.join("\r\n"), "utf8");
  }
  g.__assureCsvAt = new Date().toISOString();
  writeFileSync(join(csvDir(), "_README.txt"), `System Guy demo data, mirrored from the demo database.\r\nLast written: ${g.__assureCsvAt}\r\nEdit a file and use Watchtower > Data management > Load CSV to bring changes back in.\r\n`, "utf8");
  return { tables: tables.length, dir: csvDir() };
}

/** Called after any write; mirrors to CSV a few seconds later (batched). */
export function scheduleCsvSnapshot() {
  if (!persist()) return;
  if (g.__assureCsvTimer) clearTimeout(g.__assureCsvTimer);
  g.__assureCsvTimer = setTimeout(() => {
    writeCsvSnapshot().catch((e) => console.error("[demo db] CSV mirror failed:", (e as Error).message));
  }, 3000);
}

export const lastCsvSnapshot = () => g.__assureCsvAt ?? null;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/**
 * Load a table's CSV back in: rows are inserted, or updated by primary key. Runs as the database owner, so table
 * triggers and constraints apply but row-level security does not; admins only (checked by the caller). All or nothing.
 */
export async function loadCsv(table: string): Promise<{ rows: number }> {
  const db = await demoDb();
  const tables = await listTables(db);
  if (!tables.includes(table)) throw new Error(`Unknown table ${table}`);
  const file = join(csvDir(), `${table}.csv`);
  if (!existsSync(file)) throw new Error(`No CSV file for ${table} yet. Export first.`);
  const grid = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
  const head = grid[0] ?? [];
  const { rows: pkRows } = await db.query<{ c: string }>(
    `select a.attname as c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = ('public."' || $1 || '"')::regclass and i.indisprimary`, [table]);
  const pk = pkRows.map((r) => r.c);
  const { rows: colRows } = await db.query<{ c: string; generated: string; dt: string }>(
    "select column_name as c, is_generated as generated, data_type as dt from information_schema.columns where table_schema = 'public' and table_name = $1", [table]);
  // Generated and binary columns (file contents) are never loaded from CSV.
  const writable = new Set(colRows.filter((r) => r.generated !== "ALWAYS" && r.dt !== "bytea").map((r) => r.c));
  const cols = head.filter((h) => writable.has(h));
  if (!pk.length) throw new Error(`${table} has no primary key; it can't be loaded from CSV.`);
  const q = (c: string) => `"${c.replace(/"/g, "")}"`;
  const updates = cols.filter((c) => !pk.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`);
  const sql = `insert into public.${q(table)} (${cols.map(q).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
    on conflict (${pk.map(q).join(", ")}) do ${updates.length ? `update set ${updates.join(", ")}` : "nothing"}`;
  let n = 0;
  await db.transaction(async (tx) => {
    await tx.query("select set_config('assure.system_write', 'on', true)");
    for (const r of grid.slice(1)) {
      const vals = cols.map((c) => { const v = r[head.indexOf(c)]; return v === undefined || v === "" || /^<\d+ bytes>$/.test(v) ? null : v; });
      await tx.query(sql, vals);
      n++;
    }
  });
  scheduleCsvSnapshot();
  return { rows: n };
}

/** Throw away the demo database and CSVs; the next request rebuilds from migrations and seeds. */
export async function resetDemoDb() {
  if (g.__assureDemoDb) {
    try { await (await g.__assureDemoDb).close(); } catch { /* already closed */ }
  }
  g.__assureDemoDb = undefined;
  if (persist()) rmSync(dataDir(), { recursive: true, force: true });
  await demoDb();
}
