import "server-only";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { demoDb } from "./db";
import { DEMO_USERS } from "./config";

// A small stand-in for the subset of supabase-js this app uses. Every query runs
// as the signed-in demo user under the real row-level security policies.

type Filter = { sql: string; params: unknown[] };
type Result<T = unknown> = { data: T | null; error: { message: string; code?: string } | null; count?: number | null };

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string) => {
  const t = s.trim();
  if (!IDENT.test(t)) throw new Error(`Unsupported identifier: ${s}`);
  return `"${t}"`;
};

// Return values in the same shapes PostgREST/supabase-js does: dates as
// "YYYY-MM-DD", timestamps as ISO strings, numerics as numbers.
const toIso = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).toISOString();
export const PARSERS = {
  1082: (v: string) => v, // date
  1114: (v: string) => toIso(v + "+00"), // timestamp
  1184: (v: string) => toIso(v), // timestamptz
  1700: (v: string) => Number(v), // numeric
  20: (v: string) => Number(v), // int8
};

function toError(e: unknown) {
  const err = e as { message?: string; code?: string };
  console.error("[demo db]", err?.code ?? "", err?.message ?? e);
  return { message: err?.message ?? "Database error", code: err?.code };
}

async function asUser<T>(userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const db: PGlite = await demoDb();
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    return fn(tx);
  });
}

class Query<T = unknown> implements PromiseLike<Result<T>> {
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private columns = "*";
  private returning: string | null = null;
  private payload: Record<string, unknown> | null = null;
  private countMode = false;
  private head = false;
  private singleMode: "one" | "maybe" | null = null;

  constructor(private table: string, private userId: string | null) {
    ident(table);
  }

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    const c = cols.split(",").map((x) => x.trim()).filter(Boolean);
    const sqlCols = c.length === 1 && c[0] === "*" ? "*" : c.map(ident).join(", ");
    if (this.mode === "select") this.columns = sqlCols;
    else this.returning = sqlCols;
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(row: Record<string, unknown>) { this.mode = "insert"; this.payload = row; return this; }
  update(row: Record<string, unknown>) { this.mode = "update"; this.payload = row; return this; }
  delete() { this.mode = "delete"; return this; }
  eq(col: string, val: unknown) { return this.cmp(col, "=", val); }
  neq(col: string, val: unknown) { return this.cmp(col, "<>", val); }
  private cmp(col: string, op: string, val: unknown) {
    this.filters.push(val === null ? { sql: `${ident(col)} is ${op === "=" ? "" : "not "}null`, params: [] } : { sql: `${ident(col)} ${op} $?`, params: [val] });
    return this;
  }
  /** Supports the PostgREST "a.eq.x,b.eq.y" form used by this app. */
  or(expr: string) {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      if (op !== "eq") throw new Error(`Unsupported or() operator: ${op}`);
      const raw = rest.join(".");
      const val = raw === "true" ? true : raw === "false" ? false : raw;
      return { sql: `${ident(col)} = $?`, params: [val] };
    });
    this.filters.push({ sql: `(${parts.map((p) => p.sql).join(" or ")})`, params: parts.flatMap((p) => p.params) });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const dir = opts?.ascending === false ? "desc" : "asc";
    const nulls = opts?.nullsFirst === undefined ? "" : opts.nullsFirst ? " nulls first" : " nulls last";
    this.orders.push(`${ident(col)} ${dir}${nulls}`);
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "one"; return this; }

  private build(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const bind = (frag: string, vals: unknown[]) => {
      let i = 0;
      return frag.replace(/\$\?/g, () => {
        params.push(vals[i++]);
        return `$${params.length}`;
      });
    };
    const value = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
    const where = this.filters.length ? " where " + this.filters.map((f) => bind(f.sql, f.params)).join(" and ") : "";
    const t = `public.${ident(this.table)}`;

    if (this.mode === "insert") {
      const keys = Object.keys(this.payload!).filter((k) => this.payload![k] !== undefined);
      const vals = keys.map((k) => bind("$?", [value(this.payload![k])]));
      return { sql: `insert into ${t} (${keys.map(ident).join(", ")}) values (${vals.join(", ")}) returning ${this.returning ?? "*"}`, params };
    }
    if (this.mode === "update") {
      const keys = Object.keys(this.payload!).filter((k) => this.payload![k] !== undefined);
      const sets = keys.map((k) => `${ident(k)} = ${bind("$?", [value(this.payload![k])])}`);
      const w = this.filters.length ? " where " + this.filters.map((f) => bind(f.sql, f.params)).join(" and ") : "";
      return { sql: `update ${t} set ${sets.join(", ")}${w} returning ${this.returning ?? "*"}`, params };
    }
    if (this.mode === "delete") return { sql: `delete from ${t}${where} returning *`, params };
    if (this.countMode && this.head) return { sql: `select count(*)::int as n from ${t}${where}`, params };
    const order = this.orders.length ? " order by " + this.orders.join(", ") : "";
    const limit = this.limitN ? ` limit ${Math.floor(this.limitN)}` : "";
    return { sql: `select ${this.columns} from ${t}${where}${order}${limit}`, params };
  }

  async run(): Promise<Result<T>> {
    try {
      const { sql, params } = this.build();
      const res = await asUser(this.userId, (tx) => tx.query<Record<string, unknown>>(sql, params, { parsers: PARSERS }));
      if (this.countMode && this.head) return { data: null, error: null, count: (res.rows[0]?.n as number) ?? 0 };
      if (this.singleMode) {
        if (res.rows.length === 0) {
          return this.singleMode === "maybe" ? { data: null, error: null } : { data: null, error: { message: "No rows found", code: "PGRST116" } };
        }
        return { data: res.rows[0] as T, error: null };
      }
      return { data: res.rows as T, error: null };
    } catch (e) {
      return { data: null, error: toError(e) };
    }
  }

  then<R1 = Result<T>, R2 = never>(ok?: ((v: Result<T>) => R1 | PromiseLike<R1>) | null, bad?: ((r: unknown) => R2 | PromiseLike<R2>) | null) {
    return this.run().then(ok, bad);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Demo users plus anyone who registered through a vendor invitation in this demo session. */
async function findUser(userId: string | null): Promise<{ id: string; email: string } | null> {
  if (!userId || !UUID.test(userId)) return null;
  const known = DEMO_USERS.find((u) => u.id === userId);
  if (known) return { id: known.id, email: known.email };
  const db = await demoDb();
  const res = await db.query<{ id: string; email: string }>("select id, email from auth.users where id = $1", [userId]);
  return res.rows[0] ?? null;
}

export function createDemoClient(cookieUserId: string | null) {
  const userId = cookieUserId && UUID.test(cookieUserId) ? cookieUserId : null;
  return {
    auth: {
      async getUser() {
        return { data: { user: await findUser(userId) }, error: null };
      },
      async signOut() {
        return { error: null };
      },
    },
    from(table: string) {
      return new Query(table, userId);
    },
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
      try {
        ident(fn);
        const keys = Object.keys(args).filter((k) => args[k] !== undefined);
        const params = keys.map((k) => {
          const v = args[k];
          return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        });
        const named = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ");
        const res = await asUser(userId, (tx) => tx.query<{ r: unknown }>(`select public.${ident(fn)}(${named}) as r`, params, { parsers: PARSERS }));
        return { data: res.rows[0]?.r ?? null, error: null };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    },
  };
}
