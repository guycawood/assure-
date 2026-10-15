-- QA/QC threshold management (SRM quality libraries, Order Management plans, vendor portal evidence).
--   A. Governed libraries (owner SRM = 'assure', maker-checker): qaqc_levels (L1 document upload ... L5 third-party audit),
--      qaqc_evidence_types, qaqc_level_rules (effective-dated threshold rules), qaqc_approved_bodies (labs, inspection
--      agencies, certification bodies). Order Management owns qaqc_settings (OTIF tolerance and the reporting targets).
--   B. qaqc_required_level(): the rule engine. Every rule that fires is returned in plain words; the highest minimum level
--      wins, then supplier-standing bumps are added (capped at L5). Raising a level needs a reason; lowering below the
--      computed level is a QAQC_LOWER approval request (quality role, maker-checker).
--   C. A QA/QC plan per PO line, created when the PO is issued (trigger) or for a spec before there is a PO. Checkpoints
--      (mock-up, production, pre-shipment, installation) each carry their required evidence and a status
--      required -> submitted -> auto_verified / needs_review -> verified / rejected. Hard failures (failed AQL, failed
--      result, expired certificate, unapproved body) raise an NCR in SRM quality (public.ncrs) and notify.
--   D. Vendor portal: qaqc_vendor_plans() / qaqc_vendor_submit() (viewer-gated through public._core_qaqc_vendor_submit).
--      Verification runs at upload, in the same transaction, inside _qaqc_verify().
--   E. Internal review: qaqc_review_checkpoint() by a quality role, never the uploader. v_supplier_quality_kpis.
--   I. Approvals: QAQC_VERIFY items in approvals_qaqc (module orders), QAQC_LOWER and QAQC_WAIVE requests.
-- Safe on existing data: new tables, a nullable client column and default library records only.

-- ---------------------------------------------------------------------------
-- Libraries
-- ---------------------------------------------------------------------------
insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('qaqc_levels', 'assure', 'QA/QC levels',
   'Five levels of QA/QC, from a simple document upload (L1) to a third-party audit (L5): checkpoints, required evidence, who verifies, the AQL reference and whether a quality sign-off is needed.', true, 20),
  ('qaqc_evidence_types', 'assure', 'QA/QC evidence types',
   'What a vendor can upload as QA/QC evidence (certificate of conformity, photo set, AQL report, lab test report, ...), the key data each needs and the file types allowed.', true, 21),
  ('qaqc_level_rules', 'assure', 'QA/QC threshold rules',
   'Which QA/QC level a spec or job needs: rules on spec type and category, the testing checklist, order value, quantity, destination market, client requirement, supplier standing, sustainability claims and cross-border supply. The highest level wins.', true, 22),
  ('qaqc_approved_bodies', 'assure', 'QA/QC approved bodies',
   'Laboratories, inspection agencies and certification bodies whose reports are accepted for L4 and L5 QA/QC.', true, 23),
  ('qaqc_settings', 'orders', 'QA/QC and OTIF settings',
   'OTIF on-time tolerance and the targets used in reporting and health: OTIF %, QA/QC first-time pass rate, review time and speed to market.', true, 24)
on conflict (key) do nothing;

-- Default records (editable in the Watchtower; new versions go through maker-checker).
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select x.k, x.code, x.name, x.data::jsonb, 'active', date '2026-01-01', 'Default (QA/QC threshold management)'
  from (values
  ('qaqc_levels', 'L1', 'L1 Document upload', '{"level":1,"description":"Supplier declaration or certificate of conformity uploaded before shipping.","checkpoints":["pre_shipment"],"required_evidence":["pre_shipment:COC|DECLARATION"],"verifier":"auto","signoff_required":false,"min_photos":0,"approved_body_required":false}'),
  ('qaqc_levels', 'L2', 'L2 Self-inspection', '{"level":2,"description":"The vendor inspects against the spec with a checklist and photos, then declares conformity.","checkpoints":["production","pre_shipment"],"required_evidence":["production:CHECKLIST","production:PHOTO_SET","pre_shipment:COC|DECLARATION"],"verifier":"auto","signoff_required":false,"min_photos":3,"approved_body_required":false}'),
  ('qaqc_levels', 'L3', 'L3 Production control', '{"level":3,"description":"Pre-production sample or mock-up approved, production check sheet, and an AQL sampling result recorded by the vendor.","checkpoints":["mockup","production","pre_shipment"],"required_evidence":["mockup:SAMPLE_APPROVAL","production:CHECKLIST","production:PHOTO_SET","pre_shipment:AQL_REPORT"],"verifier":"auto","aql_code":"AQL-2.5","signoff_required":false,"min_photos":3,"approved_body_required":false}'),
  ('qaqc_levels', 'L4', 'L4 Independent inspection', '{"level":4,"description":"adm Indicia QC or an appointed inspection agency inspects before shipment and reports an AQL result; a quality role verifies it.","checkpoints":["mockup","production","pre_shipment"],"required_evidence":["mockup:SAMPLE_APPROVAL","production:CHECKLIST","pre_shipment:INSPECTION_REPORT"],"verifier":"quality","aql_code":"AQL-2.5","signoff_required":true,"min_photos":0,"approved_body_required":true}'),
  ('qaqc_levels', 'L5', 'L5 Third-party audit', '{"level":5,"description":"Accredited lab testing and/or a factory audit by an accredited body, plus an independent final inspection and a certificate from an approved body.","checkpoints":["mockup","production","pre_shipment"],"required_evidence":["mockup:SAMPLE_APPROVAL","production:LAB_TEST_REPORT|AUDIT_REPORT","pre_shipment:INSPECTION_REPORT","pre_shipment:CERTIFICATE"],"verifier":"third_party","aql_code":"AQL-1.5","signoff_required":true,"min_photos":0,"approved_body_required":true}'),

  ('qaqc_evidence_types', 'COC', 'Certificate of conformity', '{"description":"The supplier certifies the goods conform to the spec.","needs":["issued_on"],"window":"po","lookback_days":0,"allowed_types":["application/pdf","image/"],"min_files":1}'),
  ('qaqc_evidence_types', 'DECLARATION', 'Supplier declaration', '{"description":"Signed declaration of conformity from the supplier.","needs":["issued_on"],"window":"po","lookback_days":0,"allowed_types":["application/pdf","image/"],"min_files":1}'),
  ('qaqc_evidence_types', 'PHOTO_SET', 'Photo set', '{"description":"Photos of the goods against the spec (one file per photo).","needs":[],"window":"none","allowed_types":["image/"],"min_files":1}'),
  ('qaqc_evidence_types', 'CHECKLIST', 'Inspection checklist / check sheet', '{"description":"The production or self-inspection check sheet, completed.","needs":[],"window":"none","allowed_types":["application/pdf","image/","application/vnd.","text/csv"],"min_files":1}'),
  ('qaqc_evidence_types', 'SAMPLE_APPROVAL', 'Sample / mock-up approval', '{"description":"Approval of the pre-production sample or mock-up.","needs":["issued_on"],"window":"po","lookback_days":30,"allowed_types":["application/pdf","image/"],"min_files":1}'),
  ('qaqc_evidence_types', 'AQL_REPORT', 'AQL sampling report', '{"description":"AQL sampling result recorded by the vendor: sample size, defects found and the result.","needs":["inspection_date","aql","result"],"window":"po","lookback_days":0,"allowed_types":["application/pdf","image/","application/vnd."],"min_files":1}'),
  ('qaqc_evidence_types', 'INSPECTION_REPORT', 'Independent inspection report', '{"description":"Pre-shipment or final inspection report with the AQL result, from adm Indicia QC or an approved inspection agency.","needs":["inspection_date","aql","result","body"],"window":"po","lookback_days":0,"body_types":["inspection_agency"],"allowed_types":["application/pdf"],"min_files":1}'),
  ('qaqc_evidence_types', 'LAB_TEST_REPORT', 'Lab test report', '{"description":"Test report from an accredited laboratory.","needs":["issued_on","result","body"],"window":"po","lookback_days":365,"body_types":["lab"],"allowed_types":["application/pdf"],"min_files":1}'),
  ('qaqc_evidence_types', 'AUDIT_REPORT', 'Factory audit report', '{"description":"Factory audit report from an accredited body.","needs":["issued_on","result","body"],"window":"po","lookback_days":365,"body_types":["certification_body"],"allowed_types":["application/pdf"],"min_files":1}'),
  ('qaqc_evidence_types', 'CERTIFICATE', 'Certificate', '{"description":"Product or chain-of-custody certificate (e.g. FSC, recycled content) from an approved body; must not be expired.","needs":["certificate_number","expires_on","body"],"window":"validity","body_types":["certification_body","lab"],"allowed_types":["application/pdf","image/"],"min_files":1}'),

  ('qaqc_level_rules', 'QR-PROMO', 'Promo and merchandise', '{"condition":"spec_type","values":["promo_merch"],"effect":"min_level","level":2,"explanation":"Promo and merchandise items need at least a vendor self-inspection with photos (L2)."}'),
  ('qaqc_level_rules', 'QR-3D', '3D displays and fixtures', '{"condition":"spec_type","values":["3d"],"effect":"min_level","level":2,"explanation":"3D displays and fixtures need at least a vendor self-inspection with photos (L2)."}'),
  ('qaqc_level_rules', 'QR-ELEC', 'Electronics and lighting', '{"condition":"lighting_electronics","values":["electronics","lighting"],"effect":"min_level","level":3,"explanation":"Items with lighting or electronics need production control with AQL sampling (L3)."}'),
  ('qaqc_level_rules', 'QR-FIXTURE', 'Permanent fixtures', '{"condition":"product_category","values":["permanent","fixture","furniture"],"effect":"min_level","level":4,"explanation":"Permanent fixtures need an independent pre-shipment inspection (L4)."}'),
  ('qaqc_level_rules', 'QR-FOOD', 'Food contact', '{"condition":"product_category","values":["food contact","food-contact","food"],"effect":"min_level","level":5,"explanation":"Food contact materials need accredited lab testing (L5)."}'),
  ('qaqc_level_rules', 'QR-CHILD', 'Children''s products', '{"condition":"product_category","values":["children","child","toy","kids"],"effect":"min_level","level":5,"explanation":"Children''s products and toys need accredited lab testing (L5)."}'),
  ('qaqc_level_rules', 'QR-TEST-LAB', 'Lab test on the spec', '{"condition":"testing_checklist","values":["lab_test"],"effect":"min_level","level":5,"explanation":"The spec''s testing checklist asks for a lab test, so accredited lab testing is required (L5)."}'),
  ('qaqc_level_rules', 'QR-TEST-INSP', 'Final or full inspection on the spec', '{"condition":"testing_checklist","values":["final_inspection","full_inspection"],"effect":"min_level","level":4,"explanation":"The spec''s testing checklist asks for a final or full inspection, so an independent inspection is required (L4)."}'),
  ('qaqc_level_rules', 'QR-TEST-PHYS', 'Physical tests on the spec', '{"condition":"testing_checklist","values":["drop_test","loading_test","pre_screen"],"effect":"min_level","level":3,"explanation":"The spec''s testing checklist asks for physical tests (drop, loading or pre-screen), recorded under production control (L3)."}'),
  ('qaqc_level_rules', 'QR-VAL-EUR-25K', 'Order value EUR 25,000+', '{"condition":"order_value","threshold":25000,"currency":"EUR","effect":"min_level","level":3,"explanation":"Orders of EUR 25,000 or more need production control with AQL sampling (L3)."}'),
  ('qaqc_level_rules', 'QR-VAL-EUR-100K', 'Order value EUR 100,000+', '{"condition":"order_value","threshold":100000,"currency":"EUR","effect":"min_level","level":4,"explanation":"Orders of EUR 100,000 or more need an independent inspection (L4)."}'),
  ('qaqc_level_rules', 'QR-VAL-GBP-20K', 'Order value GBP 20,000+', '{"condition":"order_value","threshold":20000,"currency":"GBP","effect":"min_level","level":3,"explanation":"Orders of GBP 20,000 or more need production control with AQL sampling (L3)."}'),
  ('qaqc_level_rules', 'QR-VAL-GBP-85K', 'Order value GBP 85,000+', '{"condition":"order_value","threshold":85000,"currency":"GBP","effect":"min_level","level":4,"explanation":"Orders of GBP 85,000 or more need an independent inspection (L4)."}'),
  ('qaqc_level_rules', 'QR-VAL-USD-27K', 'Order value USD 27,000+', '{"condition":"order_value","threshold":27000,"currency":"USD","effect":"min_level","level":3,"explanation":"Orders of USD 27,000 or more need production control with AQL sampling (L3)."}'),
  ('qaqc_level_rules', 'QR-QTY-10K', 'Quantity 10,000+', '{"condition":"quantity","threshold":10000,"effect":"min_level","level":2,"explanation":"Runs of 10,000 units or more need at least a vendor self-inspection (L2)."}'),
  ('qaqc_level_rules', 'QR-QTY-50K', 'Quantity 50,000+', '{"condition":"quantity","threshold":50000,"effect":"min_level","level":3,"explanation":"Runs of 50,000 units or more need AQL sampling (L3)."}'),
  ('qaqc_level_rules', 'QR-REG-MARKET', 'Regulated destination market', '{"condition":"destination_market","values":["US","CA","AU","JP","KR","CN","SA","AE"],"effect":"min_level","level":3,"explanation":"The goods go to a market with strict product-safety rules, so production control with AQL sampling is required (L3)."}'),
  ('qaqc_level_rules', 'QR-CLIENT', 'Client minimum QA/QC level', '{"condition":"client_requirement","effect":"min_level","explanation":"The client''s contract sets a minimum QA/QC level."}'),
  ('qaqc_level_rules', 'QR-SUP-NEW', 'New or unrated supplier', '{"condition":"supplier_unrated","effect":"bump","bump":1,"explanation":"The supplier is new or has no quality rating yet, so one level is added."}'),
  ('qaqc_level_rules', 'QR-SUP-LOW', 'Supplier quality below 70', '{"condition":"supplier_quality_below","threshold":70,"effect":"bump","bump":1,"explanation":"The supplier''s latest SRM quality score is below 70, so one level is added."}'),
  ('qaqc_level_rules', 'QR-SUSTAIN', 'Sustainability claim', '{"condition":"sustainability_claim","effect":"min_level","level":1,"evidence_add":["pre_shipment:CERTIFICATE"],"explanation":"The spec claims FSC or recycled content, so a certificate from an approved body is required."}'),
  ('qaqc_level_rules', 'QR-GSC', 'Cross-border / GSC supply', '{"condition":"cross_border","effect":"min_level","level":2,"explanation":"The goods are made in another market or supplied through the Global Supply Chain, so at least a self-inspection is required (L2)."}'),

  ('qaqc_settings', 'OTIF-TOL-DAYS', 'On-time tolerance (days after the promised date)', '{"value":0}'),
  ('qaqc_settings', 'OTIF-TARGET', 'OTIF target (%)', '{"value":95}'),
  ('qaqc_settings', 'QAQC-PASS-TARGET', 'QA/QC first-time pass rate target (%)', '{"value":90}'),
  ('qaqc_settings', 'QAQC-REVIEW-SLA-DAYS', 'QA/QC review: days a submission may wait for a quality role', '{"value":2}'),
  ('qaqc_settings', 'STM-TARGET-DAYS', 'Speed to market target: median days from brief to delivery', '{"value":60}'),

  ('ncr_categories', 'NCR-QAQC', 'QA/QC evidence failed', '{"severity":"high","description":"Raised automatically when QA/QC evidence fails verification (failed AQL or result, expired certificate, unapproved body) or a quality reviewer rejects it."}')
  ) x(k, code, name, data)
 where exists (select 1 from public.library_definitions d where d.key = x.k)
   and not exists (select 1 from public.library_records r where r.library_key = x.k and r.code = x.code);

