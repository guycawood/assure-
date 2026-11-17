# Sustainability module and the conscious ordering programme

Sustainability is its own module, with a tab in the top bar (`/sustainability`), its own sidebar, About page and Watchtower, like SRM or Shopper IQ. It holds two programmes on one set of governed factors:

| Programme | Path | Question it answers |
|---|---|---|
| Impact Grade | `/sustainability/impact-grade` | How sustainable is each item? (0 to 10 per spec, weighted dimensions, substrates, emission factors) |
| Conscious ordering | `/sustainability/conscious-ordering` | Was what we ordered actually used? |

The module's libraries (substrates, material and transport emission factors, Impact Grade dimensions, conscious ordering rules, spend-based emission factors) are governed in the Sustainability Watchtower (`/sustainability/watchtower`) and still appear in the master Watchtower's list. Its health figures come from the view `watchtower_health_sustainability`.

## Conscious ordering: how it works

One row per **order line** (a spec on an issued or accepted purchase order), built by `conscious_ordering_lines()`:

| Figure | Source |
|---|---|
| Ordered | Estimate lines of the PO's estimate |
| Delivered | Shipments with a **verified** proof of delivery |
| Installed | Execution deployments (installed, audited or rejected stages) |
| In stock | Latest stock count per location (`stock_counts`), capped at the surplus |

Each line has a status:

- **Not tracked**: no deployments and no stock count. Nothing is known about where the units went.
- **In progress**: nothing delivered yet, or an install is still open. Too early to judge.
- **Reconciled**: surplus = delivered − installed. Stock on hand explains part of it; the rest is **unaccounted for**.

**Presumed wasted** = unaccounted units + stock whose last count is older than the governed age.

### Measured and estimated
- **Measured** figures come from reconciled lines only.
- **Estimated** figures cover untracked orders: spend × the surplus rate measured on reconciled lines of the same product type (the default rate until enough lines are reconciled). They are always shown separately.
- **CO2e** uses the spec's own footprint where it has one, otherwise spend × a spend-based factor (library `spend_emission_factors`). Indicative only.
- **Money** is converted to EUR with the Watchtower reporting rates.

### Who gets advised
Brand × market roll-up (`src/lib/conscious-ordering.ts`):

| Verdict | Rule |
|---|---|
| Over-ordering | Installed ÷ ordered under the target on at least the minimum number of reconciled orders |
| Watch | Under the target, too few orders to call it a pattern |
| On target | At or above the target on enough orders |
| Not tracked | No evidence; estimates only |

The suggested quantity for next time is the installed share plus the contingency allowance.

### Governed rules (library `conscious_ordering_rules`)
`COR-TARGET` 85% · `COR-MIN-ORDERS` 3 · `COR-STOCK-AGE` 12 months · `COR-ALLOWANCE` 5% · `COR-DEFAULT-RATE` 15%.

### Stock counts
Recorded per order line from the order's reconciliation page, through `ordering_record_stock_count()` (staff only). Every count is kept; the latest count at each location is the stock on hand; the total can never exceed what was ordered.

## Not built yet
- Outlet list on the brief, with the order quantity calculated from it.
- Advice and an approval gate in Briefing+ when a brand team orders above the suggested quantity.
- Quantity received (good, damaged, short) at proof of delivery.
- Stock counts uploaded by warehouses or vendors through the vendor portal.
- Spend per outlet benchmarks between markets.
