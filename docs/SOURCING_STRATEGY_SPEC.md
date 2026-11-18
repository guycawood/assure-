# Sourcing strategy: build specification

Source: Guy's handwritten notes (Saigon, Nov 2026): Sourcing Strategy, Harmonisation Strategy, Supply Chain Strategy,
Vendor Management and Value Engineering. This turns them into something buildable on System Guy (Next.js + Postgres,
Supabase RLS, PGlite demo). Read `docs/ARCHITECTURE.md` first: every rule there applies. Where a note was unclear,
this spec picks a default and lists the question in section 13. Nothing in this spec is built yet.

## 1. Purpose

Today System Guy decides how to buy one job at a time (triage, RFQ, award). These notes add a **strategy layer**
that looks across the whole portfolio and answers four questions:

1. **What are we buying, and how much of it is structured?** (portfolio, similar items)
2. **Where could we buy better?** (harmonisation, vendor reduction, NTI, payment terms, geography)
3. **Is the supply base healthy enough to do it?** (capability, risk, gaps, resilience, client panels)
4. **Can the spec itself be cheaper or lighter before we buy it?** (value engineering)

Principles, in the order they matter:

- **Suggest, never act.** A strategy or suggestion never changes a spec, a price, a vendor's eligibility or a PO on
  its own. A person accepts it; accepting creates the normal record (rate card request, spec version, SRM onboarding
  request) through the existing governed path.
- **Measured and estimated are always separate** (the same rule as conscious ordering). Every figure says which it is.
- **Internal only.** NTI, savings targets and vendor comparisons are never shown in the Client Portal or the Vendor
  Portal. Follow the existing scrubbing in `supabase/migrations/20261016000001_client_portal.sql`.
- **No invented numbers.** Every number on a screen comes from a SQL function or the pure logic in
  `src/lib/strategy.ts`. The agentic layer (F12) may explain and rank them, never produce them.

## 2. Where it lives

An area inside **Sourcing**: routes under `/sourcing/strategy/...`, a new sidebar group **Strategy** in the Sourcing
section (`src/modules/nav.ts`), and entries in `src/modules/about.ts` and `flow.ts`. It reads SRM, Finance and
Execution data; it owns only the strategy records. Client vendor panels (F8) are owned by SRM because they decide
supplier eligibility per client.

| Handwritten note | Feature |
|---|---|
| Portfolio of unstructured goods | F1 Portfolio |
| Adopt / Adapt / Create triage | F1 (existing triage, shown as the structure measure) |
| Similar or like opportunity analysis | F2 Similar-item clusters |
| Harmonisation strategy, (+) suggestions, upside | F3 Harmonisation |
| (+) Create strategy: vendor reduction, client or multi-client focus | F4 Strategy builder |
| NTI driving strategy | F5 NTI moves |
| Payment terms, scenario strategies with historic spend | F6 Payment terms, F7 Scenarios |
| Client vendor portfolio | F8 Client vendor portfolio and panels |
| Capability, Risk, Gaps; identify vendor shortfall; limited resilience | F9 Supply base lens |
| Filtering by client / capability, 5 suppliers, 5-6 key metrics | F10 Shortlist |
| Geolocation sourcing modelling | F11 Geo sourcing model |
| Agentic: what is hot, what is a miss | F12 Agentic review |
| Value engineering | F13 Value engineering |

## 3. What already exists (reuse, do not rebuild)