-- Client requirement (CRM commercial data): the minimum QA/QC level the client's contract asks for.
alter table public.sourcing_clients add column if not exists qa_min_level int check (qa_min_level between 1 and 5);

-- ---------------------------------------------------------------------------
-- Library helpers
-- ---------------------------------------------------------------------------
-- Every record of a library in force on a date (one version per code).
create or replace function public._lib_current(p_key text, p_date date default current_date)
returns setof public.library_records language sql stable security definer set search_path = public as $$
  select e.* from (select distinct code from public.library_records where library_key = p_key and code is not null) c
   cross join lateral public.library_effective(p_key, c.code, p_date) e
   where e.id is not null;
$$;

create or replace function public.qaqc_setting(p_code text, p_default numeric, p_date date default current_date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(e.data->>'value', '')::numeric from public.library_effective('qaqc_settings', p_code, p_date) e where e.id is not null), p_default);
$$;

create or replace function public.qaqc_checkpoint_label(p text) returns text language sql immutable as $$
  select case p when 'mockup' then 'Mock-up / sample' when 'production' then 'Production' when 'pre_shipment' then 'Pre-shipment'
                when 'installation' then 'Installation' else initcap(replace(coalesce(p, ''), '_', ' ')) end;
$$;
create or replace function public._qaqc_checkpoint_seq(p text) returns int language sql immutable as $$
  select case p when 'mockup' then 1 when 'production' then 2 when 'pre_shipment' then 3 when 'installation' then 4 else 9 end;
$$;

-- ISO 2859-1 single sampling, normal inspection: acceptance number for a sample size and an AQL. Sample sizes between
-- the standard ones use the next smaller standard size; AQLs between the standard ones use the next stricter one.
create or replace function public.qaqc_aql_accept(p_sample int, p_aql numeric) returns int
language plpgsql immutable as $$
declare ns int[] := array[2,3,5,8,13,20,32,50,80,125,200,315,500,800,1250]; aqls numeric[] := array[0.65,1.0,1.5,2.5,4.0,6.5];
  i int := 0; a int := 0; k int;
begin
  if p_sample is null or p_aql is null then return null; end if;
  if p_aql <= 0 then return 0; end if;
  for k in 1..array_length(ns, 1) loop if ns[k] <= p_sample then i := k; end if; end loop;
  for k in 1..array_length(aqls, 1) loop if aqls[k] <= p_aql then a := k; end if; end loop;
  if i = 0 or a = 0 then return 0; end if;
  k := (i - 1) + (a - 4);  -- diagonal of the table, anchored on the AQL 2.5 column
  return case when k <= 3 then 0 when k <= 5 then 1 when k = 6 then 2 when k = 7 then 3 when k = 8 then 5 when k = 9 then 7
              when k = 10 then 10 when k = 11 then 14 else 21 end;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create sequence public.qaqc_plan_no;

