# SRM supplier onboarding: the nine-stage standard

SRM onboards suppliers to adm Indicia's *Global Vendor Onboarding: combined best-practice process flow*: nine controlled
stages, one evidence trail and explicit exit criteria. Everything below is enforced in Postgres (row-level security and
security-definer functions); the app only calls the functions.

Migrations: `20261039000001_srm_onboarding_stages.sql`, `20261039000002_srm_onboarding_workflow.sql`,
`20261039000003_srm_onboarding_governance.sql`. Demo seeds: `m00_srm_carry_over.sql`, `m98_srm_onboarding.sql`.
Tests: `tests/db/srm_onboarding.test.mjs`.

## Paths

- **Standard path.** No PO or engagement until the required approvals and signed documents are complete. On the standard
  path `purchasing_blocked` stays true until all nine stages are complete.
- **Exception path (fast-track).** Urgency needs a named approval, a minimum evidence pack and a dated remediation plan. See
  [Fast-track](#fast-track-exception-not-bypass).
- **Control plane.** One tracker (the onboarding control dashboard), one evidence trail (`gate_audit_log` +
  `onboarding_events`), one status taxonomy, a named owner and an audit trail for every step.

`suppliers.purchasing_blocked` remains the single order-block signal. Sourcing (eligible pool, RFQ invitations, triage
pushes, award, POs) reads it unchanged, so the standard-path block and the fast-track closure gate flow through everywhere.

## The nine stages

| # | Stage | Owner | Controls | Exit criterion | Gates |
|---|---|---|---|---|---|
| 1 | Business need | Requester | Business case | Business case recorded | `request` |
| 2 | Intake | Requester / SRT | Supplier type, category, client, market, urgency, estimated spend; no supplier RFI outside the route | Complete request | `intake` (workflow) |
| 3 | Triage | Procurement | Duplicate / existing supplier check; incumbent, strategic or tactical; standard or exception route | Procurement approves need and route | `triage` (workflow, critical) |
| 4 | Due diligence | Supplier / SRT | RFI, company and VAT, financial, capability, QMS, EMS, CSR, sanctions, client requirements | Evidence complete or documented gap | `rfi`, `registration`, `financial`, `capability`, `quality`, `environment`, `sustainability`, `sanctions` (critical), `client_requirements` |
| 5 | Risk gates | Category Manager / Quality | Category fit, competitiveness / NTI, quality, sustainability, audit need, client requirements | CM and Quality approval where the rules apply | `risk_review` (workflow, critical) |
| 6 | Contracts | SRT / Legal | NDA, Code of Conduct, MSA / T&Cs, PSA / SSA and schedules | Signed agreement set stored | `nda`, `coc`, `msa`, `psa` |
| 7 | Finance approval | Local Finance | Bank, tax and set-up validated | Local Finance approval | `bank`, `finance_approval` (workflow, critical) |
| 8 | System enablement | ERP / SRT | IDs from StockTool, NAV / ERP, Sourcing Hub; groups and panels | IDs reconciled and status synchronised | `setup`, `id_stocktool`, `id_erp`, `id_hub`, `panels` (workflow) |
| 9 | Activate & govern | Procurement | Welcome pack, training, owner, evidence location, expiry dates, review cadence | Supplier released for use and visible in reporting | `welcome_pack`, `training`, `owner`, `review_cadence` (workflow), `approval` |

`onboarding_stages` holds the stages (owner, controls, exit criterion and plain words for vendors). Every
`gate_definitions` row has a `stage_key`. A gate is *clear* when it is verified (and not expired), not required, or covered
by an approved documented gap that is not past its due date. The supplier's **current stage** is the first stage with an
open gate; a stage only completes when its exit criterion is met. Gates with `verifier_role = 'system'` are recorded only by
the stage functions; `update_supplier_gate` refuses them.

### Old gates to stages

| Original gate (14) | Stage now |
|---|---|
| request | 1 Business need |
| rfi, registration, financial, capability, quality, environment, sustainability | 4 Due diligence |
| nda, coc, msa | 6 Contracts |
| bank | 7 Finance approval (Finance verifies; then Local Finance approves) |
| setup | 8 System enablement (now "IDs reconciled and status synchronised") |
| approval | 9 Activate & govern ("released for use") |

Fifteen gates were added: intake, triage, sanctions, client_requirements, risk_review, psa, finance_approval, id_stocktool,
id_erp, id_hub, panels, welcome_pack, training, owner, review_cadence (`standard_gate = true`).

### Suppliers that existed before the standard

`_onb_carry_over` runs once per supplier (the migration for existing data; `m00_srm_carry_over.sql` for the demo
suppliers in a fresh build):

- **Approved before the standard** (every original critical gate clear): baseline `legacy`; the new gates are recorded as
  verified with the note "Carried over"; the original critical-gate rule keeps deciding the purchasing block. They are
  revalidated on the review cadence.
- **Still in flight**: baseline `standard`; intake and triage are carried over (so the information request can continue);
  everything else follows the nine stages.

## Workflow functions

| Stage | Function | Rules |
|---|---|---|
| 1-2 | `onboarding_request_submit(jsonb)` | Complete request; urgent needs reason, client need and required date; runs `onboarding_duplicate_check`. If anything matches, the requester must tick "not a duplicate" or link the existing supplier. Raises a `new_onboarding` SRT ticket. |
| 2 | `onboarding_duplicate_check(name, vat, registration, email, code)` | Same or similar name (legal suffixes ignored), same VAT / registration number, same email or website domain (free-mail domains ignored), same supplier ID, or an open request for a similar name. |
| 3 | `onboarding_triage(case, approve / decline / duplicate, route, relationship, note, existing_supplier)` | Procurement (in-market procurement, Procurement head or Director); never the requester. Approving creates the supplier (`SRM-0000n`) and profile, records request / intake / triage, and applies the minimum evidence set. The exception route needs an urgent request. |
| 3 | `send_vendor_rfi` (wrapped) | Refused for a prospect ticket or a supplier whose triage gate isn't clear: no RFI outside the route. |
| 4 | `onboarding_gap_raise` / `onboarding_gap_decide` | Only due-diligence evidence that allows a gap; reason, owner (internal person or the vendor), due date within 180 days; approved by an SRT lead or Procurement who is not the person who raised it. Clearing the gate closes the gap. |
| 5 | `onboarding_risk_submit` / `onboarding_risk_decide` | Opens after stage 4. The risk rules library decides whether the Category Manager and Quality approve (and whether an audit is needed). Approvers are never the submitter or the requester. |
| 6 | contracts register | A contract tagged with `onboarding_doc` (NDA, CoC, MSA, PSA, schedule; NDAs are tagged automatically) moves its gate: sent = requested, signed = received, counter-signed with a stored copy = verified. `onboarding_contract_link` tags existing contracts. |
| 7 | `onboarding_finance_decide` | Local Finance for the supplier's market, after stages 1-6 and once bank details are verified; never the requester. |
| 8 | `onboarding_record_system_id` / `onboarding_reconcile_ids` / `onboarding_allocate_panels` | Capture and reconciliation only: every required system has an ID, IDs are unique per system, the name matches the supplier or legal entity, VAT matches the supplier record. Reconciliation writes an `integration_outbox` event (`srm.onboarding.ids_reconciled`). |
| 9 | `onboarding_activate` | Procurement; never the triage approver. Needs owner, welcome pack sent, training (assigned / completed / not required), evidence location, expiry dates confirmed, review cadence. Releases the supplier (status active), sets the next review date, emails the welcome note and writes `srm.onboarding.released`. |

Every step writes `onboarding_events` (the evidence trail; `vendor_visible` rows are the ones a vendor may see) and, for
the hand-offs other systems care about, an `integration_outbox` row.

## Segregation of duties

Nobody can self-request, self-approve and self-activate the same supplier:

- requester ≠ triage approver (`onboarding_cases_sod_triage` check constraint and the triage function);
- triage approver ≠ activator (`onboarding_cases_sod_activate` and the activation function);
- a documented gap is approved by a second person (`onboarding_gaps_second_person`);
- risk gate approvers are never the submitter or requester; Finance never the requester;
- fast-track approvers are never the requester (`onboarding_ft_*_not_requester`, and the approval request excludes them).

The control dashboard lists any segregation exception; it should always show zero.

## Fast-track: exception, not bypass

1. **Urgency declared**: reason, client need, required date (`fast_track_request`).
2. **Minimum pack** (`onboarding_min_pack`): supplier identifiable (registration or VAT number), vendor form received, bank
   details received, NDA and Code of Conduct status known.
3. **Named approval**: two approval requests through the approvals framework: `FAST_TRACK` (Procurement Director) and
   `FAST_TRACK_FINANCE` (Local Finance for the supplier's market). Approver roles come from the approval policies
   (`AP-FAST-TRACK`, `AP-FAST-TRACK-FIN`) and the onboarding settings. Either refusal refuses the exception.
4. **Restricted activation**: the named job(s) and / or a value cap (and the systems in scope). Sourcing refuses RFQ
   invitations and POs outside the scope (`onboarding_scope_block`, triggers on `rfq_invitations` and `purchase_orders`)
   until the supplier is fully onboarded.
5. **Remediation clock**: on approval, one remediation item per missing due-diligence / contract item, owned by the vendor
   or a named person, due by the close-by date.
6. **Closure gate**: any overdue remediation item sets `purchasing_blocked` (no further orders) and shows on the dashboard.
   Clearing the gate closes the item. Only the Procurement Director can waive an item, with a reason.

The old single-approver `approve_fast_track` is superseded (it now explains the exception route); pending requests made
under it were cancelled by the migration.

## Status taxonomy

`srm_status_taxonomy(kind, status, resolution)` maps everything onto one vocabulary, shown everywhere in the UI:

| Taxonomy | Case | Supplier | Ticket | Gate | Fast-track |
|---|---|---|---|---|---|
| Submitted | submitted | — | new, triage | missing | requested |
| In review | in onboarding | in the nine stages | in progress, waiting | requested, received | — |
| Approved | released | released for use | resolved (completed) | verified, not required | closed |
| Declined | declined, duplicate, withdrawn | request declined | resolved (rejected, duplicate, withdrawn) | rejected | rejected, cancelled |
| Exception | — | approved fast-track | — | — | approved |
| On hold | on hold | suspended, inactive, offboarded | — | — | — |

"Active" on its own is no longer used to describe a supplier that hasn't completed onboarding: the directory, the SRM home
page and the supplier header show the onboarding line (for example "In review · stage 4 of 9 (Due diligence)").

## Single supplier record and the scorecard

`srm_supplier_record(supplier)` returns one read of the supplier: identity and IDs, the nine stages with every control,
documented gaps, risk review, contract set, system IDs and panels, certificates and expiry, activation pack, fast-track,
remediation, approvals and decisions, and the merged evidence trail. It drives the **Onboarding record** tab on the
supplier page.

The scorecard reads `scorecard_inputs_effective`: the Code of Conduct comes from the onboarding CoC gate, never from a
separately keyed input. A supplier is on the Preferred Supplier List only when it is active, released, not blocked and not
on a fast-track; otherwise the row shows "Not preferred: onboarding incomplete".

## Control dashboard (`/assure/srt`)

`srm_onboarding_dashboard(region, market, client, category)`: totals by taxonomy, pipeline by stage with ageing and
escalation (days in stage over the escalation setting), bottlenecks by owner, longest waiting, missing evidence by gate,
documented gaps due, fast-track remediation overdue and open exceptions, certificates expiring within 60 days, inactive and
duplicate supplier flags, segregation exceptions, recent requests and open review tasks.

## Review cadence

Governed in `onboarding_review_cadence`; `srm_run_review_cadence()` (also run by `srt_daily_sweep`) creates one task per
period in `srm_review_tasks`:

- weekly: open cases; exceptions (fast-tracks and overdue remediation);
- monthly: overdue evidence (gaps past due, expired controls); expiring controls (next 60 days);
- quarterly: sample audit of released suppliers; access review of people holding SRM roles;
- revalidation by risk: high and critical every 12 months, medium 24, low 36 (from the supplier's next review date);
- event-based: `srm_raise_event(supplier, material_change | client_request | adverse_finding, note)` opens a revalidation
  case and a review task; an adverse finding also puts the sanctions screen back to requested (which blocks purchasing
  until it is re-verified).

Closing a revalidation task moves the next review date on by the supplier's cadence.

## SRM Watchtower: the four decisions

| Decision | Where |
|---|---|
| 1. Nine-stage flow as the global baseline for APAC, EMEA and NAM, with local legal and tax requirements per region | `onboarding_settings` (GLOBAL + APAC / EMEA / NAM) |
| 2. Global minimum evidence set, varying by region, market, client and supplier type | `onboarding_evidence_sets` (most specific match applies at triage; critical gates can't be switched off) |
| 3. SRM is the system of record for status and evidence; other systems hold IDs and links | `onboarding_settings.system_of_record` and `required_systems` |
| 4. Exception and remediation governance | `onboarding_settings` (approver roles, largest value cap, longest remediation clock, remediation and escalation days, order blocking) and the approval policies |

Also governed: `onboarding_risk_rules` (when CM and Quality approve) and `onboarding_review_cadence`. Stage definitions are
in `onboarding_stages` (admins can edit the wording).

## Roles

| Role | Who | Does |
|---|---|---|
| Requester / market | anyone at adm Indicia | Business need, request, clarifications |
| Procurement / Category Manager | in-market procurement, Procurement head, Procurement Director (`srt_role = director`); Category Manager = head, director or a `category_manager` scope | Triage, category fit and commercials, panels, release |
| SRT / COE | SRT agents and leads | Intake, information request, evidence, contracts, tracker |
| Supplier | vendor portal | Information request, evidence, signatures, training, remediation items |
| Quality / Sustainability | SRT lead, Procurement head, sourcing lead, SRM owners, or a `quality` scope | Risk evidence, audits and certificates |
| Finance / ERP | Finance (`srt_role = finance`); Local Finance = `local_finance` scope by region or market (`srm_set_role_scope`) | Bank, tax and set-up; system IDs; fast-track Finance approval |

## Vendor view

`vendor_onboarding_tracker()` (vendor users only, their own company) gives the nine steps in plain words, what is needed
from the vendor now (vendor-facing gates only), and any remediation items or agreed gaps they own with due dates. Internal
notes, spend, approvals and urgency reasons are never returned. Vendors can also read their own vendor-owned remediation
items and gaps through RLS; cases, risk reviews, IDs and fast-track records are internal only. Page: `/vendor/onboarding`.

## Known gaps

- No live integration with StockTool, NAV / ERP or Sourcing Hub: IDs are captured and reconciled, and events are queued
  in `integration_outbox` for a future sender.
- The fast-track value cap is compared with PO values without currency conversion.
- The eligible-pool view (`v_eligible_suppliers`) still lists fast-track suppliers; the scope is enforced when they are
  invited or ordered from.
- Vendor applications from the public portal don't create onboarding cases yet; staff raise the request.
- Contract set completion relies on contracts being tagged; contracts created before the standard can be tagged from the
  onboarding record.
