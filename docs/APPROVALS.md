# Approvals across System Guy

Audit of every approval, decision and sign-off point in the platform (migrations up to `20261021000003`), the platform
approvals framework, and the gaps still open. Each approval point is also documented as a record in the Watchtower
library **Approval policies** (`approval_policies`, seeded by `supabase/seed/m15_approvals.sql`).

## How the framework works

| Piece | Where |
|---|---|
| Policy library (maker-checker) | `approval_policies` in `20261021000001_watchtower_approval_policies.sql`; fields in `src/modules/libraries.ts` |
| Most specific active policy | `approval_policy_for(type, client, market, value)`: client policy beats market policy beats highest value threshold met; effective-dated via `library_effective` |
| Approval roles | `approval_has_role(role)`: `admin`, `internal`, `named_person`, `srt_agent`, `srt_lead`, `finance`, `procurement`, `procurement_head`, `sourcing_lead`, `doa`, `module_owner`, `briefing_lead`. External roles `client_approver` (client_users) and `vendor` are decided in their portals |
| Inbox | Every module exposes a view `approvals_<module>` (columns: module, approval_type, item_id, ref, title, requested_by, requested_at, amount, currency, client, market, region, status, approver_rule, href, can_decide). `approvals_inbox('mine' \| 'all')` unions every `approvals_%` view at run time; `'all'` is admin-only; `'mine'` = `can_decide` and never your own request where the policy is maker-checker |
| Overdue | `approval_status(type, requested_at, ...)`: older than the policy `sla_days` |
| Health | `approvals_summary()`, view `watchtower_health_approvals` (pending, overdue, oldest pending age) |
| UI | `/watchtower/approvals` (all approvals for admins, mine for others, filters, policy panel), Home "My approvals", policies at `/watchtower/libraries/approval_policies` |

To plug a new module in: create `approvals_<module>` with the columns above (pending items only), revoke select on it from
`anon, authenticated`, and add a policy record per approval type.

## Existing approval points

MC = maker-checker (decider is never the requester). "Inbox" = approval type shown in the approvals inbox.

### Watchtower
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Library version (libraries with `requires_approval`: core principles, DOA, Impact Grade, rate cards, high-value thresholds, sourcing control matrix, POD checklist, display scoring, finance rules, approval policies) | `library_approve` | Admin or owner of the library's module (`can_govern`) | Yes | – | `/watchtower/libraries/<key>` | LIBRARY, RATE_CARD |
| Change request review | `cr_start_review`, `cr_review` | Admin or module owner; every principle in the category checked; 20 s minimum | No | – | `/watchtower/change-requests` | CR_REVIEW |
| Change request verification | `cr_verify` | Admin or module owner | Yes (not the implementer) | – | same | CR_VERIFY |
| Scorecard methodology activation | `scorecard_activate` | Admin | No | Weights must total 100 | `/assure/watchtower/methodology` | – |
| Client Portal access | `client_access_grant` / `client_access_revoke` | Admin (audited) | No | – | `/watchtower/client-access` | – |
| User access | `admin_set_user_access` | Admin | No | – | `/assure/admin/users` | – |
| Sourcing+ access and DOA levels | `sourcing_set_access` | Admin or Sourcing+ owner | No | – | `/sourcing/admin` | – |

### Briefing+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Brief approval | `brief_decide` | Any colleague; now also the BRIEF policy role when a policy names one (demo: briefing lead) | Yes (not the author) | Policy `min_value` on `budget_high` | `/briefing/<id>` | BRIEF |
| Concept approval (new) | `concept_submit`, `concept_decide` | CONCEPT policy role (default briefing lead) | Yes (not the submitter) | Policy by client / market / `budget_high` (demo: 40,000+ needs Procurement head) | `/briefing/<id>#concepts`, `/briefing/campaign-ideation` | CONCEPT |
| Client concept approval (new) | `client_concept_decide` | Client approver (`client_users.role = 'approver'`); viewers refused | n/a | When the policy sets `client_approval_required` (demo: Heineken) | `/client-portal/briefs/<id>` | CONCEPT_CLIENT |
| Hand-off to Sourcing+ | `brief_handoff_create` | Internal; now requires an approved concept (and client approval when required) whenever a CONCEPT policy applies | – | – | `/briefing/<id>` | – |
| Campaign concept to briefs (new) | `campaign_concept_to_briefs` | Internal, approved concept only | – | – | `/briefing/campaign-ideation` | – |
| Sourcing+ accepts a hand-off | `brief_handoff_accept`, `job_create_from_handoff` | Internal | No | – | Sourcing+ | – |

### Shopper IQ
No approval points. `siq_record_effectiveness` and `siq_add_asset` write directly (any internal user).

