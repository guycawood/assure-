# Geography master: specification

Source: the geography module spec exported from the Base44 prototype (Oct 2026), adapted for System Guy
(Next.js + Postgres). The geography master lives in the master Watchtower; every region and country field in
System Guy resolves through it.

## 1. Purpose
A single, standards-based geography master that every module resolves locations against. Two rules:
1. **Standards are the master.** Countries, subdivisions and trade locations are stored with their official codes
   (UN M49 numeric, ISO 3166-1 alpha-2/alpha-3, ISO 3166-2, UN/LOCODE). Business-defined regions (e.g. APAC / EMEA,
   procurement regions) are never the primary hierarchy; they are a reporting overlay mapped on top of the codes.
2. **Geography is never free text.** Any record that carries a location (outlets, delivery destinations, supplier
   sites, addresses, client accounts, markets) resolves its country / subdivision / locode through one shared
   cascading picker. Free text only for street lines and notes.

## 2. Access
Read: all signed-in users (the picker is used everywhere). Write: admins only; reference data changes are governed
and audited.

## 3. Entities
### 3.1 Core hierarchy (drives the picker)
- **Geography areas** (UN M49 hierarchy, one row per node): m49_code (3-digit, zero-padded; for countries equals
  ISO 3166-1 numeric), area_name, official_name, level (world | region | subregion | intermediate | country),
  parent_m49_code, region_m49 and subregion_m49 (denormalised), iso_alpha2 and iso_alpha3 (country level), active,
  display_order.
- **Subdivisions** (ISO 3166-2): country_alpha2, subdivision_code (e.g. GB-ENG, US-CA), subdivision_name,
  subdivision_type, parent_subdivision_code, active, display_order.
- **Locodes** (UN/LOCODE): un_locode (5 chars, e.g. GBLON, SGSIN), location_name, locode_type (city | port |
  airport | rail_terminal | warehouse | distribution | road | other), country_alpha2, subdivision_code, latitude and
  longitude as numbers (the coordinate source for emissions distance), active, display_order.

### 3.2 Supporting detail (include where other modules need it)
- Country detail: phone code, currency code, active market flag; successor / predecessor for retired codes;
  effective dates.
- Geographic aliases: alias name and type (common, official, historic, local language, abbreviation, source-system
  name, alternative spelling), language, linked to exactly one of country / subdivision / locode, source system.
  Used to resolve imported free text (e.g. "Holland", "UK") to a code.

### 3.3 Business reporting overlay (never replaces the standards)
- **Business regions** (flat operational regions, e.g. APAC, EMEA, Americas, GSC) and their country mapping.
- **Business geographies** (richer internal hierarchy: global business region, business subregion, market cluster,
  reporting cluster, operating territory; self-parented; effective dates).
- **Country to business geography mapping per purpose**: Procurement, Finance, Sustainability, Operations, Client
  Reporting, Supplier Management; effective dates; approved by / at.

## 4. The geography picker
One shared, controlled cascading selector used by every location field:
- Value: { m49_region_code, m49_area_code, country_alpha2, subdivision_code, locode }.
- Steps: Region (M49) → Sub-region / intermediate (M49) → Country (ISO 3166-1, value = alpha-2) → Subdivision
  (ISO 3166-2) → Location (UN/LOCODE).
- Sub-areas filter on region; countries filter on sub-region, or for an intermediate region on all its child
  sub-regions plus countries parented directly to it; subdivisions and locodes filter on country.
- Changing an upstream value clears everything downstream.
- Subdivision and location steps can be hidden; grid or stacked layout. Type-ahead country search as a shortcut.

## 5. Consumption rules
- Records store the codes (country_alpha2, subdivision_code, locode), never free-text names.
- Latitude / longitude come from the locode where available, else manual entry, and are stored on the consuming
  record at save time so history stays stable if the locode is corrected later.
- Display names (country, subdivision, location) are stored on the consuming record for list rendering.
- Business regions reach other modules only through the overlay mapping (country → region), so any "region"
  filter resolves to a set of standard country codes. Region and market stay separate fields.
- Seeding: UN M49 hierarchy and ISO 3166-1 countries in full; ISO 3166-2 and UN/LOCODE via admin import of the
  official files (a curated subset is seeded for the demo).

## 6. Admin UI (master Watchtower → Geography)
Tabs: Overview (counts, hierarchy depth), M49 areas (grouped by level, parent pickers, denormalised codes kept on
save), Subdivisions (filtered by country), Locodes (type, country, lat / lon), Business regions and overlays
(per-region and per-purpose country mapping), Aliases, Import. Admin-only actions, server-side search, no free-text
country entry.