create table public.qaqc_plans (
  id uuid primary key default gen_random_uuid(),
  plan_ref text unique,
  job_id uuid not null references public.jobs(id) on delete cascade,
  po_id uuid references public.purchase_orders(id) on delete cascade,
  estimate_line_id uuid references public.estimate_lines(id) on delete set null,
  spec_id uuid references public.job_specs(id) on delete set null,
  supplier_id uuid references public.suppliers(id),
  client_id uuid references public.sourcing_clients(id),
  region text,
  market text,
  computed_level int not null check (computed_level between 1 and 5),
  required_level int not null check (required_level between 1 and 5),
  level_record_id uuid references public.library_records(id),
  level_name text,
  level_data jsonb not null default '{}'::jsonb,
  rules_fired jsonb not null default '[]'::jsonb,
  extra_evidence text[] not null default '{}',
  context jsonb not null default '{}'::jsonb,
  level_reason text,
  level_set_by uuid references public.profiles(id) on delete set null,
  level_set_at timestamptz,
  status text not null default 'not_started' check (status in ('not_started','in_progress','passed','failed','waived')),
  passed_at timestamptz,
  failed_at timestamptz,
  waived_at timestamptz,
  waived_by uuid references public.profiles(id) on delete set null,
  waiver_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index qaqc_plans_po_line_uq on public.qaqc_plans (po_id, estimate_line_id) where po_id is not null and estimate_line_id is not null;
create unique index qaqc_plans_po_only_uq on public.qaqc_plans (po_id) where po_id is not null and estimate_line_id is null;
create unique index qaqc_plans_spec_uq on public.qaqc_plans (spec_id) where po_id is null and spec_id is not null;
create index qaqc_plans_job_idx on public.qaqc_plans (job_id);
create index qaqc_plans_supplier_idx on public.qaqc_plans (supplier_id, status);

create table public.qaqc_checkpoints (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.qaqc_plans(id) on delete cascade,
  checkpoint text not null check (checkpoint in ('mockup','production','pre_shipment','installation')),
  seq int not null,
  required_evidence text[] not null default '{}',     -- one entry per requirement; alternatives as 'COC|DECLARATION'
  verifier text not null default 'auto' check (verifier in ('auto','quality','third_party')),
  signoff_required boolean not null default false,
  min_photos int not null default 0,
  approved_body_required boolean not null default false,
  aql_record_id uuid references public.library_records(id),
  due_date date,
  status text not null default 'required'
    check (status in ('required','submitted','auto_verified','needs_review','verified','rejected','withdrawn')),
  failed boolean not null default false,               -- a hard check failed at the last verification
  submission_count int not null default 0,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_by_vendor boolean,
  submission jsonb not null default '{}'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  review_note text,
  rejection_reason text,
  first_time_pass boolean,
  ncr_id uuid references public.ncrs(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (plan_id, checkpoint)
);
create index qaqc_checkpoints_status_idx on public.qaqc_checkpoints (status, due_date);

create table public.qaqc_evidence (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references public.qaqc_checkpoints(id) on delete cascade,
  plan_id uuid not null references public.qaqc_plans(id) on delete cascade,
  supplier_id uuid references public.suppliers(id),
  submission_no int not null,
  evidence_type text not null,
  evidence_record_id uuid references public.library_records(id),
  file_id uuid references public.files(id) on delete set null,
  issued_on date,
  expires_on date,
  inspection_date date,
  body_code text,
  body_record_id uuid references public.library_records(id),
  body_name text,
  certificate_number text,
  sample_size int check (sample_size is null or sample_size > 0),
  defects_critical int check (defects_critical is null or defects_critical >= 0),
  defects_major int check (defects_major is null or defects_major >= 0),
  defects_minor int check (defects_minor is null or defects_minor >= 0),
  result text check (result is null or result in ('pass','fail')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_vendor boolean not null default false,
  created_at timestamptz not null default now()
);
create index qaqc_evidence_checkpoint_idx on public.qaqc_evidence (checkpoint_id, submission_no);

create table public.qaqc_events (
  id bigint generated always as identity primary key,
  plan_id uuid references public.qaqc_plans(id) on delete cascade,
  checkpoint_id uuid references public.qaqc_checkpoints(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index qaqc_events_plan_idx on public.qaqc_events (plan_id, at);
create trigger qaqc_events_no_update before update on public.qaqc_events for each row execute function public.trg_client_append_only();

create or replace function public._qaqc_event(p_plan uuid, p_checkpoint uuid, p_event text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.qaqc_events (plan_id, checkpoint_id, event, detail, actor) values (p_plan, p_checkpoint, p_event, coalesce(p_detail, '{}'::jsonb), auth.uid());
$$;

create or replace function public.trg_qaqc_plans_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.plan_ref := 'QP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.qaqc_plan_no')::text, 5, '0');
  else
    new.plan_ref := old.plan_ref; new.created_by := old.created_by; new.created_at := old.created_at; new.updated_at := now();
  end if;
  return new;
end $$;
create trigger qaqc_plans_before before insert or update on public.qaqc_plans for each row execute function public.trg_qaqc_plans_before();

alter table public.qaqc_plans enable row level security;
alter table public.qaqc_checkpoints enable row level security;
alter table public.qaqc_evidence enable row level security;
alter table public.qaqc_events enable row level security;
create policy qaqc_plans_read on public.qaqc_plans for select to authenticated using (public.is_internal());
create policy qaqc_checkpoints_read on public.qaqc_checkpoints for select to authenticated using (public.is_internal());
create policy qaqc_evidence_read on public.qaqc_evidence for select to authenticated using (public.is_internal());
create policy qaqc_events_read on public.qaqc_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.qaqc_plans, public.qaqc_checkpoints, public.qaqc_evidence, public.qaqc_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- B. Rule engine
-- ---------------------------------------------------------------------------
-- Computes the level for a spec (and, when known, its PO). Returns
-- {level, base_level, bump, rules:[{code,name,effect,level,bump,explanation}], extra_evidence:[...], context:{...}}.
create or replace function public._qaqc_compute(p_spec uuid, p_po uuid, p_date date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.job_specs; j public.jobs; p public.purchase_orders; c public.sourcing_clients; sup public.suppliers;
  r public.library_records; v_vals text[]; v_thr numeric; v_cur text; v_value numeric; v_qty numeric; v_markets text[];
  v_sup_market text; v_match boolean; v_rules jsonb := '[]'::jsonb; v_base int := 1; v_bump int := 0; v_extra text[] := '{}';
  v_lvl int; v_quality numeric; v_unrated boolean; v_fsc boolean; v_expl text; v_cat text;
begin
  if p_spec is not null then select * into s from public.job_specs where id = p_spec; end if;
  if p_po is not null then select * into p from public.purchase_orders where id = p_po; end if;
  select * into j from public.jobs where id = coalesce(s.job_id, p.job_id);
  if j.id is null then raise exception 'Job not found for the QA/QC level'; end if;
  select * into c from public.sourcing_clients where id = j.client_id;
  if p.id is not null then select * into sup from public.suppliers where id = p.supplier_id; end if;
  v_cur := coalesce(p.currency, j.currency);
  v_value := coalesce(p.total_value,
    (select sum(e.base_cost) from public.estimates e where e.job_id = j.id and e.status <> 'declined'), j.budget);
  if s.id is not null then
    v_qty := coalesce((select sum(el.quantity) from public.estimate_lines el where el.estimate_id = p.estimate_id and el.spec_id = s.id),
                      (select sum(quantity) from public.spec_versions where spec_id = s.id));
  else
    v_qty := (select sum(el.quantity) from public.estimate_lines el where el.estimate_id = p.estimate_id);
  end if;
  select coalesce(array_agg(distinct m), '{}') into v_markets from (
    select d.market m from public.deliveries d where p.id is not null and d.po_id = p.id and d.status <> 'cancelled'
    union select public._market_code(coalesce(p.market, j.market))) x where m is not null;
  v_sup_market := public._market_code(sup.market);
  v_cat := lower(coalesce(s.product_category, '') || ' ' || coalesce(s.product_sub_type, '') || ' ' || coalesce(j.category, ''));
  if sup.id is not null then
    select pr.quality_score into v_quality from public.performance_records pr where pr.supplier_id = sup.id and pr.quality_score is not null
     order by pr.period desc limit 1;
    v_unrated := v_quality is null and not exists (select 1 from public.qaqc_plans qp where qp.supplier_id = sup.id and qp.status = 'passed');
  end if;
  v_fsc := s.id is not null and (coalesce(s.recycled_content_percent, 0) > 0 or coalesce(s.material, '') ~* '(fsc|recycled)'
           or coalesce((select (lr.data->>'fsc_certified')::boolean from public.library_records lr where lr.id = s.substrate_id), false));

  for r in select * from public._lib_current('qaqc_level_rules', p_date) order by code loop
    v_vals := coalesce(array(select lower(x) from jsonb_array_elements_text(coalesce(r.data->'values', '[]'::jsonb)) x), '{}');
    v_thr := nullif(r.data->>'threshold', '')::numeric;
    v_lvl := nullif(r.data->>'level', '')::int;
    v_expl := coalesce(nullif(r.data->>'explanation', ''), r.name);
    v_match := case r.data->>'condition'
      when 'spec_type' then s.id is not null and lower(s.spec_type) = any (v_vals)
      when 'product_category' then exists (select 1 from unnest(v_vals) v where v_cat like '%' || v || '%')
      when 'lighting_electronics' then s.id is not null and (s.has_lighting_electronics or exists (select 1 from unnest(v_vals) v where v_cat like '%' || v || '%'))
      when 'testing_checklist' then s.id is not null and cardinality(s.testing_checklist) > 0
                                    and (cardinality(v_vals) = 0 or s.testing_checklist && v_vals)
      when 'order_value' then v_thr is not null and v_value is not null and v_value >= v_thr
                              and (nullif(r.data->>'currency', '') is null or upper(r.data->>'currency') = upper(v_cur))
      when 'quantity' then v_thr is not null and coalesce(v_qty, 0) >= v_thr
      when 'destination_market' then v_markets && array(select upper(x) from unnest(v_vals) x)
      when 'client_requirement' then c.qa_min_level is not null
      when 'supplier_unrated' then sup.id is not null and coalesce(v_unrated, false)
      when 'supplier_quality_below' then v_quality is not null and v_thr is not null and v_quality < v_thr
      when 'supplier_tier' then sup.tier is not null and lower(sup.tier) = any (v_vals)
      when 'sustainability_claim' then coalesce(v_fsc, false)
      when 'cross_border' then j.region = 'GSC' or (v_sup_market is not null and not (v_sup_market = any (v_markets)))
      else false end;
    if coalesce(v_match, false) then
      if r.data->>'condition' = 'client_requirement' then
        v_lvl := c.qa_min_level;
        v_expl := v_expl || ' ' || c.name || ' asks for L' || c.qa_min_level || ' or above.';
      elsif r.data->>'condition' = 'order_value' then
        v_expl := v_expl || ' (this order: ' || v_cur || ' ' || to_char(v_value, 'FM999,999,990') || ')';
      elsif r.data->>'condition' = 'quantity' then
        v_expl := v_expl || ' (this line: ' || to_char(v_qty, 'FM999,999,990') || ' units)';
      elsif r.data->>'condition' = 'destination_market' then
        v_expl := v_expl || ' (' || array_to_string(v_markets, ', ') || ')';
      end if;
      if coalesce(r.data->>'effect', 'min_level') = 'bump' then
        v_bump := v_bump + coalesce(nullif(r.data->>'bump', '')::int, 1);
      else
        v_base := greatest(v_base, coalesce(v_lvl, 1));
      end if;
      v_extra := v_extra || coalesce(array(select jsonb_array_elements_text(coalesce(r.data->'evidence_add', '[]'::jsonb))), '{}');
      v_rules := v_rules || jsonb_build_object('code', r.code, 'name', r.name, 'version', r.version, 'record_id', r.id,
        'effect', coalesce(r.data->>'effect', 'min_level'), 'level', case when coalesce(r.data->>'effect', 'min_level') = 'bump' then null else coalesce(v_lvl, 1) end,
        'bump', case when r.data->>'effect' = 'bump' then coalesce(nullif(r.data->>'bump', '')::int, 1) end, 'explanation', v_expl);
    end if;
  end loop;
  return jsonb_build_object('level', least(5, v_base + v_bump), 'base_level', v_base, 'bump', v_bump, 'rules', v_rules,
    'extra_evidence', to_jsonb(coalesce(array(select distinct x from unnest(v_extra) x order by 1), '{}')),
    'context', jsonb_build_object('spec_type', s.spec_type, 'product_category', s.product_category, 'testing_checklist', to_jsonb(s.testing_checklist),
      'order_value', v_value, 'currency', v_cur, 'quantity', v_qty, 'markets', to_jsonb(v_markets), 'client', c.name, 'client_min_level', c.qa_min_level,
      'supplier', sup.name, 'supplier_quality_score', v_quality, 'supplier_unrated', v_unrated, 'sustainability_claim', v_fsc, 'computed_on', p_date));
end $$;

-- Public, explainable lookup for internal staff: by PO line (p_po + p_spec), by PO, or by spec without a PO.
create or replace function public.qaqc_required_level(p_po uuid default null, p_spec uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  if p_po is null and p_spec is null then raise exception 'Choose a purchase order or a spec'; end if;
  return public._qaqc_compute(p_spec, p_po, current_date);
end $$;

-- ---------------------------------------------------------------------------
-- C. Plans and checkpoints
-- ---------------------------------------------------------------------------
create or replace function public._qaqc_level_record(p_level int, p_date date default current_date) returns public.library_records
language sql stable security definer set search_path = public as $$
  select * from public._lib_current('qaqc_levels', p_date) r where (r.data->>'level')::int = p_level order by r.code limit 1;
$$;

create or replace function public._qaqc_due(p_checkpoint text, p_po public.purchase_orders, p_job public.jobs) returns date
language sql stable as $$
  select case p_checkpoint
    when 'mockup' then coalesce(p_po.po_date, current_date) + 7
    when 'production' then coalesce(p_po.delivery_date, p_job.target_delivery_date, current_date + 28) - 10
    when 'pre_shipment' then coalesce(p_po.delivery_date, p_job.target_delivery_date, current_date + 28) - 3
    when 'installation' then coalesce(p_po.delivery_date, p_job.target_delivery_date, current_date + 28) + 7 end;
$$;

-- (Re)build the checkpoints of a plan for its required level. Checkpoints already submitted are kept; ones the level no
-- longer needs are withdrawn (never deleted, so the evidence history stays).
create or replace function public._qaqc_build_checkpoints(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl public.qaqc_plans; lr public.library_records; po public.purchase_orders; j public.jobs; cp text; v_req text[]; v_aql uuid; s public.job_specs;
begin
  select * into pl from public.qaqc_plans where id = p_plan for update;
  select * into j from public.jobs where id = pl.job_id;
  if pl.po_id is not null then select * into po from public.purchase_orders where id = pl.po_id; end if;
  if pl.spec_id is not null then select * into s from public.job_specs where id = pl.spec_id; end if;
  lr := public._qaqc_level_record(pl.required_level);
  if lr.id is null then
    -- No level library in force: fall back to a document upload so the plan is never empty.
    lr.data := jsonb_build_object('level', pl.required_level, 'checkpoints', jsonb_build_array('pre_shipment'),
      'required_evidence', jsonb_build_array('pre_shipment:COC|DECLARATION'), 'verifier', 'auto', 'signoff_required', pl.required_level >= 4);
    lr.name := 'L' || pl.required_level;
  end if;
  v_aql := coalesce(s.aql_level_id,
    (select id from public.library_records where library_key = 'aql_levels' and code = lr.data->>'aql_code' and status = 'active' order by version desc limit 1));
  update public.qaqc_plans set level_record_id = lr.id, level_name = lr.name, level_data = lr.data where id = p_plan;
  update public.qaqc_checkpoints set status = 'withdrawn', updated_at = now()
   where plan_id = p_plan and status <> 'withdrawn'
     and checkpoint not in (select jsonb_array_elements_text(coalesce(lr.data->'checkpoints', '[]'::jsonb)));
  for cp in select jsonb_array_elements_text(coalesce(lr.data->'checkpoints', '[]'::jsonb)) loop
    select coalesce(array_agg(split_part(x, ':', 2) order by x), '{}') into v_req
      from (select jsonb_array_elements_text(coalesce(lr.data->'required_evidence', '[]'::jsonb)) x union select unnest(pl.extra_evidence)) e
     where split_part(x, ':', 1) = cp and split_part(x, ':', 2) <> '';
    insert into public.qaqc_checkpoints (plan_id, checkpoint, seq, required_evidence, verifier, signoff_required, min_photos, approved_body_required, aql_record_id, due_date)
    values (p_plan, cp, public._qaqc_checkpoint_seq(cp), v_req, coalesce(lr.data->>'verifier', 'auto'), coalesce((lr.data->>'signoff_required')::boolean, false),
            coalesce((lr.data->>'min_photos')::int, 0), coalesce((lr.data->>'approved_body_required')::boolean, false), v_aql, public._qaqc_due(cp, po, j))
    on conflict (plan_id, checkpoint) do update set required_evidence = excluded.required_evidence, verifier = excluded.verifier,
      signoff_required = excluded.signoff_required, min_photos = excluded.min_photos, approved_body_required = excluded.approved_body_required,
      aql_record_id = excluded.aql_record_id, seq = excluded.seq,
      status = case when qaqc_checkpoints.status = 'withdrawn' then case when qaqc_checkpoints.submission_count > 0 then 'submitted' else 'required' end
                    else qaqc_checkpoints.status end,
      updated_at = now();
  end loop;
  insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
  select lr.id, 'qaqc_plans', p_plan::text, pl.plan_ref where lr.id is not null on conflict do nothing;
  insert into public.library_refs (record_id, ref_table, ref_id, ref_label)
  select (x->>'record_id')::uuid, 'qaqc_plans', p_plan::text, pl.plan_ref from jsonb_array_elements(pl.rules_fired) x
   where x ? 'record_id' and exists (select 1 from public.library_records where id = (x->>'record_id')::uuid) on conflict do nothing;
end $$;

-- Overall plan status from its checkpoints.
create or replace function public._qaqc_plan_refresh(p_plan uuid) returns text
language plpgsql security definer set search_path = public as $$
declare pl public.qaqc_plans; v_total int; v_ok int; v_bad int; v_started int; v_status text; j public.jobs;
begin
  select * into pl from public.qaqc_plans where id = p_plan for update;
  if pl.status = 'waived' then return 'waived'; end if;
  select count(*), count(*) filter (where status in ('verified','auto_verified')),
         count(*) filter (where status = 'rejected' or (failed and status not in ('verified','auto_verified'))),
         count(*) filter (where status <> 'required')
    into v_total, v_ok, v_bad, v_started from public.qaqc_checkpoints where plan_id = p_plan and status <> 'withdrawn';
  v_status := case when v_bad > 0 then 'failed' when v_total > 0 and v_ok = v_total then 'passed' when v_started > 0 then 'in_progress' else 'not_started' end;
  if v_status is distinct from pl.status then
    update public.qaqc_plans set status = v_status,
      passed_at = case when v_status = 'passed' then coalesce(passed_at, now()) else null end,
      failed_at = case when v_status = 'failed' then now() else failed_at end
     where id = p_plan;
    perform public._qaqc_event(p_plan, null, 'plan_' || v_status, jsonb_build_object('from', pl.status));
    if v_status = 'passed' then
      select * into j from public.jobs where id = pl.job_id;
      perform public.notify(j.manager, 'orders', 'QA/QC passed: ' || pl.plan_ref, format('All L%s checkpoints on %s are verified.', pl.required_level, j.job_number),
        coalesce('/orders/purchase-orders/' || pl.po_id || '#qaqc', '/orders/qaqc'));
    end if;
  end if;
  return v_status;
end $$;

-- Create (or adopt) one plan per line of a PO. A plan made for the spec before the PO existed is attached to the PO
-- and keeps a manual raise; the level is recomputed with the PO facts. Returns the number of plans on the PO.
create or replace function public._qaqc_create_plans(p_po uuid) returns int
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; j public.jobs; l record; v_c jsonb; v_id uuid; v_lvl int; v_existing public.qaqc_plans; n int := 0;
begin
  select * into p from public.purchase_orders where id = p_po;
  if p.id is null then raise exception 'Purchase order not found'; end if;
  select * into j from public.jobs where id = p.job_id;
  for l in select el.id, el.spec_id from public.estimate_lines el where el.estimate_id = p.estimate_id
           union all select null::uuid, null::uuid where not exists (select 1 from public.estimate_lines where estimate_id = p.estimate_id) loop
    if exists (select 1 from public.qaqc_plans where po_id = p_po and estimate_line_id is not distinct from l.id) then n := n + 1; continue; end if;
    v_c := public._qaqc_compute(l.spec_id, p_po, current_date);
    v_lvl := (v_c->>'level')::int;
    select * into v_existing from public.qaqc_plans where po_id is null and l.spec_id is not null and spec_id = l.spec_id for update;
    if v_existing.id is not null then
      update public.qaqc_plans set po_id = p_po, estimate_line_id = l.id, supplier_id = p.supplier_id, computed_level = v_lvl,
        required_level = greatest(v_lvl, v_existing.required_level), rules_fired = v_c->'rules',
        extra_evidence = coalesce(array(select jsonb_array_elements_text(v_c->'extra_evidence')), '{}'), context = v_c->'context'
       where id = v_existing.id returning id into v_id;
      perform public._qaqc_event(v_id, null, 'attached_to_po', jsonb_build_object('po_id', p_po, 'computed_level', v_lvl));
    else
      insert into public.qaqc_plans (job_id, po_id, estimate_line_id, spec_id, supplier_id, client_id, region, market, computed_level, required_level,
        rules_fired, extra_evidence, context, created_by)
      values (p.job_id, p_po, l.id, l.spec_id, p.supplier_id, j.client_id, p.region, public._market_code(p.market), v_lvl, v_lvl,
        v_c->'rules', coalesce(array(select jsonb_array_elements_text(v_c->'extra_evidence')), '{}'), v_c->'context', auth.uid())
      returning id into v_id;
      perform public._qaqc_event(v_id, null, 'created', jsonb_build_object('po_id', p_po, 'level', v_lvl, 'rules', v_c->'rules'));
    end if;
    perform public._qaqc_build_checkpoints(v_id);
    perform public._qaqc_plan_refresh(v_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- The PO is issued (approved under DOA): plans are created in the same transaction.
create or replace function public.trg_po_qaqc_plans() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    perform public._qaqc_create_plans(new.id);
  end if;
  return null;
end $$;
create trigger purchase_orders_qaqc_plans after update of status on public.purchase_orders for each row execute function public.trg_po_qaqc_plans();

-- Internal: create plans for a PO issued before QA/QC existed, or a plan for a job spec with no PO yet.
create or replace function public.qaqc_plan_create(p_po uuid default null, p_spec uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare p public.purchase_orders; s public.job_specs; j public.jobs; v_c jsonb; v_id uuid; v_lvl int;
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  if p_po is not null then
    select * into p from public.purchase_orders where id = p_po;
    if p.id is null then raise exception 'Purchase order not found'; end if;
    if p.status not in ('issued','accepted') then raise exception 'QA/QC plans are made once the PO is approved and issued'; end if;
    return public._qaqc_create_plans(p_po);
  end if;
  select * into s from public.job_specs where id = p_spec;
  if s.id is null then raise exception 'Spec not found'; end if;
  if exists (select 1 from public.qaqc_plans where spec_id = p_spec) then raise exception 'This spec already has a QA/QC plan'; end if;
  select * into j from public.jobs where id = s.job_id;
  v_c := public._qaqc_compute(p_spec, null, current_date);
  v_lvl := (v_c->>'level')::int;
  insert into public.qaqc_plans (job_id, spec_id, client_id, region, market, computed_level, required_level, rules_fired, extra_evidence, context, created_by)
  values (j.id, p_spec, j.client_id, j.region, public._market_code(j.market), v_lvl, v_lvl, v_c->'rules',
    coalesce(array(select jsonb_array_elements_text(v_c->'extra_evidence')), '{}'), v_c->'context', auth.uid())
  returning id into v_id;
  perform public._qaqc_event(v_id, null, 'created', jsonb_build_object('spec_id', p_spec, 'level', v_lvl, 'rules', v_c->'rules'));
  perform public._qaqc_build_checkpoints(v_id);
  return 1;
end $$;

-- Change the required level. Raising (or keeping it at/above the computed level) applies with a reason; lowering below
-- the computed level opens a QAQC_LOWER request that a quality role (not the requester) approves.
create or replace function public.qaqc_set_level(p_plan uuid, p_level int, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare pl public.qaqc_plans; j public.jobs; v_applying boolean := public._approval_applying('QAQC_LOWER', p_plan::text);
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can change a QA/QC level' using errcode = '42501'; end if;
  select * into pl from public.qaqc_plans where id = p_plan for update;
  if pl.id is null then raise exception 'QA/QC plan not found'; end if;
  if p_level is null or p_level not between 1 and 5 then raise exception 'Choose a level from L1 to L5'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the QA/QC level is changing'; end if;
  if pl.status in ('passed','waived') then raise exception 'This QA/QC plan is already %', pl.status; end if;
  if p_level = pl.required_level then raise exception 'The plan is already at L%', p_level; end if;
  select * into j from public.jobs where id = pl.job_id;
  if p_level < pl.computed_level and not v_applying then
    perform public._approval_request_open('orders', 'QAQC_LOWER', 'qaqc_plan', p_plan::text, pl.plan_ref,
      format('Lower QA/QC from L%s to L%s · %s', pl.required_level, p_level, j.title),
      jsonb_build_object('level', p_level, 'reason', trim(p_reason), 'computed_level', pl.computed_level), p_reason, null, null, j.client_id,
      pl.market, pl.region, coalesce('/orders/purchase-orders/' || pl.po_id || '#qaqc', '/orders/qaqc'), 'quality', 'orders', 'approver', '{}'::uuid[],
      format('The rules ask for L%s; lowering below that needs a quality role', pl.computed_level));
    perform public._qaqc_event(p_plan, null, 'lower_requested', jsonb_build_object('to', p_level, 'reason', trim(p_reason)));
    return 'pending';
  end if;
  update public.qaqc_plans set required_level = p_level, level_reason = trim(p_reason), level_set_by = auth.uid(), level_set_at = now() where id = p_plan;
  perform public._qaqc_build_checkpoints(p_plan);
  perform public._qaqc_plan_refresh(p_plan);
  perform public._qaqc_event(p_plan, null, case when p_level > pl.required_level then 'level_raised' else 'level_lowered' end,
    jsonb_build_object('from', pl.required_level, 'to', p_level, 'computed', pl.computed_level, 'reason', trim(p_reason), 'approved', v_applying));
  return 'applied';
end $$;

-- Waive a plan (e.g. the client accepted the goods on a concession). Always a QAQC_WAIVE request (quality role, maker-checker).
create or replace function public.qaqc_request_waiver(p_plan uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl public.qaqc_plans; j public.jobs; v uuid;
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can ask for a QA/QC waiver' using errcode = '42501'; end if;
  select * into pl from public.qaqc_plans where id = p_plan;
  if pl.id is null then raise exception 'QA/QC plan not found'; end if;
  if pl.status in ('passed','waived') then raise exception 'This QA/QC plan is already %', pl.status; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why QA/QC should be waived'; end if;
  select * into j from public.jobs where id = pl.job_id;
  v := public._approval_request_open('orders', 'QAQC_WAIVE', 'qaqc_plan', p_plan::text, pl.plan_ref, format('Waive L%s QA/QC · %s', pl.required_level, j.title),
    jsonb_build_object('reason', trim(p_reason)), p_reason, null, null, j.client_id, pl.market, pl.region,
    coalesce('/orders/purchase-orders/' || pl.po_id || '#qaqc', '/orders/qaqc'), 'quality', 'orders', 'approver', '{}'::uuid[], 'QA/QC waiver');
  perform public._qaqc_event(p_plan, null, 'waiver_requested', jsonb_build_object('reason', trim(p_reason)));
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- NCR raised from QA/QC (SRM quality)
-- ---------------------------------------------------------------------------
create or replace function public._qaqc_raise_ncr(p_checkpoint uuid, p_reason text, p_severity text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.qaqc_checkpoints; pl public.qaqc_plans; po public.purchase_orders; v_cat uuid; v_id uuid; s public.job_specs;
begin
  select * into c from public.qaqc_checkpoints where id = p_checkpoint for update;
  if c.ncr_id is not null and exists (select 1 from public.ncrs where id = c.ncr_id and status = 'open') then return c.ncr_id; end if;
  select * into pl from public.qaqc_plans where id = c.plan_id;
  if pl.supplier_id is null then return null; end if;
  select * into po from public.purchase_orders where id = pl.po_id;
  select * into s from public.job_specs where id = pl.spec_id;
  select id into v_cat from public.library_records where library_key = 'ncr_categories' and status = 'active'
   order by (code = 'NCR-QAQC') desc, (code = 'NCR-DOC') desc, code limit 1;
  if v_cat is null then return null; end if;
  insert into public.ncrs (supplier_id, category_id, severity, title, description, po_reference)
  values (pl.supplier_id, v_cat, coalesce(p_severity, 'major'),
    left(format('QA/QC %s failed: %s', public.qaqc_checkpoint_label(c.checkpoint), coalesce(s.title, pl.plan_ref)), 200),
    format('Raised by QA/QC (%s, L%s). %s', pl.plan_ref, pl.required_level, p_reason), po.po_number)
  returning id into v_id;
  -- Raised by the system, not by the person whose upload triggered it.
  update public.ncrs set raised_by = case when public.is_internal() then auth.uid() end where id = v_id;
  update public.qaqc_checkpoints set ncr_id = v_id where id = p_checkpoint;
  perform public._qaqc_event(pl.id, p_checkpoint, 'ncr_raised', jsonb_build_object('ncr_id', v_id, 'reason', p_reason));
  perform public.notify_supplier(pl.supplier_id, 'assure', 'Non-conformance raised', format('QA/QC on %s: %s', coalesce(po.po_number, pl.plan_ref), p_reason), '/vendor/quality');
  perform public._approval_notify('quality', 'orders', 'orders', 'QA/QC failure: ' || coalesce(po.po_number, pl.plan_ref), p_reason,
    '/assure/quality', auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- D. Verification at upload
-- ---------------------------------------------------------------------------
-- Runs every automatic check on the latest submission and sets the outcome:
--   auto_verified  every check passed and the level is verified automatically (no sign-off);
--   needs_review   anything failed, or the level needs a quality sign-off (L4/L5 by default).
-- Hard failures (failed AQL or result, expired certificate, unapproved body) also raise an NCR.
create or replace function public._qaqc_verify(p_checkpoint uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.qaqc_checkpoints; pl public.qaqc_plans; po public.purchase_orders; aql public.library_records; e record; t public.library_records;
  b public.library_records; v_checks jsonb := '[]'::jsonb; v_req text; v_missing text[] := '{}'; v_badfiles text[] := '{}'; v_dates text[] := '{}';
  v_expired text[] := '{}'; v_bodies text[] := '{}'; v_aql text[] := '{}'; v_photos int; v_results text[] := '{}'; v_start date;
  v_hard boolean := false; v_ok boolean; v_status text; v_reasons text[] := '{}'; v_ac int; v_needs text[]; v_types text[]; f public.files;
begin
  select * into c from public.qaqc_checkpoints where id = p_checkpoint for update;
  select * into pl from public.qaqc_plans where id = c.plan_id;
  if pl.po_id is not null then select * into po from public.purchase_orders where id = pl.po_id; end if;
  select * into aql from public.library_records where id = c.aql_record_id;
  v_start := coalesce(po.po_date, pl.created_at::date);

  -- 1. Required evidence present
  foreach v_req in array c.required_evidence loop
    if not exists (select 1 from public.qaqc_evidence x where x.checkpoint_id = c.id and x.submission_no = c.submission_count
                    and x.evidence_type = any (string_to_array(v_req, '|'))) then
      v_missing := v_missing || (select string_agg(coalesce((select name from public.library_effective('qaqc_evidence_types', z, current_date)), z), ' or ')
                                   from unnest(string_to_array(v_req, '|')) z);
    end if;
  end loop;
  v_checks := v_checks || jsonb_build_object('code', 'evidence', 'label', 'Required evidence uploaded', 'ok', cardinality(v_missing) = 0, 'hard', false,
    'detail', case when cardinality(v_missing) = 0 then 'All required evidence is there' else 'Missing: ' || array_to_string(v_missing, '; ') end);

  for e in select x.* from public.qaqc_evidence x where x.checkpoint_id = c.id and x.submission_no = c.submission_count loop
    t := public.library_effective('qaqc_evidence_types', e.evidence_type, current_date);
    v_needs := coalesce(array(select jsonb_array_elements_text(coalesce(t.data->'needs', '[]'::jsonb))), '{}');
    -- 2. File type allowed
    select * into f from public.files where id = e.file_id;
    v_types := coalesce(array(select jsonb_array_elements_text(coalesce(t.data->'allowed_types', '["application/pdf","image/"]'::jsonb))), '{}');
    if f.id is null then
      v_badfiles := v_badfiles || (coalesce(t.name, e.evidence_type) || ': no file');
    elsif not exists (select 1 from unnest(v_types) a where f.content_type like a || '%') then
      v_badfiles := v_badfiles || (coalesce(t.name, e.evidence_type) || ': ' || f.content_type || ' is not accepted');
    end if;
    -- 3. Dated, within the PO window, not expired
    if 'issued_on' = any (v_needs) then
      if e.issued_on is null then v_dates := v_dates || (coalesce(t.name, e.evidence_type) || ': no issue date');
      elsif e.issued_on > current_date then v_dates := v_dates || (coalesce(t.name, e.evidence_type) || ': dated in the future');
      elsif coalesce(t.data->>'window', 'none') = 'po' and e.issued_on < v_start - coalesce((t.data->>'lookback_days')::int, 0) then
        v_dates := v_dates || (coalesce(t.name, e.evidence_type) || ': issued ' || to_char(e.issued_on, 'DD Mon YYYY') || ', before the order window');
      end if;
    end if;
    if 'inspection_date' = any (v_needs) then
      if e.inspection_date is null then v_dates := v_dates || (coalesce(t.name, e.evidence_type) || ': no inspection date');
      elsif e.inspection_date > current_date then v_dates := v_dates || (coalesce(t.name, e.evidence_type) || ': inspection date in the future');
      elsif e.inspection_date < v_start - coalesce((t.data->>'lookback_days')::int, 0) then
        v_dates := v_dates || (coalesce(t.name, e.evidence_type) || ': inspected ' || to_char(e.inspection_date, 'DD Mon YYYY') || ', before the order');
      end if;
    end if;
    if 'expires_on' = any (v_needs) or e.expires_on is not null then
      if e.expires_on is null then v_dates := v_dates || (coalesce(t.name, e.evidence_type) || ': no expiry date');
      elsif e.expires_on < current_date then v_expired := v_expired || (coalesce(t.name, e.evidence_type) || ' expired ' || to_char(e.expires_on, 'DD Mon YYYY'));
      end if;
    end if;
    if 'certificate_number' = any (v_needs) and coalesce(trim(e.certificate_number), '') = '' then
      v_dates := v_dates || (coalesce(t.name, e.evidence_type) || ': no certificate number');
    end if;
    -- 4. Approved body (L4/L5, or whenever the evidence type needs a body)
    if 'body' = any (v_needs) and (c.approved_body_required or e.body_code is not null) then
      b := public.library_effective('qaqc_approved_bodies', e.body_code, current_date);
      if e.body_code is null then
        v_bodies := v_bodies || (coalesce(t.name, e.evidence_type) || ': no lab or inspection body given');
      elsif b.id is null then
        v_bodies := v_bodies || (coalesce(t.name, e.evidence_type) || ': ' || coalesce(e.body_name, e.body_code) || ' is not an approved body');
      elsif nullif(b.data->>'accredited_until', '') is not null and (b.data->>'accredited_until')::date < current_date then
        v_bodies := v_bodies || (coalesce(t.name, e.evidence_type) || ': ' || b.name || ' accreditation lapsed ' || (b.data->>'accredited_until'));
      elsif jsonb_array_length(coalesce(t.data->'body_types', '[]'::jsonb)) > 0 and not (t.data->'body_types') ? coalesce(b.data->>'body_type', '') then
        v_bodies := v_bodies || (coalesce(t.name, e.evidence_type) || ': ' || b.name || ' is a ' || replace(coalesce(b.data->>'body_type', 'body'), '_', ' ') || ', not accepted for this evidence');
      end if;
    end if;
    -- 5. AQL within the limits
    if 'aql' = any (v_needs) or e.sample_size is not null then
      if e.sample_size is null then
        v_aql := v_aql || (coalesce(t.name, e.evidence_type) || ': no sample size');
      elsif aql.id is null then
        v_aql := v_aql || 'No AQL level is set for this checkpoint';
      else
        v_ac := public.qaqc_aql_accept(e.sample_size, coalesce(nullif(aql.data->>'critical', '')::numeric, 0));
        if coalesce(e.defects_critical, 0) > v_ac then v_aql := v_aql || format('%s critical defect(s) found, %s allowed', e.defects_critical, v_ac); end if;
        v_ac := public.qaqc_aql_accept(e.sample_size, (aql.data->>'major')::numeric);
        if coalesce(e.defects_major, 0) > v_ac then v_aql := v_aql || format('%s major defects in a sample of %s, %s allowed at %s', e.defects_major, e.sample_size, v_ac, aql.name); end if;
        if nullif(aql.data->>'minor', '') is not null then
          v_ac := public.qaqc_aql_accept(e.sample_size, (aql.data->>'minor')::numeric);
          if coalesce(e.defects_minor, 0) > v_ac then v_aql := v_aql || format('%s minor defects in a sample of %s, %s allowed', e.defects_minor, e.sample_size, v_ac); end if;
        end if;
      end if;
    end if;
    -- 7. Result
    if e.result = 'fail' then v_results := v_results || (coalesce(t.name, e.evidence_type) || ' says fail'); end if;
    if 'result' = any (v_needs) and e.result is null then v_results := v_results || (coalesce(t.name, e.evidence_type) || ': no result'); end if;
  end loop;

  v_checks := v_checks || jsonb_build_object('code', 'file_types', 'label', 'File types accepted', 'ok', cardinality(v_badfiles) = 0, 'hard', false,
    'detail', case when cardinality(v_badfiles) = 0 then 'All files are an accepted type' else array_to_string(v_badfiles, '; ') end);
  v_checks := v_checks || jsonb_build_object('code', 'dates', 'label', 'Dated, numbered and within the order window', 'ok', cardinality(v_dates) = 0, 'hard', false,
    'detail', case when cardinality(v_dates) = 0 then 'Dates and numbers are in order' else array_to_string(v_dates, '; ') end);
  v_checks := v_checks || jsonb_build_object('code', 'expiry', 'label', 'Certificates and reports not expired', 'ok', cardinality(v_expired) = 0, 'hard', true,
    'detail', case when cardinality(v_expired) = 0 then 'Nothing expired' else array_to_string(v_expired, '; ') end);
  if c.approved_body_required or exists (select 1 from public.qaqc_evidence x where x.checkpoint_id = c.id and x.submission_no = c.submission_count and x.body_code is not null) then
    v_checks := v_checks || jsonb_build_object('code', 'body', 'label', 'Lab or inspection body approved', 'ok', cardinality(v_bodies) = 0, 'hard', true,
      'detail', case when cardinality(v_bodies) = 0 then 'Issued by an approved body' else array_to_string(v_bodies, '; ') end);
  end if;
  if exists (select 1 from public.qaqc_evidence x where x.checkpoint_id = c.id and x.submission_no = c.submission_count and x.sample_size is not null)
     or cardinality(v_aql) > 0 then
    v_checks := v_checks || jsonb_build_object('code', 'aql', 'label', 'AQL result within limits' || coalesce(' (' || aql.name || ')', ''), 'ok', cardinality(v_aql) = 0, 'hard', true,
      'detail', case when cardinality(v_aql) = 0 then 'Defects found are within the acceptance numbers' else array_to_string(v_aql, '; ') end);
  end if;
  -- 6. Photo count
  if c.min_photos > 0 and exists (select 1 from unnest(c.required_evidence) r where 'PHOTO_SET' = any (string_to_array(r, '|'))) then
    select count(*) into v_photos from public.qaqc_evidence x join public.files ff on ff.id = x.file_id
     where x.checkpoint_id = c.id and x.submission_no = c.submission_count and x.evidence_type = 'PHOTO_SET' and ff.content_type like 'image/%';
    v_checks := v_checks || jsonb_build_object('code', 'photos', 'label', format('At least %s photos', c.min_photos), 'ok', v_photos >= c.min_photos, 'hard', false,
      'detail', format('%s photo(s) uploaded', v_photos));
  end if;
  if coalesce(c.submission->>'result', 'pass') = 'fail' then v_results := v_results || 'The vendor marked this checkpoint as failed'::text; end if;
  v_checks := v_checks || jsonb_build_object('code', 'result', 'label', 'Result is a pass', 'ok', cardinality(v_results) = 0,
    'hard', exists (select 1 from unnest(v_results) z where z like '%fail%'),
    'detail', case when cardinality(v_results) = 0 then 'Pass' else array_to_string(v_results, '; ') end);

  v_ok := not exists (select 1 from jsonb_array_elements(v_checks) x where not (x->>'ok')::boolean);
  v_hard := exists (select 1 from jsonb_array_elements(v_checks) x where not (x->>'ok')::boolean and (x->>'hard')::boolean);
  v_status := case when v_ok and c.verifier = 'auto' and not c.signoff_required then 'auto_verified' else 'needs_review' end;
  select coalesce(array_agg(x->>'detail'), '{}') into v_reasons from jsonb_array_elements(v_checks) x where not (x->>'ok')::boolean;
  update public.qaqc_checkpoints set checks = v_checks, status = v_status, failed = v_hard,
    verified_at = case when v_status = 'auto_verified' then now() end, verified_by = null,
    first_time_pass = case when v_status = 'auto_verified' then c.submission_count = 1 else first_time_pass end,
    updated_at = now()
   where id = c.id;
  perform public._qaqc_event(pl.id, c.id, case when v_status = 'auto_verified' then 'auto_verified' else 'needs_review' end,
    jsonb_build_object('ok', v_ok, 'hard_failure', v_hard, 'failed_checks', to_jsonb(v_reasons), 'submission', c.submission_count));
  if v_hard then
    perform public._qaqc_raise_ncr(c.id, array_to_string(v_reasons, '; '),
      case when cardinality(v_aql) > 0 or cardinality(v_results) > 0 then 'major' else 'minor' end);
  elsif v_status = 'needs_review' then
    perform public._approval_notify('quality', 'orders', 'orders', 'QA/QC to review: ' || pl.plan_ref,
      format('%s checkpoint (L%s) is waiting for a quality review.', public.qaqc_checkpoint_label(c.checkpoint), pl.required_level),
      coalesce('/orders/purchase-orders/' || pl.po_id || '#qaqc', '/orders/qaqc'), c.submitted_by);
  end if;
  perform public._qaqc_plan_refresh(pl.id);
  return jsonb_build_object('status', v_status, 'ok', v_ok, 'hard_failure', v_hard, 'checks', v_checks);
end $$;

-- Record a submission (evidence + key data) on a checkpoint, then verify it. p_evidence: [{type, file_id, issued_on,
-- expires_on, inspection_date, body_code, certificate_number, sample_size, defects_critical, defects_major, defects_minor,
-- result}], p_data: {result: pass|fail, notes}.
create or replace function public._qaqc_submit(p_checkpoint uuid, p_evidence jsonb, p_data jsonb, p_vendor boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.qaqc_checkpoints; pl public.qaqc_plans; x jsonb; t public.library_records; f public.files; b public.library_records; v_no int;
begin
  select * into c from public.qaqc_checkpoints where id = p_checkpoint for update;
  if c.id is null then raise exception 'Checkpoint not found' using errcode = '42501'; end if;
  select * into pl from public.qaqc_plans where id = c.plan_id;
  if pl.status in ('passed','waived') then raise exception 'This QA/QC plan is already %', pl.status; end if;
  if c.status in ('verified','auto_verified') then raise exception 'This checkpoint is already verified'; end if;
  if c.status = 'withdrawn' then raise exception 'This checkpoint is no longer needed at the current level'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Upload the evidence first'; end if;
  if jsonb_array_length(p_evidence) > 40 then raise exception 'Up to 40 files per submission'; end if;
  if coalesce(p_data->>'result', 'pass') not in ('pass','fail') then raise exception 'Mark the checkpoint as a pass or a fail'; end if;
  v_no := c.submission_count + 1;
  for x in select * from jsonb_array_elements(p_evidence) loop
    t := public.library_effective('qaqc_evidence_types', x->>'type', current_date);
    if t.id is null or t.status <> 'active' then raise exception 'Unknown evidence type %', coalesce(x->>'type', '(none)'); end if;
    select * into f from public.files where id = nullif(x->>'file_id', '')::uuid;
    if f.id is null or f.entity_type <> 'qaqc_checkpoint' or f.entity_id <> c.id::text then raise exception 'Upload the file against this checkpoint first'; end if;
    if p_vendor and f.supplier_id is distinct from public.my_supplier_id() then raise exception 'Upload the file against this checkpoint first' using errcode = '42501'; end if;
    if exists (select 1 from public.qaqc_evidence e where e.file_id = f.id and e.checkpoint_id <> c.id) then raise exception 'That file is already used on another checkpoint'; end if;
    b := case when nullif(trim(x->>'body_code'), '') is null then null else public.library_effective('qaqc_approved_bodies', upper(trim(x->>'body_code')), current_date) end;
    insert into public.qaqc_evidence (checkpoint_id, plan_id, supplier_id, submission_no, evidence_type, evidence_record_id, file_id, issued_on, expires_on,
      inspection_date, body_code, body_record_id, body_name, certificate_number, sample_size, defects_critical, defects_major, defects_minor, result,
      uploaded_by, uploaded_by_vendor)
    values (c.id, pl.id, pl.supplier_id, v_no, t.code, t.id, f.id, nullif(x->>'issued_on', '')::date, nullif(x->>'expires_on', '')::date,
      nullif(x->>'inspection_date', '')::date, upper(nullif(trim(x->>'body_code'), '')), b.id, coalesce(b.name, nullif(trim(x->>'body_name'), '')),
      left(nullif(trim(x->>'certificate_number'), ''), 100), nullif(x->>'sample_size', '')::int, nullif(x->>'defects_critical', '')::int,
      nullif(x->>'defects_major', '')::int, nullif(x->>'defects_minor', '')::int, nullif(x->>'result', ''), auth.uid(), p_vendor);
    insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (t.id, 'qaqc_checkpoints', c.id::text, pl.plan_ref) on conflict do nothing;
    if b.id is not null then
      insert into public.library_refs (record_id, ref_table, ref_id, ref_label) values (b.id, 'qaqc_checkpoints', c.id::text, pl.plan_ref) on conflict do nothing;
    end if;
  end loop;
  update public.qaqc_checkpoints set submission_count = v_no, submitted_at = now(), submitted_by = auth.uid(), submitted_by_vendor = p_vendor,
    submission = jsonb_build_object('result', coalesce(p_data->>'result', 'pass'), 'notes', left(nullif(trim(p_data->>'notes'), ''), 2000)),
    status = 'submitted', rejection_reason = null, review_note = null, updated_at = now()
   where id = c.id;
  perform public._qaqc_event(pl.id, c.id, 'submitted', jsonb_build_object('submission', v_no, 'files', jsonb_array_length(p_evidence), 'by_vendor', p_vendor,
    'result', coalesce(p_data->>'result', 'pass')));
  return public._qaqc_verify(c.id);
end $$;

-- Vendor: own PO only (accepted), never a viewer (wrapper below).
create or replace function public._core_qaqc_vendor_submit(p_checkpoint uuid, p_evidence jsonb, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); ok boolean;
begin
  if v_sup is null or public.is_internal() then raise exception 'Vendor access only' using errcode = '42501'; end if;
  select exists (select 1 from public.qaqc_checkpoints c join public.qaqc_plans pl on pl.id = c.plan_id join public.purchase_orders p on p.id = pl.po_id
                  where c.id = p_checkpoint and pl.supplier_id = v_sup and p.supplier_id = v_sup and p.status in ('issued','accepted')) into ok;
  if not ok then raise exception 'Checkpoint not found' using errcode = '42501'; end if;
  if exists (select 1 from public.qaqc_checkpoints c join public.qaqc_plans pl on pl.id = c.plan_id join public.purchase_orders p on p.id = pl.po_id
              where c.id = p_checkpoint and p.status <> 'accepted') then
    raise exception 'Accept the purchase order before uploading QA/QC evidence';
  end if;
  return public._qaqc_submit(p_checkpoint, p_evidence, p_data, true);
end $$;

create or replace function public.qaqc_vendor_submit(p_checkpoint uuid, p_evidence jsonb, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); return public._core_qaqc_vendor_submit(p_checkpoint, p_evidence, p_data); end $$;

-- Internal (adm Indicia QC inspector or the account team on the vendor's behalf). The submitter can never verify it.
create or replace function public.qaqc_submit(p_checkpoint uuid, p_evidence jsonb, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() or public.my_supplier_id() is not null then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  return public._qaqc_submit(p_checkpoint, p_evidence, p_data, false);
end $$;

-- ---------------------------------------------------------------------------
-- E. Internal review (quality role, never the uploader)
-- ---------------------------------------------------------------------------
create or replace function public._qaqc_review_block(p_checkpoint uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare c public.qaqc_checkpoints; pl public.qaqc_plans; pol record;
begin
  if auth.uid() is null or not public.is_internal() then return 'Only adm Indicia staff can review QA/QC'; end if;
  select * into c from public.qaqc_checkpoints where id = p_checkpoint;
  if c.id is null then return 'Checkpoint not found'; end if;
  select * into pl from public.qaqc_plans where id = c.plan_id;
  select * into pol from public._approval_policy('QAQC_VERIFY', pl.client_id, pl.market, null);
  if not public.approval_has_role(coalesce(pol.approver_role, 'quality'), 'orders') then
    return 'QA/QC is verified by a ' || lower(public.approval_role_label(coalesce(pol.approver_role, 'quality')));
  end if;
  if c.submitted_by = auth.uid() or exists (select 1 from public.qaqc_evidence e where e.checkpoint_id = c.id and e.uploaded_by = auth.uid()) then
    return 'You uploaded this evidence, so someone else must verify it';
  end if;
  return null;
end $$;

create or replace function public.qaqc_can_review(p_checkpoint uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public._qaqc_review_block(p_checkpoint) is null
     and exists (select 1 from public.qaqc_checkpoints where id = p_checkpoint and status in ('needs_review','auto_verified','submitted'));
$$;

create or replace function public.qaqc_review_checkpoint(p_checkpoint uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.qaqc_checkpoints; pl public.qaqc_plans; v_block text := public._qaqc_review_block(p_checkpoint); po public.purchase_orders; pol record;
begin
  if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  select * into c from public.qaqc_checkpoints where id = p_checkpoint for update;
  select * into pl from public.qaqc_plans where id = c.plan_id;
  select * into po from public.purchase_orders where id = pl.po_id;
  if p_approve is null then raise exception 'Choose verify or reject'; end if;
  if p_approve then
    if c.status <> 'needs_review' then raise exception 'Only a checkpoint waiting for review can be verified'; end if;
    if c.failed and coalesce(trim(p_note), '') = '' then raise exception 'A check failed: record why the evidence is accepted anyway (concession)'; end if;
    update public.qaqc_checkpoints set status = 'verified', verified_by = auth.uid(), verified_at = now(), review_note = nullif(trim(p_note), ''),
      first_time_pass = (c.submission_count = 1 and not c.failed), updated_at = now() where id = c.id;
  else
    if c.status not in ('needs_review','auto_verified','submitted') then raise exception 'Only submitted evidence can be rejected'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Say what is wrong so the vendor can fix it'; end if;
    update public.qaqc_checkpoints set status = 'rejected', verified_by = auth.uid(), verified_at = now(), rejection_reason = trim(p_note),
      first_time_pass = false, updated_at = now() where id = c.id;
    perform public._qaqc_raise_ncr(c.id, 'Rejected by quality review: ' || trim(p_note), 'major');
    if pl.supplier_id is not null then
      perform public.notify_supplier(pl.supplier_id, 'orders', 'QA/QC evidence rejected',
        format('%s on %s: %s. Upload corrected evidence.', public.qaqc_checkpoint_label(c.checkpoint), coalesce(po.po_number, pl.plan_ref), trim(p_note)),
        coalesce('/vendor/orders/' || pl.po_id, '/vendor/qaqc'));
    end if;
  end if;
  select * into pol from public._approval_policy('QAQC_VERIFY', pl.client_id, pl.market, null);
  perform public._approval_decision('orders', 'QAQC_VERIFY', 'qaqc_checkpoint', c.id::text, case when p_approve then 'approved' else 'rejected' end, p_note, pol.record_id);
  perform public._qaqc_event(pl.id, c.id, case when p_approve then 'verified' else 'rejected' end, jsonb_build_object('note', nullif(trim(p_note), ''), 'concession', p_approve and c.failed));
  perform public._qaqc_plan_refresh(pl.id);
end $$;

-- ---------------------------------------------------------------------------
-- Vendor reads (own POs only)
-- ---------------------------------------------------------------------------
create or replace function public._qaqc_plan_json(p_plan uuid, p_vendor boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pl.id, 'plan_ref', pl.plan_ref, 'po_id', pl.po_id, 'po_number', p.po_number, 'po_status', p.status, 'job_number', j.job_number,
    'job_title', j.title, 'spec_title', s.title, 'spec_type', s.spec_type, 'quantity', el.quantity, 'required_level', pl.required_level,
    'computed_level', pl.computed_level, 'level_name', pl.level_name, 'level_description', pl.level_data->>'description',
    'verifier', pl.level_data->>'verifier', 'status', pl.status, 'passed_at', pl.passed_at, 'level_reason', case when p_vendor then null else pl.level_reason end,
    'reasons', coalesce((select jsonb_agg(x->>'explanation') from jsonb_array_elements(pl.rules_fired) x), '[]'::jsonb),
    'rules', case when p_vendor then null else pl.rules_fired end,
    'checkpoints', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'checkpoint', c.checkpoint, 'label', public.qaqc_checkpoint_label(c.checkpoint),
        'status', c.status, 'due_date', c.due_date, 'verifier', c.verifier, 'signoff_required', c.signoff_required, 'min_photos', c.min_photos,
        'approved_body_required', c.approved_body_required, 'failed', c.failed, 'submission_count', c.submission_count, 'submitted_at', c.submitted_at,
        'verified_at', c.verified_at, 'rejection_reason', c.rejection_reason, 'review_note', c.review_note, 'checks', c.checks, 'submission', c.submission,
        'ncr_id', c.ncr_id,
        'aql', case when aq.id is null then null else jsonb_build_object('code', aq.code, 'name', aq.name, 'major', aq.data->>'major', 'minor', aq.data->>'minor', 'critical', aq.data->>'critical') end,
        'required', coalesce((select jsonb_agg(jsonb_build_object('group', r, 'codes', to_jsonb(string_to_array(r, '|')),
            'names', (select string_agg(coalesce((select name from public.library_effective('qaqc_evidence_types', z, current_date)), z), ' or ') from unnest(string_to_array(r, '|')) z),
            'needs', (select jsonb_agg(distinct n) from unnest(string_to_array(r, '|')) z
                        cross join lateral jsonb_array_elements_text(coalesce((select data->'needs' from public.library_effective('qaqc_evidence_types', z, current_date)), '[]'::jsonb)) n)))
          from unnest(c.required_evidence) r), '[]'::jsonb),
        'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.evidence_type, 'file_id', e.file_id, 'file_name', f.file_name,
            'content_type', f.content_type, 'issued_on', e.issued_on, 'expires_on', e.expires_on, 'inspection_date', e.inspection_date, 'body_code', e.body_code,
            'body_name', e.body_name, 'certificate_number', e.certificate_number, 'sample_size', e.sample_size, 'defects_critical', e.defects_critical,
            'defects_major', e.defects_major, 'defects_minor', e.defects_minor, 'result', e.result, 'uploaded_by_vendor', e.uploaded_by_vendor,
            'submission_no', e.submission_no, 'created_at', e.created_at) order by e.evidence_type, e.created_at)
          from public.qaqc_evidence e left join public.files f on f.id = e.file_id where e.checkpoint_id = c.id and e.submission_no = c.submission_count), '[]'::jsonb))
        order by c.seq) from public.qaqc_checkpoints c left join public.library_records aq on aq.id = c.aql_record_id
       where c.plan_id = pl.id and c.status <> 'withdrawn'), '[]'::jsonb))
  from public.qaqc_plans pl join public.jobs j on j.id = pl.job_id
  left join public.purchase_orders p on p.id = pl.po_id left join public.job_specs s on s.id = pl.spec_id
  left join public.estimate_lines el on el.id = pl.estimate_line_id
  where pl.id = p_plan;
$$;

create or replace function public.qaqc_vendor_plans(p_po uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public._qaqc_plan_json(pl.id, true) order by p.po_date desc, pl.plan_ref), '[]'::jsonb)
    from public.qaqc_plans pl join public.purchase_orders p on p.id = pl.po_id
   where public.my_supplier_id() is not null and not public.is_internal() and pl.supplier_id = public.my_supplier_id()
     and p.supplier_id = public.my_supplier_id() and p.status in ('issued','accepted') and (p_po is null or p.id = p_po);
$$;

-- Approved bodies the vendor can choose from (names and types only).
create or replace function public.qaqc_vendor_bodies() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'body_type', r.data->>'body_type') order by r.name), '[]'::jsonb)
    from public._lib_current('qaqc_approved_bodies') r
   where r.status = 'active' and (public.my_supplier_id() is not null or public.is_internal());
$$;

-- Internal read of one plan (same shape, with the rules and level reason).
create or replace function public.qaqc_plan_detail(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can do this' using errcode = '42501'; end if;
  return public._qaqc_plan_json(p_plan, false);
end $$;

-- ---------------------------------------------------------------------------
-- Read views (internal; RLS of the base tables applies)
-- ---------------------------------------------------------------------------
create view public.v_qaqc_plans with (security_invoker = true) as
  select pl.*, j.job_number, j.title as job_title, p.po_number, p.status as po_status, p.delivery_date as po_delivery_date, s.title as spec_title,
         su.name as supplier_name, c.name as client_name,
         (select count(*) from public.qaqc_checkpoints x where x.plan_id = pl.id and x.status <> 'withdrawn')::int as checkpoints,
         (select count(*) from public.qaqc_checkpoints x where x.plan_id = pl.id and x.status in ('verified','auto_verified'))::int as checkpoints_done,
         (select count(*) from public.qaqc_checkpoints x where x.plan_id = pl.id and x.status = 'needs_review')::int as checkpoints_to_review,
         (select count(*) from public.qaqc_checkpoints x where x.plan_id = pl.id and x.status in ('required','rejected') and x.due_date < current_date)::int as checkpoints_overdue,
         (select min(x.due_date) from public.qaqc_checkpoints x where x.plan_id = pl.id and x.status in ('required','rejected')) as next_due
    from public.qaqc_plans pl join public.jobs j on j.id = pl.job_id
    left join public.purchase_orders p on p.id = pl.po_id left join public.job_specs s on s.id = pl.spec_id
    left join public.suppliers su on su.id = pl.supplier_id left join public.sourcing_clients c on c.id = pl.client_id;

create view public.v_qaqc_checkpoints with (security_invoker = true) as
  select c.*, public.qaqc_checkpoint_label(c.checkpoint) as checkpoint_label, pl.plan_ref, pl.required_level, pl.job_id, pl.po_id, pl.supplier_id, pl.client_id,
         pl.market, pl.region, j.job_number, p.po_number, su.name as supplier_name, s.title as spec_title,
         coalesce(nullif(sb.full_name, ''), sb.email) as submitted_by_name, coalesce(nullif(vb.full_name, ''), vb.email) as verified_by_name,
         n.ncr_ref, (c.status in ('required','rejected') and c.due_date < current_date) as overdue
    from public.qaqc_checkpoints c join public.qaqc_plans pl on pl.id = c.plan_id join public.jobs j on j.id = pl.job_id
    left join public.purchase_orders p on p.id = pl.po_id left join public.suppliers su on su.id = pl.supplier_id
    left join public.job_specs s on s.id = pl.spec_id left join public.profiles sb on sb.id = c.submitted_by
    left join public.profiles vb on vb.id = c.verified_by left join public.ncrs n on n.id = c.ncr_id;

-- Quality KPIs per supplier for the SRM scorecard inputs (first-time pass rate, rejections, NCRs from QA/QC).
create view public.v_supplier_quality_kpis with (security_invoker = true) as
  select su.id as supplier_id, su.name as supplier_name, su.supplier_code,
         count(distinct pl.id)::int as plans,
         count(distinct pl.id) filter (where pl.status = 'passed')::int as plans_passed,
         count(distinct pl.id) filter (where pl.status = 'failed')::int as plans_failed,
         round(avg(pl.required_level), 1) as avg_level,
         count(c.id) filter (where c.submission_count > 0)::int as checkpoints_submitted,
         count(c.id) filter (where c.status in ('verified','auto_verified'))::int as checkpoints_passed,
         count(c.id) filter (where c.first_time_pass)::int as first_time_passes,
         round(100.0 * count(c.id) filter (where c.first_time_pass) / nullif(count(c.id) filter (where c.status in ('verified','auto_verified','rejected') or c.failed), 0), 1) as first_time_pass_rate,
         count(c.id) filter (where c.status = 'rejected')::int as checkpoints_rejected,
         count(distinct c.ncr_id)::int as ncrs_raised,
         count(distinct c.ncr_id) filter (where n.status = 'open')::int as ncrs_open,
         max(c.submitted_at) as last_submission_at
    from public.suppliers su
    join public.qaqc_plans pl on pl.supplier_id = su.id
    left join public.qaqc_checkpoints c on c.plan_id = pl.id and c.status <> 'withdrawn'
    left join public.ncrs n on n.id = c.ncr_id
   group by su.id, su.name, su.supplier_code;

-- ---------------------------------------------------------------------------
-- I. Approvals inbox: QA/QC checkpoints waiting for a quality review (module Order Management)
-- ---------------------------------------------------------------------------
create or replace view public.approvals_qaqc with (security_invoker = true) as
  select 'orders'::text as module, 'QAQC_VERIFY'::text as approval_type, c.id::text as item_id, pl.plan_ref as ref,
         format('QA/QC L%s %s · %s · %s', pl.required_level, lower(public.qaqc_checkpoint_label(c.checkpoint)), coalesce(p.po_number, j.job_number), coalesce(su.name, j.title)) as title,
         c.submitted_by as requested_by, c.submitted_at as requested_at, null::numeric as amount, null::text as currency, sc.name as client,
         public._market_code(pl.market) as market, pl.region,
         public.approval_status('QAQC_VERIFY', c.submitted_at, public._market_code(pl.market), null) as status,
         public.approval_rule('QAQC_VERIFY', pl.client_id, public._market_code(pl.market), null, 'Quality role · not the uploader') as approver_rule,
         coalesce('/orders/purchase-orders/' || pl.po_id || '#qaqc', '/orders/qaqc') as href,
         public.qaqc_can_review(c.id) as can_decide, public._market_name(pl.market) as market_name
    from public.qaqc_checkpoints c join public.qaqc_plans pl on pl.id = c.plan_id join public.jobs j on j.id = pl.job_id
    left join public.purchase_orders p on p.id = pl.po_id left join public.suppliers su on su.id = pl.supplier_id
    left join public.sourcing_clients sc on sc.id = pl.client_id
   where c.status = 'needs_review' and pl.status not in ('passed','waived');
revoke all on public.approvals_qaqc from anon, authenticated;

-- Applying approved QA/QC requests (the shared apply function is wrapped again; other types are unchanged).
create or replace function public._qaqc_request_apply(r public.approval_requests) returns void
language plpgsql security definer set search_path = public as $$
declare p jsonb := r.payload; pl public.qaqc_plans;
begin
  case r.approval_type
    when 'QAQC_LOWER' then perform public.qaqc_set_level(r.entity_id::uuid, (p->>'level')::int, p->>'reason');
    when 'QAQC_WAIVE' then
      select * into pl from public.qaqc_plans where id = r.entity_id::uuid for update;
      if pl.status in ('passed','waived') then raise exception 'This QA/QC plan is already %', pl.status; end if;
      update public.qaqc_plans set status = 'waived', waived_at = now(), waived_by = r.decided_by, waiver_reason = p->>'reason' where id = pl.id;
      perform public._qaqc_event(pl.id, null, 'waived', jsonb_build_object('request', r.request_no, 'reason', p->>'reason', 'approved_by', r.decided_by));
    else raise exception 'Unknown approval type %', r.approval_type;
  end case;
end $$;

alter function public._approval_request_apply(public.approval_requests) rename to _approval_request_apply_before_qaqc;
create function public._approval_request_apply(r public.approval_requests) returns void
language plpgsql security definer set search_path = public as $$
begin
  if r.approval_type like 'QAQC\_%' then perform public._qaqc_request_apply(r);
  else perform public._approval_request_apply_before_qaqc(r);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._lib_current(text, date), public._qaqc_event(uuid, uuid, text, jsonb), public.trg_qaqc_plans_before(),
  public._qaqc_compute(uuid, uuid, date), public._qaqc_level_record(int, date), public._qaqc_due(text, public.purchase_orders, public.jobs),
  public._qaqc_build_checkpoints(uuid), public._qaqc_plan_refresh(uuid), public._qaqc_create_plans(uuid), public.trg_po_qaqc_plans(),
  public._qaqc_raise_ncr(uuid, text, text), public._qaqc_verify(uuid), public._qaqc_submit(uuid, jsonb, jsonb, boolean),
  public._core_qaqc_vendor_submit(uuid, jsonb, jsonb), public._qaqc_review_block(uuid), public._qaqc_plan_json(uuid, boolean),
  public._qaqc_request_apply(public.approval_requests), public._approval_request_apply(public.approval_requests),
  public._approval_request_apply_before_qaqc(public.approval_requests)
  from public, anon, authenticated;
revoke execute on function public.qaqc_setting(text, numeric, date), public.qaqc_required_level(uuid, uuid), public.qaqc_plan_create(uuid, uuid),
  public.qaqc_set_level(uuid, int, text), public.qaqc_request_waiver(uuid, text), public.qaqc_vendor_submit(uuid, jsonb, jsonb),
  public.qaqc_submit(uuid, jsonb, jsonb), public.qaqc_can_review(uuid), public.qaqc_review_checkpoint(uuid, boolean, text),
  public.qaqc_vendor_plans(uuid), public.qaqc_vendor_bodies(), public.qaqc_plan_detail(uuid) from public, anon;
grant execute on function public.qaqc_setting(text, numeric, date), public.qaqc_required_level(uuid, uuid), public.qaqc_plan_create(uuid, uuid),
  public.qaqc_set_level(uuid, int, text), public.qaqc_request_waiver(uuid, text), public.qaqc_vendor_submit(uuid, jsonb, jsonb),
  public.qaqc_submit(uuid, jsonb, jsonb), public.qaqc_can_review(uuid), public.qaqc_review_checkpoint(uuid, boolean, text),
  public.qaqc_vendor_plans(uuid), public.qaqc_vendor_bodies(), public.qaqc_plan_detail(uuid), public.qaqc_aql_accept(int, numeric),
  public.qaqc_checkpoint_label(text) to authenticated;
revoke insert, update, delete on public.v_qaqc_plans, public.v_qaqc_checkpoints, public.v_supplier_quality_kpis from authenticated, anon;
revoke all on public.v_qaqc_plans, public.v_qaqc_checkpoints, public.v_supplier_quality_kpis from anon;
