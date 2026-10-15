# Reporting: the balanced scorecard model

Reference: a client balanced-scorecard pack shared as an example (23 dashboard pages; no client data is used in System Guy). It shows how client and
internal reporting should work in System Guy: one data model, every measure cut the same way, so people can see
how the elements of delivery affect each other.

## How the scorecard is organised
- Four perspectives, each with objectives, a target, the current value and a status:
  - **Plan Better**: low-value jobs %, median spend per spec, urgent jobs %, median lead time (days).
  - **Design Better**: design effectiveness score (a checklist of creative effectiveness KPIs), Adopt %,
    specification harmonisation %, sustainability performance (EcoGrade, with its 8-part wheel: reuse design,
    recycle ready, recycled content, value engineered, supply-chain optimised, environment safe, end of life
    assured, carbon footprint), power-brand spend mix.
  - **Buy Better**: savings % (by methodology: reference pricing, value engineering, market benchmarking,
    prior-year baseline average, missed opportunities, no savings achieved; addressable vs non-addressable spend),
    quality (perfect job %), delivery OTIF %, rate-card usage %; spend, savings and order items by month, business
    group, brand, country and order value band; premium (promo) jobs; supplier rating.
  - **Manage Better**: market temperature checks (client survey: overall rating, 12 service dimensions,
    future-ready / innovative, improvement and growth word clouds), brief quality score, PO on time %,
    innovation engagement %.
- **The same filters on every page**: AAC route (Adopt / Adapt / Create), business unit, market, brand, date range.
- **The same breakdowns on every measure**: trend by AAC route over time, by market, by spec type
  (print / retail display) x AAC route, and by business unit x AAC route.
- **Influence factors** (the relationships): savings, lead time, spend per spec, perfect job and supplier rating
  split by urgent vs non-urgent, by governance model (business-group-led vs central), and by spec
  complexity (low / medium / high) across AAC routes. This is how a client sees that, for example, urgent Create
  jobs save less and take longer.
- **Strategic KPI table by country**: KPI delivery %, savings % vs target, rate-card % vs target, OTIF % vs
  target, quality % vs target, with the definition and measurement of each KPI underneath
  (e.g. OTIF = jobs delivered on time and in full against the agreed schedule; quality = jobs not rejected or
  recalled; rate-card spend excludes exempt spend; ordering-tool usage share).
- Narrative callouts that explain the pattern (e.g. "longer lead times in Adopt and Create within retail display
  indicate complexity").

## Where each measure comes from in System Guy
| Measure | Source |
|---|---|
| AAC route | Sourcing triage route per spec line (Adopt / Adapt / Create / Push) |
| Spend, order items, value band | Order Management PO lines and estimates |
| Savings by methodology | Sourcing award (benchmark, should-cost corridor, rate card, value engineering) and estimate savings; addressable flag |
| Lead time, urgent jobs, PO on time | The timestamped journey (brief to delivery; PO issued vs required date) |
| OTIF | The OTIF definition (POD timestamp vs promised date, delivered vs ordered quantity) |
| Quality / perfect job | QA/QC plans passed first time, NCRs, recalls |
| Supplier rating | SRM scorecard |
| Rate-card usage | Adopt lines priced from a rate card, excluding exempt spend |
| Harmonisation | Spec library matches and consolidated specs |
| EcoGrade / sustainability | Impact Grade per spec |
| Design effectiveness | Shopper IQ execution / design scoring |
| Brief quality | Briefing+ completeness score |
| Market temperature checks | CRM satisfaction surveys (sections, NPS, start / continue / stop) |
| Business unit, brand, power brand, governance model | Client taxonomy on campaign and job (CRM / Shopper IQ) |
| Spec type, complexity | Spec type and a complexity rating on the spec |

## What to build
1. One reporting fact view at spec / order-line level carrying every dimension above and every measure, so
   every page is a cut of the same data (BI-ready for Power BI as well).
2. A governed KPI library: KPI definition, formula, measurement, perspective, and targets per client and per
   country / market, effective-dated.
3. A scorecard page with the four perspectives, the same global filters and the AAC split everywhere; the
   influence-factors view; the strategic KPI table by country; narrative callouts generated from the data.
4. The same scorecard in three places: the Client Portal (their own data only), CRM (per client, inside the
   business review pack and client health) and the Watchtower internal reporting (across all clients).