### RFQ+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| High-value RFQ release | `rfq_approve_high_value` (checked in `rfq_send`) | Sourcing lead | Yes (not the RFQ creator) | `high_value_thresholds` library by market | `/rfq/<id>` | RFQ_HIGH_VALUE |
| Minimum suppliers invited | `rfq_send` | Rule (sourcing control matrix by value, client, cross-border) | – | Control matrix bands | `/rfq/<id>` | – |
| Quote finance approval | `rfq_finance_decide` | Finance (`sourcing_is_finance`) | No | – | `/finance/approvals` | QUOTE_FINANCE |
| Award | `rfq_award` | Any internal user; checks bidding closed, finance-approved quote, supplier eligible in Assure+, minimum quotes or an active bypass reason | No | Min quotes from control matrix | `/rfq/<id>` | – |

### Sourcing+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Pushed rate-card price | `triage_push_respond` | Vendor (standard or admin team member; viewers refused) | – | Push confidence threshold, respond-by days | Vendor portal | PUSH_PRICE (shown, vendor decides) |
| Triage override | `spec_triage_override` | Any internal user, reason required | No | – | `/sourcing/specs/<id>` | – |
| Module settings (tolerance, instant price limit) | `sourcing_update_settings` | Admin or Sourcing+ owner, reason required | No | – | Sourcing+ Watchtower | – |

### Order Management+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Client estimate decision | `client_estimate_decide` (client), `estimate_approve` (internal confirms, hands off to Stocktool) | Client approver records; any internal user confirms | No | – | `/client-portal/estimates`, `/orders/estimates/<id>` | ESTIMATE_CLIENT |
| Purchase order | `po_approve` | DOA level ≥ level required by PO value (`doa_levels` library); no admin bypass | Yes (not the raiser) | DOA ceilings by currency | `/orders/purchase-orders/<id>` | PO_DOA |
| PO rejection | `po_reject` | Any internal user | No | – | same | – |
| Vendor PO acceptance | `po_vendor_respond` | Vendor | – | – | Vendor portal | – |
| PSA exception: line manager | `psa_line_manager_decide` | The line manager named by the requester | Yes | – | `/orders/psa/<id>` | PSA_LINE_MANAGER |
| PSA exception: assessment | `psa_assess` | `srt_role = procurement` or sourcing lead | Yes | – | same | PSA_ASSESS |
| PSA exception: approval | `psa_approve` | DOA level ≥ level required by the fee | Yes | DOA by fee | same | PSA_APPROVE |
| PSA exception: apply | `psa_apply` | Finance | No | – | same | PSA_APPLY |

### Finance+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Estimate finance review | `finance_estimate_decide` (queue in `v_finance_estimates.needs_review`) | Finance | No | Margin < FR-MIN-MARGIN, value ≥ FR-REVIEW-VALUE, or bypass award | `/finance/approvals` | ESTIMATE_FINANCE |
| Supplier invoice approval | `finance_match_invoice`, `finance_approve_invoice` | Finance, after the three-way match | No (matched) | FR-TOL tolerance | `/finance/invoices/<id>` | INVOICE_APPROVE |
| Invoice match override | `finance_request_override` + `finance_approve_invoice` | Finance | Yes (override author ≠ approver) | – | same | INVOICE_OVERRIDE |
| Dispute / reject / schedule / mark paid | `finance_dispute_invoice`, `finance_reject_invoice`, `finance_schedule_payment`, `finance_mark_paid` | Finance | No | – | `/finance/invoices`, `/finance/payments` | – |
| Client bill | `finance_bill_create`, `finance_bill_send`, `finance_bill_cancel` | Finance (from an approved estimate) | No | – | `/finance/billing` | – |

### Logistics+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Proof of delivery | `logistics_pod_verify`, `logistics_pod_reject` | Any internal user; every mandatory `pod_checklist` point | Yes (not the uploader) | – | `/logistics/pods` | POD_VERIFY |
| Mark delivered | `logistics_mark_delivered` | Any internal user (shipment recorded) | No | – | `/logistics/deliveries/<id>` | – |

### Execution+
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Deployment audit | `execution_audit_deployment` | Any internal user | Yes (not who recorded the install) | Pass mark EXR-PASS | `/execution/deployments/<id>` | DEPLOYMENT_AUDIT |
| Quality gates (mock-up, production, installation, closure) | `execution_gate_sign_off` | Any internal user, in order, check sheet uploaded | No | – | `/execution/jobs/<id>` | QUALITY_GATE |
| Job close (with override of soft checks) | `execution_close_job` | Any internal user, override reason | No | – | `/execution/jobs/<id>` | – |
| Recce production ready | `execution_recce_set_status` | Any internal user | No | – | `/execution/recces/<id>` | – |