| Need | Already in the system |
|---|---|
| Triage route per spec | `spec_triage` (`adopt`, `adapt`, `create`, `push`), current row per spec |
| Harmonised flag and KPI | `job_specs.harmonised`, scorecard KPI `HARMONISATION_PCT` |
| Repeat-purchase groups | `rate_card_opportunities()` groups priced lines by spec type, material and a cleaned title, with orders, jobs, clients, vendors, spend and price range; dismissals with a reason |
| Rate cards and requests | rate card requests, programmes, awards (migrations `20261106000017` to `...31`) |
| Spend and price history | `estimates`, `estimate_lines` (`benchmark_source`: `live`, `rate_card`, `bypass`), `purchase_orders`, `supplier_invoices` |
| Currency | `reporting_fx_rates` library and `public._fx_eur(currency)` (EUR reporting) |
| NTI and terms | `supplier_profiles.nti_rate`, `payment_terms`, `payment_terms_days`, `risk_level`; `ntiValue(spend, rate)` in `src/lib/assure.ts` |
| Supplier performance | `performance_records.composite_score`, `ncr_count`, `defect_rate`; OTIF; the SRM scorecard and PSL |
| Capability | `supplier_capabilities`, `supplier_machines`, `supplier_tooling`, `srm_processes` library (migration `20261105000006`) |
| Supplier locations | `supplier_sites` (country, locode, latitude, longitude); `docs/GEOGRAPHY_MODULE_SPEC.md` |
| Categories | product taxonomy ids on `job_specs` (`tax_category_id`, `tax_subcategory_id`, `tax_product_type_id`) |
| What was bought last time | `spec_repeat_context(spec)` |
| Footprint and weight | `job_specs.unit_weight_grams`, `co2e_kg_per_unit`, Impact Grade; spec components with substrates |
| Approvals | the approvals framework (`docs/APPROVALS.md`, `approval_policies` library) |
| Spec versions after an RFQ | "spec changes after an RFQ is sent create a new version" |
| Claude calls and offline mock | `src/lib/ai/claude.ts`, `src/lib/ai/briefing-mock.ts` pattern |
| Estimated vs measured labelling | conscious ordering (`docs/CONSCIOUS_ORDERING.md`) |

Demo data today (so screens have something to show): 459 specs all with a taxonomy category (335 with a product
type), 51 harmonised; 34 suppliers, 30 with an NTI rate (average 6.0%), six payment-term values; 459 estimates over
about 15 months in EUR and GBP; **only 4 supplier sites and 5 capability rows**, so demo seeds are needed for F9 to F11
(section 11).

## 4. Definitions

- **NTI** = net trade income, the rebate agreed with a supplier as a percentage of spend. `NTI value = spend x NTI rate`.
- **Structured spend**: spend on lines priced from a rate card, or on a spec whose current triage route is `adopt`
  or `adapt`, or on a `harmonised` spec. **Unstructured** is everything else (the "portfolio of unstructured goods").
- **Cluster**: a group of like items (F2). A cluster is the unit harmonisation works on.
- **Effective vendor count** = 1 / sum of squared spend shares across vendors in a scope (the inverse of the
  concentration index). Five vendors with equal shares give 5; one dominant vendor gives close to 1.
- **Backup exists** for a category and market: at least two eligible, capable vendors, and the second has capacity
  for at least the configured share of demand.
- **NTI reliance** (proposed): the share of total NTI value that comes from a named group, for example the top five
  vendors or one category. "52% NTI reliance" on page 1 is read as "52% of our NTI depends on this group". See Q1.
- **Scope**: any mix of clients, categories, markets and suppliers, plus a look-back period. Every feature takes a scope.

## 5. Access and governance

- Internal staff read everything (`is_internal()`), vendors and clients read nothing (RLS plus no views for them).
- NTI visibility: follow the existing decision on the scorecard open point (BI point 3). **Default:** NTI value and
  rate are visible to Procurement, SRM and Finance roles only; other internal roles see strategies with NTI shown as
  "restricted". Implement as one helper `public._can_see_nti()` used by every strategy function.
- Writes only through `security definer` functions that check the role and state and write an audit event in the
  same transaction (architecture rule 3). Maker-checker: the person who approves a strategy is not its owner.
- Anything configurable is a Watchtower library (rule 7), listed in section 6.4.

## 6. Data model

New migrations: `supabase/migrations/20261108000001_strategy_core.sql` onward, one per phase. Region and market are
separate columns wherever a record has a place. Business codes from sequences: `ST-YYYY-00001` for strategies.

### 6.1 Strategy records (phase 2)

