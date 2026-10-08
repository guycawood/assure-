# Assure+

adm Indicia's supplier relationship management platform. This repo is the fresh build that replaces the Base44 prototype.

**Phase 1 (this release): internal portal + SRT Onboarding Desk**

- Sign-in by emailed link (Supabase Auth). Staff on `adm-indicia.com` join as internal; vendors are linked to their company server-side by their verified email.
- Supplier register with 14 onboarding gates, red/amber/green status, priority tier and a purchasing block, all computed in Postgres.
- SRT ticket queue with SLA due dates, assignment, activity log and one-click remediation tickets.
- Fast-track exceptions (SRT lead only, no self-approval, automatic re-block after the close-by date).
- Admin page for portal, SRT role and vendor-company access.

Access is enforced in the database (row-level security plus security-definer functions), not in the browser. Vendors can never read SRT data, write gates, or change their own role or company.

## Stack

Next.js 15 (App Router, server actions) · TypeScript · Tailwind · Supabase (Postgres, Auth) · PGlite for database tests.

## Run it locally

1. **Tools.** Node 22 and Git. On ADM laptops without admin rights, portable copies live in `../.tools`; put them on your path for the session:
   ```powershell
   $env:Path = "$PWD\..\.tools\node;$PWD\..\.tools\git\cmd;$env:Path"
   ```
2. **Supabase project.** Create a project at supabase.com (EU region). Then:
   - SQL Editor → paste and run each file in `supabase/migrations/` in order (`…0001_core_and_srt.sql`, then `…0002_import_and_sweep.sql`).
   - Optional dummy data: run `supabase/seed/demo_data.sql`. It adds 30 made-up suppliers (codes `DEMO-001`…`DEMO-030`) with a realistic mix of gate statuses, plus 14 tickets. The file's header shows how to remove it.
   - Authentication → URL Configuration → Site URL `http://localhost:3000`, and add `http://localhost:3000/auth/callback` to Redirect URLs.
   - Optional: Database → Extensions → enable `pg_cron`, then run
     `select cron.schedule('srt-daily-sweep', '15 0 * * *', $$ select public.srt_daily_sweep() $$);`
     so expiry dates and fast-track deadlines are re-checked nightly and renewal tickets are raised 30 days before certificates expire.
3. **Environment.** Copy `.env.example` to `.env.local` and fill in the project URL and anon key (Project Settings → API).
4. **Install and start.**
   ```powershell
   npm install
   npm run dev
   ```
5. **First admin.** Sign in once at http://localhost:3000, then in the Supabase SQL Editor run:
   ```sql
   update public.profiles set is_admin = true where email = 'you@adm-indicia.com';
   ```
   Everyone else is given SRT roles from **Admin → User access**.

## Tests

```powershell
npm run test:db
```

Runs the migrations in an in-process Postgres with stubbed Supabase auth and checks vendor isolation, verifier roles, audit logging, RAG/tier/purchasing-block logic, certificate expiry, fast-track rules, ticket SLAs and dedupe.

## Roles

| Role | Can |
| --- | --- |
| SRT agent | Work tickets; verify or reject all gates except bank details |
| SRT lead | Agent rights, plus approve fast-track, mark gates not required, change due dates, delete tickets |
| Finance | Verify or reject the bank details gate |
| In-market procurement | Raise tickets; set gates to requested or received |
| Admin | Everything, plus user access and settings |

## What's next

See the module spec in Claude Docs ("Assure+ SRT Onboarding Desk — Module Spec"). Upcoming: CSV import of the fast-track tracker, vendor portal (registration, pre-assessment, document upload into gates), notifications, and the PO-creation check against `purchasing_blocked`.
