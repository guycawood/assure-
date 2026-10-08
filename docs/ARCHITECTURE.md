# System Guy — architecture and build conventions

System Guy is adm Indicia's platform. It is made of **modules that each stand alone** and are **linked through the workflow** by explicit handoffs:

| Order | Module | Base path | Role |
|---|---|---|---|
| 1 | Watchtower | `/watchtower` | Governance over every module (health, libraries, change requests, audit) |
| 2 | Briefing+ | `/briefing` | Campaigns, briefs, approval, AI ideation |
| 3 | Shopper IQ | `/shopper-iq` | Performance taxonomy, assets, effectiveness (sits next to Briefing+) |
| 4 | Sourcing+ | `/sourcing` | Jobs, specs, triage (Adopt/Adapt/Create/Push), RFQs, quotes, estimates, POs |
| 5 | Logistics+ | `/logistics` | Deliveries, shipments, POD, transport CO2e |
| 6 | Execution+ | `/execution` | Outlets, recces, deployments, installs, audits |
| 7 | Assure+ | `/assure` + `/vendor` | Horizontal SRM: internal supply-chain management + external vendor portal |

Assure+ is **one module**, not the platform. Its external half is the vendor portal (`/vendor`), where vendors subscribe, quote, update production, upload QA/QC, invoices and control documents. Vendor-facing steps of other modules surface through it.

## Stack
Next.js 15 App Router (server components + server actions), Postgres via Supabase with RLS, zod, Tailwind 3. **Demo mode** runs the same SQL on PGlite in-process (`src/lib/demo/*`) when no Supabase URL is set.

## Where things go
- **Module registry / nav / about / flow:** `src/modules/{registry,nav,about,flow}.ts`. A module's left-sidebar items live in `NAV[module]`; About copy in `ABOUT`; process steps and handoffs in `PROCESS` / `CONNECTIONS`.
- **Routes:** `src/app/(platform)/<module>/...` for internal pages (inside the shell). Vendor pages under `src/app/vendor/...`.
- **Server actions:** `actions.ts` next to the pages that use them. Always call `requireInternal()` / `requireAdmin()` (or vendor equivalents) first, then call a SQL function or a table write that RLS allows. Return `{ ok, message }` for forms; `redirect()` after creates.
- **Data access helpers:** `src/lib/<area>-data.ts` (server-only).
- **Pure logic** (scoring, calculations): `src/lib/<area>.ts`, no I/O, so it can be unit tested and reused in previews.

## Database rules (non-negotiable)
1. **One migration file per change**, named `supabase/migrations/2026MMDDNNNNNN_<module>_<topic>.sql`. Never edit an applied migration; add a new one.
2. **RLS on every table.** Use the helpers `is_admin()`, `is_internal()`, `my_srt_role()`, `my_supplier_id()`, `can_govern(module)`.
   - Internal tables: read `is_internal()`.
   - Vendor-visible rows: `supplier_id = my_supplier_id()`, and only the columns a vendor should see (use a view or column grants for internal-only fields such as notes, NTI, scores).
3. **Decision fields are never writable by the person they affect.** Status changes, approvals, verifications, awards, scores go through `security definer` functions that check the caller's role and the current state (legal transitions only) and write an audit/event row **in the same transaction**. Revoke direct `insert/update/delete` where a function owns the writes.
4. **Real foreign keys** (`suppliers.id`, etc.), never business-code strings or denormalised names. Business codes come from sequences (e.g. `JB-YYYY-00001`), never from the client.
5. **Region and market are separate columns on every operational record** (`region` + `market` today; FKs to `regions`/`markets` when master data lands).
6. **Identity comes from `auth.uid()`**, never from a value the client sends (`created_by`, `decided_by`, ...).
7. Anything configurable belongs in a **Watchtower library** (below), not hard-coded.

## Watchtower framework (every module uses it)
- `library_definitions(key, module, label, requires_approval)` — the catalogue. Add your module's libraries in your migration.
- `library_records(library_key, code, name, data jsonb, version, status, effective_from/to, supersedes/superseded_by, ...)`.
  Read the version that applied on a date with `library_effective(key, code, date)`.
- Functions: `library_create / update (needs a reason) / supersede / approve / retire / reactivate / delete (only unused) / import (all-or-nothing) / alias_add / alias_toggle`. All audited into append-only `library_audit`.
- When your records reference a library record, insert into `library_refs(record_id, ref_table, ref_id)` so the usage guard works.
- Field definitions for the generic library screens live in `src/modules/libraries.ts`.
- Change requests: `cr_submit` (anyone internal, "Suggest a change"), `cr_start_review`, `cr_review` (principles + 20 s rule), `cr_mark_implemented`, `cr_verify` (different person).
- Each module exposes health metrics on its Watchtower page using the `Stat` component.

## Demo data
- Dummy data only. One seed file per module: `supabase/seed/m<NN>_<module>.sql` (loaded after `demo_data.sql`, in name order).
- Demo users are in `src/lib/demo/config.ts` (Ada Admin, Lena Lead, Arjun Agent, Fiona Finance, Pedro Procurement, Hana Head, Wei Chen vendor for DEMO-001). Seed rows that need a user should be updated in `src/lib/demo/db.ts` after users exist, or reference users by email lookup.

## Tests
- One file per module: `tests/db/<module>.test.mjs`, using `setupDb()` from `tests/db/helpers.mjs`.
- Test access rules (who can/can't), state transitions, and calculations. `npm run test:db` runs all files.

## UI conventions (adm Indicia look, Base44 shell)
- Shell: per-module left sidebar + top bar with module tabs (`src/components/shell.tsx`). Pages render inside `<main>`; do not add your own `<main>`.
- Components: `Card`, `Panel`, `PageHead` (with `crumbs`), `Stat`, `Pill`, `Empty`, `btn.primary|secondary|danger`, `ButtonLink` from `src/components/ui.tsx`; icons via `MSymbol` (Google Material Symbols names) from `src/components/symbol.tsx`.
- Tables: `<table>` with `.th` / `.td` classes inside a `Card`. Forms: `.label` + `.input`.
- Tone: conversational, plain English, no jargon. Write "adm Indicia" exactly like that.
- Brand colours: tokens in `globals.css` and `brand.*` in Tailwind (New-blue `#010062`, Pale `#F0F7F7`, module colours from the service palette).

## Verification before handing back
`npx tsc --noEmit` (ignore `.next/` noise), `npm run test:db`, and for UI a demo click-through. The integrator runs `npm run build`.