### Assure+ (internal) and SRT desk
| What | Function | Who may approve | MC | Threshold | UI | Inbox |
|---|---|---|---|---|---|---|
| Onboarding gates | `update_supplier_gate` | SRT agent/lead; bank gate Finance; approval gate Procurement head; "not required" SRT lead; admin any | No | – | `/assure/suppliers/<id>` | SRT_GATE, SRT_BANK, SRT_ONBOARDING_APPROVAL |
| Fast-track exception | `approve_fast_track` | SRT lead | Yes (not the supplier's creator) | – | supplier page | – |
| Vendor information (RFI) | `review_vendor_rfi` | Procurement head | No | – | `/assure/srt/tickets/<id>` | VENDOR_RFI |
| Certificate | `assure_review_certificate` | Any internal user | Yes (not the uploader) | Not expired | `/assure/compliance/review` | CERTIFICATE |
| Control document | `assure_review_document` | Any internal user | Yes (not the uploader) | – | same | DOCUMENT |
| Pre-assessment | `assure_pa_transition` | Vendor manager (SRT agent/lead), then procurement | Partly (confirmer ≠ VM reviewer) | – | `/assure/pre-assessments/<id>` | PRE_ASSESSMENT_VM, PRE_ASSESSMENT_PROCUREMENT |
| Business review outcomes | `assure_review_approve_outcomes` | Procurement head | Yes (not the author) | – | `/assure/reviews/<id>` | REVIEW_OUTCOMES |
| Survey response | `assure_survey_review` | Any internal user | No | – | `/assure/surveys` | SURVEY_REVIEW |
| Workflow step | `assure_workflow_act` | Step's approver role (vendor manager, compliance, procurement lead, executive) | Yes (not previous step's approver) | Step SLA | `/assure/workflows/<id>` | WORKFLOW_STEP |
| Corrective action | `assure_ca_set_status` (verified) | Any internal user | Yes (not who completed it) | – | `/assure/quality/ncr/<id>` | CA_VERIFY |
| NCR close | `assure_ncr_close` | Any internal user, all actions verified | No | – | same | – |
| Supplier status | `assure_set_supplier_status` | SRT lead, Procurement head, admin | No | – | `/assure/suppliers` | – |
| Supplier risk | `assure_set_risk_level` | Vendor manager, procurement, admin | No | – | supplier page | – |
| Contract | `assure_contract_action` (send) | Any internal user | No | – | `/assure/contracts/<id>` | – |

### Vendor portal
| What | Function | Who may approve | MC | UI | Inbox |
|---|---|---|---|---|---|
| Vendor application | `vendor_application_decide` | Procurement or vendor manager | No | `/assure/applications` | VENDOR_APPLICATION |
| Plan change request | `assure_set_subscription`, `assure_decline_subscription_request` | Procurement / Procurement head | No | supplier page | SUBSCRIPTION |
| Contract signature | `vendor_contract_sign` | Vendor signer | – | `/vendor` | – |
| Quote, PO response, pushed price, NCR response | `rfq_submit_quote`, `po_vendor_respond`, `triage_push_respond`, `assure_ncr_vendor_respond` | Vendor admin/standard (viewers refused by `_vendor_block_viewer`) | – | `/vendor` | – |

### Client Portal
| What | Function | Who may approve | UI | Inbox |
|---|---|---|---|---|
| Estimate | `client_estimate_decide` | Client approver (viewer refused); internal confirms | `/client-portal/estimates/<id>` | ESTIMATE_CLIENT |
| Concept (new) | `client_concept_decide` | Client approver (viewer refused) | `/client-portal/briefs/<id>` | CONCEPT_CLIENT |

## Gaps

Briefing+ gaps closed in this change: concepts went to Sourcing+ with no sign-off; no client sign-off on concepts;
campaign ideation went straight to a brief with no approval; brief approver was not tied to a role or value.

Open gaps, by module, with the recommended approval step:

| Module | Gap | Recommended approval step |
|---|---|---|
| Watchtower | `scorecard_activate`: one admin makes a new methodology live (drives PSL and tiers). | Submit draft → a second admin or Assure+ owner activates (SCORECARD policy, maker-checker). |
| Watchtower | Libraries without `requires_approval` go live on one person's edit: substrates, material/transport emission factors (reported CO2e), bypass reasons (unlock RFQ bypass), carriers, certification types, incoterms. | Set `requires_approval` on emission factors, substrates and bypass reasons (LIBRARY policy). |
| Watchtower | `sourcing_set_access` (DOA levels, finance/lead flags) and `admin_set_user_access` (admin, SRT roles) by a single person. | Access change request approved by a second admin; DOA grants need Finance/Procurement head confirmation. |
| Watchtower | `client_access_grant` gives client approver rights with one admin. | Second admin (or the account's job manager) confirms approver grants. |
| RFQ+ | `rfq_award`: any internal user awards; not tied to role or value; can be the RFQ creator. | Award by sourcing lead or DOA by awarded value, not the RFQ creator (RFQ_AWARD policy). |
| RFQ+ | Bypass award (fewer than minimum quotes): any active bypass reason is enough; the library's `needs_approval` flag is not enforced. | Sourcing lead approves bypass awards when the reason needs approval. |
| RFQ+ | `rate_card_exception` on an RFQ only needs a reason. | Sourcing lead approves the exception before `rfq_send`. |
| RFQ+ | `rfq_finance_decide`: the finance user who logged an internal quote (`rfq_log_quote`) can approve it. | Maker-checker for internally logged quotes. |
| Sourcing+ | `spec_triage_override`: any internal user can move a spec to Adopt/Adapt and skip the RFQ. | Sourcing lead approves overrides that skip an RFQ. |
| Sourcing+ | `sourcing_update_settings` (triage tolerance, instant price limit) by one governor. | Move to a maker-checker library or require a second governor. |
| Order Management+ | `estimate_send` does not wait for the Finance review even when `needs_review` (low margin, high value, bypass). | Block send until ESTIMATE_FINANCE is approved. |
| Order Management+ | `estimate_approve`: any internal user records client approval, with no client decision or client PO on record. | Require a client approver decision (or client PO) and the job manager/sourcing lead to confirm; not the estimate creator. |
| Order Management+ | `po_reject`: no DOA check; the raiser can reject. | Same DOA rule as `po_approve`. |
| Order Management+ | `exceeds_e_tender` is flagged on the PO but needs no approval. | Procurement head approval when the e-tender threshold is exceeded. |
| Order Management+ | PSA line manager is any internal person the requester names. | Line manager from the people directory/role, not free choice. |
| Finance+ | `finance_approve_invoice` (matched): no value threshold; one finance user can match, approve, schedule and mark paid. | DOA by invoice value above a FR threshold; payment release by a different finance user (maker-checker). |
| Finance+ | `finance_bill_cancel` (credit) by one finance user. | Second finance user approves cancellations of sent bills. |
| Finance+ | `finance_estimate_decide` has no maker-checker against the estimate's creator. | Reviewer ≠ estimate creator. |
| Logistics+ | `logistics_mark_delivered` marks a delivery delivered without a verified POD (feeds OTIF and job status). | Require verified POD, or a logistics lead override with reason. |
| Execution+ | `execution_gate_sign_off`: any internal user, can be the check-sheet uploader, no quality role. | Quality/operations role, not the uploader (QUALITY_GATE maker-checker). |
| Execution+ | `execution_close_job` override of soft checks by one person. | Sourcing lead approves closing with overrides. |
| Execution+ | `execution_recce_set_status` production ready by anyone (drives production sizes). | Second person signs off production-ready recces. |
| Assure+ | `update_supplier_gate`: the agent who requested/uploaded evidence can verify it; critical gates have no second check. | Maker-checker on critical gates. |
| Assure+ | `approve_fast_track` has no request step, so nothing queues for approval. | Request (agent) → approve (SRT lead), shown in the inbox. |
| Assure+ | `assure_set_supplier_status` can reactivate a suspended/offboarded supplier with one person. | Maker-checker for moves back to active. |
| Assure+ | `assure_contract_action` sends contracts to vendors with no internal approval of terms or value. | Procurement head (or legal) approves before send, by contract value. |
| Assure+ | `assure_set_inspection_result` can change fail → pass with a note. | Second person approves result changes away from fail. |
| Assure+ | `assure_survey_review`, `assure_ncr_close`, `assure_issue_resolve`: any internal user, no maker-checker. | Not the launcher/owner; quality role for NCR close. |
| Assure+ | Pre-assessment `send_terms` (NTI, payment terms) has no check against standard terms. | Finance approves non-standard payment terms. |
| Shopper IQ | `siq_record_effectiveness`: uplift figures shown to clients (portal, reports) without verification. | Verify (maker-checker) before results are client-visible. |
| Shopper IQ | `siq_add_asset`: assets reused in briefs with no rights/brand approval. | Brand/rights sign-off before an asset is available to Briefing+. |

## Known limits
- Policy value thresholds compare numbers only (`currency` on a policy is informational); briefs in other currencies are not converted.
- Concept client approval applies to concepts on a brief; campaign ideation concepts are approved internally only.
- The inbox runs every `approvals_%` view on each call; fine for demo volumes, may need materialisation at scale.
- `ESTIMATE_CLIENT` "mine" shows the job manager, the estimate creator and sourcing leads (the function itself still lets any internal user confirm; see gaps).