```
strategies
  id, code (ST-..., sequence), title, kind ('sourcing' | 'supply_chain'),
  scope jsonb            -- { client_ids[], categories[], markets[], supplier_ids[], months }
  status                 -- draft | in_review | approved | active | closed | rejected
  owner, summary, rejected_reason,
  baseline jsonb         -- spend, vendors, NTI, terms at creation; frozen once approved
  submitted_at, approved_by, approved_at, closed_at, created_by, created_at, updated_at

strategy_levers
  strategy_id, lever ('vendor_reduction' | 'client_focus' | 'nti_shift' | 'payment_terms'
                      | 'harmonisation' | 'geo_sourcing'), params jsonb, sort

strategy_scenarios
  id, strategy_id, name, is_baseline, assumptions jsonb, results jsonb,
  baseline_from, baseline_to, rule_version, computed_by, computed_at
  -- immutable: recomputing inserts a new row; the page shows the latest per name

strategy_moves
  id, strategy_id, category, from_supplier_id, to_supplier_id, shift_pct, spend_eur,
  nti_uplift_eur, saving_eur, basis ('measured' | 'estimated'), status ('proposed' | 'accepted' | 'dismissed'),
  decided_by, decided_at, reason

strategy_events      -- append-only audit: created, levers changed, scenario run, submitted, approved, ...
```

### 6.2 Harmonisation (phase 1)

```
harmonisation_proposals
  id, cluster_key, label, spec_ids uuid[],
  current jsonb          -- { vendors, designs, orders, spend_eur, unit_cost_min, unit_cost_avg, unit_cost_max }
  target jsonb           -- { vendors, designs }  (set by the person or the suggested default)
  upside jsonb           -- { vendor_reduction, revenue_pooled_eur, saving_eur, saving_pct, designs_removed, basis }
  status ('suggested' | 'accepted' | 'in_progress' | 'done' | 'dismissed'),
  dismissed_reason, rate_card_request_id, decided_by, decided_at, created_at
```
Accepting creates a **rate card request** (existing) carrying the cluster as evidence, the same way
`rate_card_opportunities` does today. Marking the proposal `done` sets `job_specs.harmonised = true` on the specs that
moved to the standard spec. Dismissals need a reason of at least 3 characters (existing pattern).

### 6.3 Panels and value engineering (phases 3 and 4)

```
client_vendor_panels   (owned by SRM)
  client_id, supplier_id, category_id (nullable = all), market (nullable = all),
  status ('approved' | 'preferred' | 'restricted' | 'blocked'),
  source ('declared' | 'inferred'),   -- inferred = seen on past awards, never authoritative
  valid_from, valid_to, set_by, set_at, notes
  unique (client_id, supplier_id, category_id, market)

ve_suggestions
  id, spec_id, spec_version_id, stage ('early' | 'spec'), kind ('comparison' | 'lightweight' | 'material'),
  title, detail, evidence jsonb,        -- the similar specs, weights and costs behind it
  saving_eur_per_unit, saving_eur_total, weight_delta_g, co2e_delta_kg,
  functional_check ('passed' | 'needs_review' | 'failed'), functional_notes,
  status ('proposed' | 'accepted' | 'dismissed'), decided_by, decided_at, reason, created_at
```

### 6.4 Libraries (Watchtower, maker-checker where marked)

| Library key | Holds | Default values to seed |
|---|---|---|
| `strategy_rules` * | thresholds the functions read | look-back 12 months; orders that make a cluster 3; saving cap 25%; performance floor 70; minimum NTI uplift 0.5 points; capacity headroom 20%; concentration warn at top vendor share above 60%; working-capital rate 6%; key metrics shown 6 |
| `strategy_lever_types` | lever names, descriptions, parameter schema | the six levers above |
| `strategy_key_metrics` * | the 5 or 6 metrics on the shortlist, with source and direction | performance score, OTIF, quality (NCR or defect rate), NTI %, payment terms, lead time or capacity |
| `category_process_map` * | taxonomy product type to the SRM processes it needs | seeded for print, display, corrugated, plastics, fabrication |
| `ve_functional_limits` * | minimum material gauge or maximum weight reduction by use (load, outdoor, duration, hygiene) | conservative starting values, marked indicative |
| `ve_material_costs` | EUR per kg by substrate, indicative | one row per substrate; **needs real values (Q6)** |

Seed rows are marked indicative and replaced through the Watchtower, as with the emission factors.

## 7. Features

Each feature lists what the user sees, the logic, and the data it uses. "SQL" means a `security definer` function
that checks `is_internal()` and `_can_see_nti()`; "TS" means pure logic in `src/lib/strategy.ts` (no I/O).

