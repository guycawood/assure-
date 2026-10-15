# Approvals across System Guy

Audit of every approval, decision and sign-off point in the platform (migrations up to `20261022000003`), the platform
approvals framework, and the gaps still open. Each approval point is also documented as a record in the Watchtower
library **Approval policies** (`approval_policies`, seeded by `supabase/seed/m15_approvals.sql` and
`supabase/seed/m16_approvals_gaps.sql`).

## How the framework works

| Piece | Where |
|---|---|
| Policy library (maker-checker) | `approval_policies` in `20261021000001_watchtower_approval_policies.sql`; fields in `src/modules/libraries.ts` |
| Most specific active policy | `approval_policy_for(type, client, market, value)`: client policy beats market policy beats highest value threshold met; effective-dated via `library_effective` |
| Approval roles | `approval_has_role(role)`: `admin`, `internal`, `named_person`, `srt_agent`, `srt_lead`, `finance`, `procurement`, `procurement_head`, `sourcing_lead`, `doa`, `module_owner`, `briefing_lead`, and (new) `quality` (SRT lead, Procurement head, sourcing lead, SRM/Execution+ owner), `logistics_lead` (sourcing lead, Logistics+ owner), `line_manager` (SRT lead, Procurement head, sourcing lead). External roles `client_approver` (client_users) and `vendor` are decided in their portals. `approval_role_people(role)` lists who holds a role |
| Requests (new) | `approval_requests` in `20261022000001_watchtower_approval_requests.sql`: a gated function opens a request instead of acting; the policy at request time sets approver role, maker-checker and DOA level. `approval_request_decide(id, approve, note)` checks maker-checker (never the requester or `excluded_users`, e.g. the RFQ creator), the role and DOA, then applies the action in the same transaction (`run_as`: the approver applies it, it runs with the requester's rights, or approval only unlocks the next step). `approval_request_cancel` withdraws. Audit: append-only `approval_request_events`; direct decisions without a request go to append-only `approval_decisions` |
| How functions are gated | `20261022000002_platform_approval_gaps.sql`: each changed function was renamed to `public._core_<name>` and a wrapper with the same signature checks the rule, then calls the core. To change the logic later, replace `_core_<name>` |
| Inbox | Every module exposes a view `approvals_<module>` (columns: module, approval_type, item_id, ref, title, requested_by, requested_at, amount, currency, client, market, region, status, approver_rule, href, can_decide, market_name). Pending requests of a module are part of its view (`approval_requests_pending_v`). `approvals_inbox('mine' \| 'all')` unions every `approvals_%` view at run time; `'all'` is admin-only; `'mine'` = `can_decide` and never your own request where the policy is maker-checker |
| Markets | `market` in the inbox is the market code from `public.markets` and `market_name` the name (`_market_code` / `_market_name` accept a code or a name), so "DE" and "Germany" are one entry in the filters |
| Overdue | `approval_status(type, requested_at, ...)`: older than the policy `sla_days` |
| Health | `approvals_summary()`, view `watchtower_health_approvals` (pending, overdue, oldest pending age) |
| UI | `/watchtower/approvals` (all approvals for admins, mine for others, filters, policy panel), Home "My approvals", policies at `/watchtower/libraries/approval_policies`. Pages where a request lives show the shared `ApprovalRequests` panel (`src/components/approvals/requests.tsx`: Approve / Reject for whoever may decide, Withdraw for the requester, recent decisions) |

To plug a new module in: create `approvals_<module>` with the columns above (pending items only), revoke select on it from
`anon, authenticated`, and add a policy record per approval type. For a request -> approve step, call
`_approval_request_open(...)` from the gated function and add the apply step to `_approval_request_apply`.

### Enforcement: policy-driven or always on

Most new steps are **policy-driven**, exactly like the Briefing+ concept gate: they apply when an active policy of that
type exists for the item (and request -> approve steps when that policy is maker-checker). Without a policy the platform
behaves as before, so existing flows and tests are unchanged; the demo seed `m16_approvals_gaps.sql` adds or tightens the
policies, so the demo enforces them. **Always on** (no policy needed): PO rejection under DOA, internally logged quotes
approved by a different finance user, Finance never reviews an estimate it created, cancelling a sent client bill and
changing Sourcing settings need a second person, Shopper IQ results recorded in the app are verified before clients see
them, and assets added in the app need a rights/brand sign-off.

## Approval points

MC = maker-checker (decider is never the requester). "Inbox" = approval type shown in the approvals inbox.
"Policy" = enforced when that policy type exists (demo: on).

### Watchtower
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Library version (libraries with `requires_approval`: core principles, DOA, Impact Grade, rate cards, high-value thresholds, sourcing control matrix, POD checklist, display scoring, finance rules, approval policies; demo also substrates, material and transport emission factors, bypass reasons) | `library_approve` | Admin or owner of the library's module (`can_govern`) | Yes | – | `/watchtower/libraries/<key>` | LIBRARY, RATE_CARD |
| Change request review | `cr_start_review`, `cr_review` | Admin or module owner; every principle in the category checked; 20 s minimum | No | – | `/watchtower/change-requests` | CR_REVIEW |
| Change request verification | `cr_verify` | Admin or module owner | Yes (not the implementer) | – | same | CR_VERIFY |
| Scorecard methodology activation (closed gap) | `scorecard_activate` (request), `approval_request_decide` | SCORECARD policy role (demo: admin or SRM owner); weights must total 100 | Yes (policy) | – | request on `/assure/watchtower/methodology`, decide on `/assure/watchtower` | SCORECARD |
| Client Portal access | `client_access_grant` / `client_access_revoke` | Admin (audited); approver rights confirmed by a second admin (closed gap, CLIENT_ACCESS policy) | Yes for approver grants (policy) | – | `/watchtower/client-access` | CLIENT_ACCESS |
| User access (closed gap) | `admin_set_user_access` (request), `approval_request_decide` | ACCESS_USER policy role (demo: a second admin) | Yes (policy) | – | `/assure/admin/users` | ACCESS_USER |
| Sourcing access and DOA levels (closed gap) | `sourcing_set_access` (request), `approval_request_decide` | Requested by admin or Sourcing owner; ACCESS_SOURCING policy role confirms (demo: Procurement head) | Yes (policy) | – | `/sourcing/admin` | ACCESS_SOURCING |

### Briefing+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Brief approval | `brief_decide` | Any colleague; the BRIEF policy role when a policy names one (demo: briefing lead) | Yes (not the author) | Policy `min_value` on `budget_high` | `/briefing/<id>` | BRIEF |
| Concept approval | `concept_submit`, `concept_decide` | CONCEPT policy role (default briefing lead) | Yes (not the submitter) | Policy by client / market / `budget_high` (demo: 40,000+ needs Procurement head) | `/briefing/<id>#concepts`, `/briefing/campaign-ideation` | CONCEPT |
| Client concept approval | `client_concept_decide` | Client approver (`client_users.role = 'approver'`); viewers refused | n/a | When the policy sets `client_approval_required` (demo: Heineken) | `/client-portal/briefs/<id>` | CONCEPT_CLIENT |
| Hand-off to Sourcing | `brief_handoff_create` | Internal; requires an approved concept (and client approval when required) whenever a CONCEPT policy applies | – | – | `/briefing/<id>` | – |
| Campaign concept to briefs | `campaign_concept_to_briefs` | Internal, approved concept only | – | – | `/briefing/campaign-ideation` | – |
| Sourcing accepts a hand-off | `brief_handoff_accept`, `job_create_from_handoff` | Internal | No | – | Sourcing | – |

### Shopper IQ
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Result verification (closed gap) | `siq_record_effectiveness` (pending), `siq_verify_effectiveness` | SIQ_EFFECTIVENESS policy role (default anyone at adm Indicia; demo briefing lead). Client Portal functions return verified rows only | Yes (not who recorded it) | – | `/shopper-iq/campaigns` | SIQ_EFFECTIVENESS |
| Asset rights/brand sign-off (closed gap) | `siq_add_asset` (pending), `siq_asset_signoff` | SIQ_ASSET policy role (default anyone; demo briefing lead). Briefing+ reuses only `siq_assets_available` | Yes (not who added it) | – | `/shopper-iq/assets` | SIQ_ASSET |

### RFQ+ (Sourcing, module key `rfq`)
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| High-value RFQ release | `rfq_approve_high_value` (checked in `rfq_send`) | Sourcing lead | Yes (not the RFQ creator) | `high_value_thresholds` library by market | `/rfq/<id>` | RFQ_HIGH_VALUE |
| Rate-card exception (closed gap) | `rfq_send` (request), `approval_request_decide` | RATE_CARD_EXCEPTION policy role (demo: sourcing lead); approval unlocks Send | Yes (policy) | – | `/rfq/<id>` | RATE_CARD_EXCEPTION |
| Minimum suppliers invited | `rfq_send` | Rule (sourcing control matrix by value, client, cross-border) | – | Control matrix bands | `/rfq/<id>` | – |
| Quote finance approval | `rfq_finance_decide` | Finance (`sourcing_is_finance`); a quote logged internally is approved by a different finance user (closed gap, always) | Yes for logged quotes | – | `/finance/approvals` | QUOTE_FINANCE |
| Award (closed gap) | `rfq_award` | RFQ_AWARD policy role (demo: sourcing lead; 50,000+ DOA level covering the value); never the RFQ creator. Still checks bidding closed, finance-approved quote, supplier eligible, minimum quotes or bypass | Yes (policy) | Min quotes from control matrix; DOA by value | `/rfq/<id>` | RFQ_AWARD |
| Bypass award (closed gap) | `rfq_award` with a bypass reason flagged `needs_approval` (request), `approval_request_decide` | RFQ_BYPASS policy role (demo: sourcing lead); never the requester or the RFQ creator; approval makes the award | Yes (policy) | Fewer quotes than the minimum | `/rfq/<id>` | RFQ_BYPASS |

### Sourcing+ (Sourcing, module key `sourcing`)
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Pushed rate-card price | `triage_push_respond` | Vendor (standard or admin team member; viewers refused) | – | Push confidence threshold, respond-by days | Vendor portal | PUSH_PRICE (shown, vendor decides) |
| Triage override that skips the RFQ (closed gap) | `spec_triage_override` (request), `approval_request_decide` | TRIAGE_OVERRIDE policy role (demo: sourcing lead), applied by the approver | Yes (policy) | – | `/sourcing/specs/<id>` | TRIAGE_OVERRIDE |
| Module settings (closed gap) | `sourcing_update_settings` (request), `approval_request_decide` | SOURCING_SETTINGS policy role (default admin or Sourcing owner; demo sourcing lead) | Yes (always) | – | `/sourcing/admin` | SOURCING_SETTINGS |

### Order Management+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Estimate send (closed gap) | `estimate_send` | Blocked while the Finance review is needed or declined (when an ESTIMATE_FINANCE policy exists; demo: on) | – | Review triggers | `/orders/estimates/<id>` | – |
| Client estimate decision | `client_estimate_decide` (client), `estimate_approve` (internal confirmation) | Client approver records; the job manager or the ESTIMATE_CONFIRM policy role (demo: sourcing lead) confirms, only with a client decision on record or a client PO (closed gap) | Yes, not the estimate creator (policy) | – | `/client-portal/estimates`, `/orders/estimates/<id>` | ESTIMATE_CLIENT |
| PO e-tender (closed gap) | `po_etender_decide` (before `po_approve`) | PO_ETENDER policy role (demo: Procurement head) | Yes (not the raiser) | Client `e_tender_threshold` | `/orders/purchase-orders/<id>` | PO_ETENDER |
| Purchase order | `po_approve` | DOA level ≥ level required by PO value (`doa_levels` library); no admin bypass | Yes (not the raiser) | DOA ceilings by currency | same | PO_DOA |
| PO rejection (closed gap) | `po_reject` | Same DOA rule as approval (always) | Yes (not the raiser) | DOA | same | – |
| Vendor PO acceptance | `po_vendor_respond` | Vendor | – | – | Vendor portal | – |
| PSA exception: line manager (closed gap) | `psa_submit`, `psa_line_manager_decide` | The named line manager, who must hold the PSA_LINE_MANAGER policy role (demo: `line_manager`); picker lists only eligible people (`psa_line_manager_options`) | Yes | – | `/orders/psa/<id>` | PSA_LINE_MANAGER |
| PSA exception: assessment | `psa_assess` | `srt_role = procurement` or sourcing lead | Yes | – | same | PSA_ASSESS |
| PSA exception: approval | `psa_approve` | DOA level ≥ level required by the fee | Yes | DOA by fee | same | PSA_APPROVE |
| PSA exception: apply | `psa_apply` | Finance | No | – | same | PSA_APPLY |

### Finance+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Estimate finance review | `finance_estimate_decide` (queue in `v_finance_estimates.needs_review`) | Finance, never the estimate creator (closed gap, always) | Yes | Margin < FR-MIN-MARGIN, value ≥ FR-REVIEW-VALUE, or bypass award | `/finance/approvals` | ESTIMATE_FINANCE |
| Supplier invoice approval | `finance_match_invoice`, `finance_approve_invoice` | Finance, after the three-way match; above the INVOICE_APPROVE `doa` policy value also a DOA level covering the value (closed gap; demo 25,000+) | No (matched) | FR-TOL tolerance; DOA by value | `/finance/invoices/<id>` | INVOICE_APPROVE |
| Invoice match override | `finance_request_override` + `finance_approve_invoice` | Finance | Yes (override author ≠ approver) | – | same | INVOICE_OVERRIDE |
| Payment release (closed gap) | `finance_schedule_payment` | Finance, never the user who approved the invoice (PAYMENT_RELEASE policy) | Yes (policy) | – | `/finance/invoices/<id>`, `/finance/payments` | PAYMENT_RELEASE |
| Dispute / reject / mark paid | `finance_dispute_invoice`, `finance_reject_invoice`, `finance_mark_paid` | Finance | No | – | `/finance/invoices`, `/finance/payments` | – |
| Client bill | `finance_bill_create`, `finance_bill_send`, `finance_bill_cancel` | Finance (from an approved estimate); cancelling a sent bill is a request a second finance user approves (closed gap, always) | Yes for sent-bill cancellation | – | `/finance/billing/<id>` | BILL_CANCEL |

### Logistics+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Proof of delivery | `logistics_pod_verify`, `logistics_pod_reject` | Any internal user; every mandatory `pod_checklist` point | Yes (not the uploader) | – | `/logistics/pods` | POD_VERIFY |
| Mark delivered (closed gap) | `logistics_mark_delivered` | Needs a verified POD; otherwise only the DELIVERY_CONFIRM policy role (demo: logistics lead) with an override reason, logged as an override | – | – | `/logistics/deliveries/<id>` | – |

### Execution+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Deployment audit | `execution_audit_deployment` | Any internal user | Yes (not who recorded the install) | Pass mark EXR-PASS | `/execution/deployments/<id>` | DEPLOYMENT_AUDIT |
| Quality gates (closed gap) | `execution_gate_sign_off` | QUALITY_GATE policy role (demo: quality), in order, check sheet uploaded | Yes, not the check-sheet uploader (policy) | – | `/execution/jobs/<id>` | QUALITY_GATE |
| Job close with overrides (closed gap) | `execution_close_job` (request), `approval_request_decide` | JOB_CLOSE policy role (demo: sourcing lead) | Yes (policy) | – | `/execution/jobs/<id>` | JOB_CLOSE |
| Recce production ready (closed gap) | `execution_recce_set_status` (request), `approval_request_decide` | RECCE_READY policy role (demo: anyone at adm Indicia but the requester) | Yes (policy) | – | `/execution/recces/<id>` | RECCE_READY |

### SRM (internal) and SRT desk
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Onboarding gates | `update_supplier_gate` | SRT agent/lead; bank gate Finance; approval gate Procurement head; "not required" SRT lead; admin any. Critical gates never verified by who requested or supplied the evidence (closed gap, gate policy maker-checker) | Yes on critical gates (policy) | – | `/assure/suppliers/<id>` | SRT_GATE, SRT_BANK, SRT_ONBOARDING_APPROVAL |
| Fast-track exception (closed gap) | `approve_fast_track` (request by anyone), `approval_request_decide` | FAST_TRACK policy role (SRT lead) | Yes (not the requester, not the supplier's creator) | – | `/assure/suppliers/<id>` | FAST_TRACK |
| Vendor information (RFI) | `review_vendor_rfi` | Procurement head | No | – | `/assure/srt/tickets/<id>` | VENDOR_RFI |
| Certificate | `assure_review_certificate` | Any internal user | Yes (not the uploader) | Not expired | `/assure/compliance/review` | CERTIFICATE |
| Control document | `assure_review_document` | Any internal user | Yes (not the uploader) | – | same | DOCUMENT |
| Pre-assessment | `assure_pa_transition` | Vendor manager (SRT agent/lead), then procurement | Partly (confirmer ≠ VM reviewer) | – | `/assure/pre-assessments/<id>` | PRE_ASSESSMENT_VM, PRE_ASSESSMENT_PROCUREMENT |
| Non-standard payment terms (closed gap) | `assure_pa_transition('send_terms')` (request), `approval_request_decide` | PAYMENT_TERMS policy role (Finance); approval sends the terms | Yes (policy) | Shorter than `standard_payment_days` on the policy (demo 60) | `/assure/pre-assessments/<id>` | PAYMENT_TERMS |
| Business review outcomes | `assure_review_approve_outcomes` | Procurement head | Yes (not the author) | – | `/assure/reviews/<id>` | REVIEW_OUTCOMES |
| Survey response (closed gap) | `assure_survey_review` | SURVEY_REVIEW policy role; never who launched the survey | Yes (policy) | – | `/assure/surveys` | SURVEY_REVIEW |
| Workflow step | `assure_workflow_act` | Step's approver role (vendor manager, compliance, procurement lead, executive) | Yes (not previous step's approver) | Step SLA | `/assure/workflows/<id>` | WORKFLOW_STEP |
| Corrective action | `assure_ca_set_status` (verified) | Any internal user | Yes (not who completed it) | – | `/assure/quality/ncr/<id>` | CA_VERIFY |
| NCR close (closed gap) | `assure_ncr_close` | NCR_CLOSE policy role (demo: quality), all actions verified | Yes, not who raised it (policy) | – | same | NCR_CLOSE |
| Performance issue resolution (closed gap) | `assure_issue_resolve` | ISSUE_RESOLVE policy role; never the supplier's SRT owner | Yes (policy) | – | `/assure/performance` | ISSUE_RESOLVE |
| Inspection result away from fail (closed gap) | `assure_set_inspection_result` (request), `approval_request_decide` | INSPECTION_CHANGE policy role (demo: quality) | Yes (policy) | – | `/assure/quality` | INSPECTION_CHANGE |
| Supplier status | `assure_set_supplier_status` | SRT lead, Procurement head, admin; moving a suspended/offboarded supplier back to active is a request a second person approves (closed gap, SUPPLIER_REACTIVATE policy) | Yes for reactivation (policy) | – | `/assure/suppliers`, `/assure/suppliers/<id>` | SUPPLIER_REACTIVATE |
| Supplier risk | `assure_set_risk_level` | Vendor manager, procurement, admin | No | – | supplier page | – |
| Contract (closed gap) | `assure_contract_action('send')` (request), `approval_request_decide` | CONTRACT_APPROVE policy role (demo: Procurement head; 250,000+ admin as legal sign-off); approval unlocks Send | Yes, not the requester or the contract's creator (policy) | Contract value | `/assure/contracts/<id>` | CONTRACT_APPROVE |

### Vendor portal
| What | Function | Who may approve | MC | UI | Inbox |
|---|---|---|---|---|---|
| Vendor application | `vendor_application_decide` | Procurement or vendor manager | No | `/assure/applications` | VENDOR_APPLICATION |
| Plan change request | `assure_set_subscription`, `assure_decline_subscription_request` | Procurement / Procurement head | No | supplier page | SUBSCRIPTION |
| Contract signature | `vendor_contract_sign` | Vendor signer (only after internal approval when a CONTRACT_APPROVE policy applies) | – | `/vendor` | – |
| Quote, PO response, pushed price, NCR response | `rfq_submit_quote`, `po_vendor_respond`, `triage_push_respond`, `assure_ncr_vendor_respond` | Vendor admin/standard (viewers refused by `_vendor_block_viewer`) | – | `/vendor` | – |

### Client Portal
| What | Function | Who may approve | UI | Inbox |
|---|---|---|---|---|
| Estimate | `client_estimate_decide` | Client approver (viewer refused); the job manager or a sourcing lead confirms | `/client-portal/estimates/<id>` | ESTIMATE_CLIENT |
| Concept | `client_concept_decide` | Client approver (viewer refused) | `/client-portal/briefs/<id>` | CONCEPT_CLIENT |
| Effectiveness and reports | `client_portal_effectiveness`, `client_portal_report` | Verified Shopper IQ results only | `/client-portal` | – |

## Gaps

Closed: every gap listed in the previous audit for Watchtower, Shopper IQ, RFQ+, Sourcing+, Order Management+, Finance+,
Logistics+, Execution+ and SRM (marked "closed gap" above), plus the Briefing+ gaps closed earlier. The inbox now
normalises markets to the market master.

### Still open
- **Demo has one admin.** With the demo policies, user-access changes (ACCESS_USER) and client approver grants
  (CLIENT_ACCESS) need a second admin, so Ada Admin's requests wait. Add a second admin, or point those policies at another
  role, to clear them.
- **Roles are mapped, not managed.** `quality`, `logistics_lead` and `line_manager` map onto existing roles; there is no
  people directory or reporting line yet, so the PSA line manager is "someone holding a line-manager role", not the
  requester's actual manager.
- **Issue "owner".** Performance issues have no owner column; the owner is taken to be the supplier's SRT owner.
- **Contract approval is not reset** if a draft is edited after internal approval.
- **Libraries without `requires_approval`:** carriers, certification types and incoterms still go live on one edit;
  substrates, emission factors and bypass reasons are switched on by the demo seed only (existing environments keep their
  setting until changed in the library definitions).
- **Payment release** maker-checker covers scheduling; marking an instalment paid has no second check.
- **Invoice DOA** uses the PO DOA matrix (`doa_levels`); there is no separate invoice matrix.
- **Shopper IQ assets:** nothing in Briefing+ reuses assets yet; `siq_assets_available` is the gate for when it does.

## Known limits
- Policy value thresholds compare numbers only (`currency` on a policy is informational); values in other currencies are not converted.
- Concept client approval applies to concepts on a brief; campaign ideation concepts are approved internally only.
- The inbox runs every `approvals_%` view on each call; fine for demo volumes, may need materialisation at scale.
- Requests that run with the requester's rights (`run_as = 'requester'`: scorecard, access changes, settings, payment terms) fail
  at approval time if the requester has lost the right meanwhile; the approver sees the reason.