### F1 Portfolio (phase 1)
**See:** spend by category, spec type, client and market, split structured vs unstructured, with the triage mix
(adopt / adapt / create / push) per category and the share priced from rate cards. A switch for goods vs services
(`spec_type`). **Logic:** SQL `strategy_portfolio(scope)` returns rows; TS rolls them up. Spend in EUR through
`_fx_eur()`; lines whose currency has no rate are counted separately and shown as "not converted".
**Done when:** the total matches the Finance spend report for the same scope and period.

### F2 Similar-item clusters (phase 1)
**See:** clusters of like items with orders, jobs, clients, vendors, designs (distinct specs), spend and price range.
**Logic:** extend `rate_card_opportunities()` rather than replace it. Add to the grouping key: taxonomy product type,
a size band (finished length and width in bands), and substrate; keep the cleaned-title key as the fallback when the
taxonomy is missing. Cross-client by default; a toggle limits to one client. SQL `similar_spec_clusters(scope, min_orders)`.
**Done when:** every cluster opens a list of its member specs and orders.

### F3 Harmonisation (phase 1)
**See:** a list of clusters with a **(+)** on each row for suggested actions: *consolidate onto one standard spec*,
*pool volume with fewer vendors*, *reduce design variants*, *request a rate card*. Each row shows the upside:

| Upside | How it is worked out |
|---|---|
| Vendors | current distinct vendors, target vendors (default: the smallest number whose combined capacity covers demand, minimum 1; editable) |
| Revenue pooling | cluster spend divided by target vendors: what each remaining vendor would earn |
| Cost saving potential | cluster spend x saving %. Saving % = (volume-weighted average unit cost minus the best credible unit cost) / average, clamped to 0 and the saving cap. "Best credible" = lowest unit cost from a vendor at or above the performance floor whose capacity covers the pooled volume. **Measured** when the best price comes from an order in the period; **estimated** when it is a rate card or an assumed tier. |
| Multiple-design reduction | designs now, designs target (default 1 standard plus variants that differ by a size band), designs removed. No euro value unless a setup or tooling cost exists (Q5) |

**Actions:** accept (creates a rate card request with the evidence), dismiss (reason required), mark done.
**TS:** `harmonisationUpside(cluster, rules)` is pure and unit-tested. **Done when:** accepting twice does not
create two requests, and the upside on screen equals the stored `upside` JSON at the time of acceptance.

### F4 Strategy builder (phase 2)
**See:** a **(+) Create strategy** button on the strategy list. A strategy has a kind (sourcing or supply chain), a
scope, one or more levers with parameters, a baseline, scenarios, moves, an owner and a status.
Levers: vendor reduction (target count per category), client focus (single client or shared across clients),
NTI shift, payment terms, harmonisation (picks accepted proposals), geo sourcing.
**Flow:** draft, then in review (submitted), then approved or rejected by someone other than the owner, then active,
then closed with an outcome note. Approval uses the approvals framework with a new approval type `sourcing_strategy`
and a policy row in `approval_policies`. Approving freezes `baseline`.
**Done when:** the owner cannot approve their own strategy, and a frozen baseline cannot change.

### F5 NTI moves (phase 2)
**See:** per category, the current spend-weighted NTI %, the eligible vendors with a higher NTI, and a ranked list of
suggested moves with the NTI uplift and the reasons each constraint passed.
**Logic:** SQL `nti_moves(scope)`. A move from vendor A to vendor B in a category is offered only if **all** hold:
B is eligible (SRM onboarding released, not blocked, on the client's panel if one is set); B has the capability
(`category_process_map` against `supplier_capabilities`, size limits and run range fit); B's performance score is at
or above the floor; B has spare capacity (monthly capacity x headroom against the moved volume); B's NTI is at least
the minimum uplift above A's. `nti_uplift_eur = moved spend x (B rate - A rate) / 100`. Each rejected candidate keeps
the reason it failed, so the page can show "why not". The default moved share is a parameter (10%, 25%, 50%, 100%).
**Done when:** moving spend never offers a vendor that fails a constraint, and the "why not" list is complete.

### F6 Payment terms (phase 2)
**See:** the effect of moving a vendor or category from one payment term to another.
**Logic (TS):** `working capital released = spend x (new days - old days) / 365`; `carrying benefit = released x
working-capital rate`. Shown beside any NTI or price effect of the same move, because longer terms are often
traded against NTI or price. Terms come from `supplier_profiles.payment_terms(_days)`.

### F7 Scenarios (phase 2)
**See:** the baseline and up to four scenarios side by side: spend, price saving, NTI, working-capital benefit,
vendor count, effective vendor count, top-vendor share, and risk flags.
**Logic:** the baseline is the last N months of **historic spend** (default 12) taken from `strategy_baseline(scope,
from, to)`, which returns spend by supplier x category x client x market with NTI rate and terms. A scenario is a set
of assumptions applied to that baseline in TS (`runScenario(baseline, assumptions, rules)`): vendor reductions (move
spend off dropped vendors to named vendors with a price effect), NTI shifts, term changes, harmonisation savings.
The result is stored with the assumptions and the rule version so any scenario can be reproduced. **Estimated** is the
label on every scenario figure, because a scenario is a forecast; the baseline is **measured**.
**Done when:** re-running a scenario with the same assumptions gives the same numbers, and the baseline totals equal F1.

### F8 Client vendor portfolio and panels (phase 3)
**See:** per client, the vendors used, spend share, NTI, performance, panel status, categories with a single vendor,
and the vendors shared with other clients. This is the answer to "siloed client panels": where the same capable
vendor sits on one client's panel and not another's, the page says so and offers a request to add them.
**Logic:** `client_vendor_panels` (section 6.3) is the register; `source = inferred` rows are generated from past
awards for display only and never treated as approval. Adding a vendor to a panel is an SRM action with a reason.
Multi-client focus means the strategy can pool volume across clients only where panels allow it.

### F9 Supply base lens: capability, risk, gaps (phase 3)
**See:** a grid of category x market with three lenses.
- **Capability:** share of the category's required processes that eligible vendors cover, from `category_process_map`.
- **Risk:** vendors in the cell, their `risk_level`, financial standing, the top vendor's share, whether a backup exists.
- **Gaps:** cells with no eligible capable vendor, one vendor only, or a capacity shortfall against demand.
**Resilience** flags: effective vendor count below 2, a top-vendor share above the warn threshold, or "all incumbents"
(every vendor in the cell already supplies the client, so nothing new can be tried). Each gap offers **Raise an
onboarding request**, which opens the existing SRM onboarding "Need" stage with the category, market and reason
prefilled. **Done when:** a vendor shortfall found here can be turned into an SRM request in one click, and the
grid agrees with F5's eligibility rules (same function underneath).

### F10 Shortlist (phase 3)
**See:** choose a client and a capability (and optionally market and category); get at most **5 suppliers** ranked,
each with **5 or 6 key metrics** (the `strategy_key_metrics` library; default: performance score, OTIF, quality,
NTI %, payment terms, lead time or capacity). **Logic:** SQL `supplier_shortlist(client, capability, market, category,
limit)` applies the same eligibility and capability checks as F5, then ranks by a weighted sum of the metrics with
weights in `strategy_rules`. Shows why a vendor is excluded when asked. Metrics with no data show "no data", never zero.

### F11 Geo sourcing model (phase 5)
**See:** a map of demand (delivery destinations and outlets) and supply (vendor sites), with distance, an indicative
transport CO2e and a lead-time proxy per vendor site, and a what-if: "serve this category from site X".
**Logic:** demand points from `deliveries` destination coordinates and `outlets`; supply from `supplier_sites`
(coordinates, else the locode centroid from the geography master). Distance and CO2e reuse the Logistics distance and
transport emission factors, so the numbers match the delivery pages. Landed cost = unit cost + estimated freight
(from rate cards or past deliveries) when available, otherwise shown without it. Needs more supplier sites with
coordinates than the demo has (section 11). Uses the map component already used for outlets if one exists, otherwise a
simple static map with a table; do not add a new mapping dependency without checking with Guy.

### F12 Agentic review (phase 6)
**See:** on a strategy or on the portfolio, a **Review** button that returns a short list of **hot** items
(opportunities worth acting on) and **misses** (gaps, risks, things the numbers do not support), each with its
evidence and a confidence note.
**Rules:** read-only tools only, and they are the same SQL functions the pages use. The model may not state a number
that is not in a tool result; the response is validated so every figure it cites matches a returned value, and
anything that does not is dropped. Output is stored as suggestions; each can be accepted (which opens the normal
record, for example a harmonisation proposal or an SRM request) or dismissed with a reason, like the rate card
opportunity dismissals. Demo mode returns an offline mock so the screen works without an API key (pattern:
`src/lib/ai/briefing-mock.ts`). Model and prompts live in `src/lib/ai/` and the model id is a setting, not a
constant. **Done when:** with the API disabled the review still works from the mock, and a response containing an
unsupported number is rejected in a test.

### F13 Value engineering (phase 4)
This answers the closing question on page 4, **"do we value engineer only once a spec has been created?"** The
recommendation is **no: two stages**.

- **Early (stage `early`)**: while the spec is still a draft, including a spec seeded from a Briefing concept.
  Indicative only. For the substrate, size and quantity entered so far, show what similar specs bought before cost,
  weighed and footprinted (`spec_repeat_context`, F2 clusters), and flag if this draft is an outlier. Appears as a
  side panel on the draft spec and as a prompt on a concept hand-off.
- **At spec (stage `spec`)**: once the spec is complete, the firm review before triage and RFQ. Suggestions are
  stored in `ve_suggestions`.

Two kinds of suggestion, as on the page:
1. **Based on comparison:** the spec's cost per unit area or volume, weight and CO2e against its cluster; outliers
   above a configurable percentile are flagged with the comparable specs as evidence.
2. **Based on lightweighting:** reduce grammage, thickness or substrate weight using **material cost and indicators**
   (`ve_material_costs`, weight, CO2e per kg, Impact Grade). The saving is `weight delta x material cost per kg x
   quantity`, plus the CO2e delta from the same factors. Every lightweight suggestion passes through
   `ve_functional_limits`: a reduction beyond the limit for the stated use (load, outdoor, duration) is marked
   `needs_review` or `failed` and cannot be accepted without a person recording why. This is the answer to "how do we
   lightweight but still ensure functionality".

**Accepting** a suggestion changes the spec through the normal route: edits a draft directly, or creates a **new spec
version** when an RFQ has already been sent. **Done when:** a lightweight suggestion beyond a functional limit
cannot be accepted silently, and accepting after an RFQ never edits the version the RFQ used.

## 8. Screens and routes

| Route | Content | Phase |
|---|---|---|
| `/sourcing/strategy` | Dashboard: spend, structured share, vendors, effective vendor count, NTI %, NTI reliance, harmonisation upside, gap count, strategy list with **+ Create strategy** | 1, grows |
| `/sourcing/strategy/portfolio` | F1 and the cluster list (F2) | 1 |
| `/sourcing/strategy/harmonisation` | F3 | 1 |
| `/sourcing/strategy/new`, `/sourcing/strategy/[id]` | F4 to F7: levers, scenarios side by side, moves, approval, activity | 2 |
| `/sourcing/strategy/supply-base` | F8, F9 | 3 |
| `/sourcing/strategy/shortlist` | F10 | 3 |
| `/sourcing/strategy/value-engineering` | review queue for F13 suggestions | 4 |
| Panel on `/sourcing/specs/[id]` and the Briefing concept hand-off | F13 side panel | 4 |
| `/sourcing/strategy/geo` | F11 | 5 |
| Review button on the dashboard and strategy page | F12 | 6 |

Conventions: `PageHead`, `Stat`, `Panel`, `Pill` from `src/components/ui.tsx`; server actions in `actions.ts` beside the
pages; reads in `src/lib/strategy-data.ts`; pure logic in `src/lib/strategy.ts`; components in
`src/components/strategy/`. Tone: plain English, "adm Indicia".

## 9. Build order

1. **Phase 1, harmonisation and portfolio (no new external data).** Libraries `strategy_rules`; functions
   `strategy_portfolio`, `similar_spec_clusters`; `harmonisation_proposals`; pages F1 to F3; dashboard with the first
   measures. Quickest to show value: it runs on today's demo data.
2. **Phase 2, strategies and scenarios.** F4 to F7 and the approval type. Needs F1's baseline function.
3. **Phase 3, supply base.** `client_vendor_panels`, `category_process_map`, F8 to F10. Needs demo capability and
   panel seeds first.
4. **Phase 4, value engineering.** Can start any time after Phase 1; independent of Phases 2 and 3.
5. **Phase 5, geo sourcing.** Needs supplier site coordinates.
6. **Phase 6, agentic review.** Last, because it explains the outputs of everything above.

Each phase ships on its own: migration, seed, functions, pages, tests, About text, docs.

## 10. Tests

One file per area under `tests/db/` (PGlite harness `setupDb()`), plus pure-logic tests in `tests/unit/`:

- `tests/unit/strategy.test.mjs`: effective vendor count, harmonisation upside (clamping, cap, measured vs estimated),
  working-capital maths, scenario determinism, NTI move eligibility with every constraint failing in turn.
- `tests/db/strategy_portfolio.test.mjs`: spend totals equal the Finance report, structured vs unstructured split,
  unconverted-currency handling, cluster membership.
- `tests/db/strategy_core.test.mjs`: owner cannot approve, baseline frozen on approval, scenarios immutable, status
  transitions only legal ones, audit event on every change, vendors and clients read nothing.
- `tests/db/harmonisation.test.mjs`: accept creates exactly one rate card request, dismiss needs a reason, done sets
  `harmonised`.
- `tests/db/supply_base.test.mjs`: panels, gaps, resilience, shortlist limit of 5, exclusion reasons.
- `tests/db/value_engineering.test.mjs`: functional limit blocks acceptance, accept after RFQ makes a new version.
- Access test in each file: a vendor user and a client user get nothing; NTI hidden from roles without visibility.

Before handing back each phase: `npx tsc --noEmit`, `npm run test:db`, `npm run build`, and a click-through of the new
pages as Ada Admin and as a role without NTI visibility.

## 11. Demo data

Dummy only, one seed file per phase (`supabase/seed/m99_strategy_*.sql`), loaded after the existing seeds. Needed:

- Supplier sites with coordinates for about 12 suppliers across at least 5 countries (today: 4 sites).
- Capability rows for about 12 suppliers covering print, converting, plastics and fabrication (today: 5 rows), and the
  `category_process_map` library.
- Client vendor panels for four clients, with at least one deliberate silo (a capable vendor on one client's panel
  and not another's) and one category with a single vendor.
- NTI rates for the 4 suppliers that lack one, and a spread of payment terms.
- `ve_material_costs` for every substrate (indicative) and a few specs with weights and a draft spec that is a price
  outlier, so both value engineering kinds show up.
- Two example strategies in different statuses.

## 12. Non-goals (this version)

- No automatic vendor switching, no automatic eligibility changes, no automatic price changes.
- No client-facing or vendor-facing views of any strategy, NTI or savings figure.
- No new mapping or charting dependency without agreement.
- No machine-learned savings prediction: savings are arithmetic on observed prices and stated assumptions.
- No change to the existing triage, RFQ or award rules; strategy only informs them.

## 13. Open questions (defaults used if not answered)

1. **"52% NTI reliance"** (page 1): read here as the share of total NTI that depends on a named group, such as the
   top five vendors or one category. Is that what was meant, or is it the share of a category's spend that earns NTI?
2. **"Spine of Nuances"** (page 1) could not be read reliably. What does it say?
3. **Strategy scope:** any mix of client, category, market and supplier. Is one strategy per client the norm?
4. **Who approves a strategy?** Default: a Procurement lead or director who is not the owner, through the approvals
   framework.
5. **Setup and tooling cost** per design: is there a source? Without it, "multiple design reduction" is a count, not
   euros.
6. **Material cost per kg** by substrate: who supplies and maintains it? The seed values are placeholders.
7. **Client panels:** are they set by client contract (authoritative) or inferred from past awards? Default:
   declared in SRM, with inferred rows shown only as hints.
8. **Value engineering timing:** this spec recommends two stages (early indicative, then at spec). Confirm.
9. **Payment terms:** is the working-capital rate one global figure, or per region?
10. **"5 suppliers, 5 to 6 metrics"** is read as a shortlist capped at five with five or six configurable metrics.
    Confirm the default list in `strategy_key_metrics`.
