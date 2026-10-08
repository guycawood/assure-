-- Supplier scorecard and Preferred Supplier List (Assure+).
-- Methodology from the Global PSL work (Jeffrey Alex / BI, "Supplier Ranking Criteria.xlsx", Review tab, Sep 2026).
-- The methodology is governed data: versioned, one active version, edits only on a draft, every change audited.
-- Admins change it through the functions below; nobody writes the tables directly.

create table public.scorecard_methodologies (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  status text not null check (status in ('draft','active','superseded','discarded')),
  -- A supplier is "preferred" when active and its overall score is above this (0-5 scale).
  preferred_threshold numeric(3,2) not null default 2 check (preferred_threshold between 0 and 5),
  -- No signed Code of Conduct: shown with a score but never on the PSL.
  require_coc boolean not null default true,
  -- Missing data: 'redistribute' spreads the weight over criteria that have data; 'zero' scores it 0.
  missing_data text not null default 'redistribute' check (missing_data in ('redistribute','zero')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  activated_by uuid references public.profiles(id),
  activated_at timestamptz
);
create unique index scorecard_one_active on public.scorecard_methodologies ((true)) where status = 'active';
create unique index scorecard_one_draft on public.scorecard_methodologies ((true)) where status = 'draft';

create table public.scorecard_pillars (
  id uuid primary key default gen_random_uuid(),
  methodology_id uuid not null references public.scorecard_methodologies(id) on delete cascade,
  key text not null,
  label text not null,
  weight numeric(5,2) not null check (weight between 0 and 100),
  description text,
  sort int not null default 0,
  unique (methodology_id, key)
);

-- kind: number (bands on a measured value), option (score per listed value), composite (weighted sub-measures).
-- bands (number):    [{"min":98,"score":5}, {"below":90,"score":1}, {"score":0}]  first matching band wins;
--                    min (>=), above (>), max (<=), below (<); a band with no condition is the catch-all.
-- bands (option):    [{"value":"diamond","label":"Diamond","score":5}, ...]
-- bands (composite): {"parts":[{"key":"nc_spoilage","label":"...","unit":"USD","weight":50,"bands":[...]}]}
-- fallback_criterion: when the input is 'not_applicable', use that criterion's score (e.g. FSC for non-print suppliers).
create table public.scorecard_criteria (
  id uuid primary key default gen_random_uuid(),
  methodology_id uuid not null references public.scorecard_methodologies(id) on delete cascade,
  pillar_key text not null,
  key text not null,
  label text not null,
  weight numeric(5,2) not null check (weight between 0 and 100),
  kind text not null check (kind in ('number','option','composite')),
  unit text,
  bands jsonb not null,
  fallback_criterion text,
  source text,
  description text,
  open_point text,
  sort int not null default 0,
  unique (methodology_id, key)
);

-- Measured inputs per supplier (key-value so new criteria need no schema change).
create table public.scorecard_inputs (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  key text not null,
  value_num numeric,
  value_text text,
  as_of date not null default current_date,
  source text,
  primary key (supplier_id, key)
);

create table public.scorecard_audit (
  id bigint generated always as identity primary key,
  methodology_id uuid not null references public.scorecard_methodologies(id) on delete cascade,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.profiles(id),
  at timestamptz not null default now()
);

alter table public.scorecard_methodologies enable row level security;
alter table public.scorecard_pillars enable row level security;
alter table public.scorecard_criteria enable row level security;
alter table public.scorecard_inputs enable row level security;
alter table public.scorecard_audit enable row level security;

-- Internal staff read everything; vendors see nothing. Writes go through the functions below.
create policy sc_meth_read on public.scorecard_methodologies for select to authenticated using (public.is_internal());
create policy sc_pillar_read on public.scorecard_pillars for select to authenticated using (public.is_internal());
create policy sc_crit_read on public.scorecard_criteria for select to authenticated using (public.is_internal());
create policy sc_input_read on public.scorecard_inputs for select to authenticated using (public.is_internal());
create policy sc_audit_read on public.scorecard_audit for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.scorecard_methodologies, public.scorecard_pillars, public.scorecard_criteria,
  public.scorecard_audit from authenticated, anon;
-- Inputs: admins maintain by hand until the data feeds (PO data, Airtable/Gravity, supplier data) are connected.
create policy sc_input_admin on public.scorecard_inputs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------------
create or replace function public._scorecard_require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change the scorecard methodology' using errcode = '42501'; end if;
end $$;

-- Copy the active version into a new draft (or return the open draft).
create or replace function public.scorecard_create_draft() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_active public.scorecard_methodologies; v_id uuid;
begin
  perform public._scorecard_require_admin();
  select id into v_id from public.scorecard_methodologies where status = 'draft';
  if v_id is not null then return v_id; end if;
  select * into v_active from public.scorecard_methodologies where status = 'active';
  if v_active.id is null then raise exception 'No active methodology to copy'; end if;

  insert into public.scorecard_methodologies (version, status, preferred_threshold, require_coc, missing_data, notes, created_by)
  values ((select max(version) + 1 from public.scorecard_methodologies), 'draft',
          v_active.preferred_threshold, v_active.require_coc, v_active.missing_data, null, auth.uid())
  returning id into v_id;
  insert into public.scorecard_pillars (methodology_id, key, label, weight, description, sort)
    select v_id, key, label, weight, description, sort from public.scorecard_pillars where methodology_id = v_active.id;
  insert into public.scorecard_criteria (methodology_id, pillar_key, key, label, weight, kind, unit, bands, fallback_criterion, source, description, open_point, sort)
    select v_id, pillar_key, key, label, weight, kind, unit, bands, fallback_criterion, source, description, open_point, sort
    from public.scorecard_criteria where methodology_id = v_active.id;
  insert into public.scorecard_audit (methodology_id, action, detail, actor)
    values (v_id, 'draft_created', jsonb_build_object('from_version', v_active.version), auth.uid());
  return v_id;
end $$;

-- Save edits to the draft. p_settings: {preferred_threshold, require_coc, missing_data, notes}
-- p_pillars: [{key, weight}]   p_criteria: [{key, weight, bands}]   Only changed fields are audited.
create or replace function public.scorecard_save_draft(p_id uuid, p_settings jsonb, p_pillars jsonb, p_criteria jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare m public.scorecard_methodologies; r jsonb; old_p public.scorecard_pillars; old_c public.scorecard_criteria; changes jsonb := '[]'::jsonb;
begin
  perform public._scorecard_require_admin();
  select * into m from public.scorecard_methodologies where id = p_id for update;
  if m.id is null or m.status <> 'draft' then raise exception 'Only a draft can be edited'; end if;

  if p_settings ? 'preferred_threshold' and (p_settings->>'preferred_threshold')::numeric is distinct from m.preferred_threshold then
    changes := changes || jsonb_build_object('field','preferred_threshold','before',m.preferred_threshold,'after',(p_settings->>'preferred_threshold')::numeric);
  end if;
  if p_settings ? 'require_coc' and (p_settings->>'require_coc')::boolean is distinct from m.require_coc then
    changes := changes || jsonb_build_object('field','require_coc','before',m.require_coc,'after',(p_settings->>'require_coc')::boolean);
  end if;
  if p_settings ? 'missing_data' and p_settings->>'missing_data' is distinct from m.missing_data then
    changes := changes || jsonb_build_object('field','missing_data','before',m.missing_data,'after',p_settings->>'missing_data');
  end if;
  update public.scorecard_methodologies set
    preferred_threshold = coalesce((p_settings->>'preferred_threshold')::numeric, preferred_threshold),
    require_coc = coalesce((p_settings->>'require_coc')::boolean, require_coc),
    missing_data = coalesce(p_settings->>'missing_data', missing_data),
    notes = case when p_settings ? 'notes' then nullif(p_settings->>'notes','') else notes end
  where id = p_id;

  for r in select * from jsonb_array_elements(coalesce(p_pillars, '[]'::jsonb)) loop
    select * into old_p from public.scorecard_pillars where methodology_id = p_id and key = r->>'key';
    if old_p.id is null then raise exception 'Unknown pillar %', r->>'key'; end if;
    if (r->>'weight')::numeric is distinct from old_p.weight then
      changes := changes || jsonb_build_object('field','pillar:' || old_p.key || ':weight','before',old_p.weight,'after',(r->>'weight')::numeric);
      update public.scorecard_pillars set weight = (r->>'weight')::numeric where id = old_p.id;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_criteria, '[]'::jsonb)) loop
    select * into old_c from public.scorecard_criteria where methodology_id = p_id and key = r->>'key';
    if old_c.id is null then raise exception 'Unknown criterion %', r->>'key'; end if;
    if r ? 'weight' and (r->>'weight')::numeric is distinct from old_c.weight then
      changes := changes || jsonb_build_object('field','criterion:' || old_c.key || ':weight','before',old_c.weight,'after',(r->>'weight')::numeric);
      update public.scorecard_criteria set weight = (r->>'weight')::numeric where id = old_c.id;
    end if;
    if r ? 'bands' and (r->'bands') is distinct from old_c.bands then
      changes := changes || jsonb_build_object('field','criterion:' || old_c.key || ':bands','before',old_c.bands,'after',r->'bands');
      update public.scorecard_criteria set bands = r->'bands' where id = old_c.id;
    end if;
  end loop;

  if jsonb_array_length(changes) > 0 then
    insert into public.scorecard_audit (methodology_id, action, detail, actor) values (p_id, 'draft_edited', jsonb_build_object('changes', changes), auth.uid());
  end if;
end $$;

-- Make the draft live. Weights must add up: pillars to 100, and criteria to 100 inside each pillar.
create or replace function public.scorecard_activate(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.scorecard_methodologies; v_old uuid; v_sum numeric; p record;
begin
  perform public._scorecard_require_admin();
  select * into m from public.scorecard_methodologies where id = p_id for update;
  if m.id is null or m.status <> 'draft' then raise exception 'Only a draft can be activated'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what changed and why before activating'; end if;

  select sum(weight) into v_sum from public.scorecard_pillars where methodology_id = p_id;
  if v_sum <> 100 then raise exception 'Pillar weights add up to %, not 100', v_sum; end if;
  for p in select key, label from public.scorecard_pillars where methodology_id = p_id loop
    select coalesce(sum(weight), 0) into v_sum from public.scorecard_criteria where methodology_id = p_id and pillar_key = p.key;
    if v_sum <> 100 then raise exception '% criteria add up to %, not 100', p.label, v_sum; end if;
  end loop;

  select id into v_old from public.scorecard_methodologies where status = 'active' for update;
  update public.scorecard_methodologies set status = 'superseded' where id = v_old;
  update public.scorecard_methodologies set status = 'active', notes = p_note, activated_by = auth.uid(), activated_at = now() where id = p_id;
  insert into public.scorecard_audit (methodology_id, action, detail, actor)
    values (p_id, 'activated', jsonb_build_object('note', p_note, 'replaces_version', (select version from public.scorecard_methodologies where id = v_old)), auth.uid());
end $$;

create or replace function public.scorecard_discard_draft(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._scorecard_require_admin();
  update public.scorecard_methodologies set status = 'discarded' where id = p_id and status = 'draft';
  if not found then raise exception 'Only a draft can be discarded'; end if;
  insert into public.scorecard_audit (methodology_id, action, actor) values (p_id, 'draft_discarded', auth.uid());
end $$;

revoke execute on function public._scorecard_require_admin() from public, anon, authenticated;
grant execute on function public.scorecard_create_draft() to authenticated;
grant execute on function public.scorecard_save_draft(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.scorecard_activate(uuid, text) to authenticated;
grant execute on function public.scorecard_discard_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Version 1: the Review tab of Supplier Ranking Criteria.xlsx (Financial 45 / Compliance 20 / Performance 35).
-- Where the source left a choice open, the choice made is noted in open_point so the Watchtower shows it.
-- ---------------------------------------------------------------------------
do $$
declare v uuid;
begin
  insert into public.scorecard_methodologies (version, status, preferred_threshold, require_coc, missing_data, notes, activated_at)
  values (1, 'active', 2, true, 'redistribute',
          'Initial version from the Global PSL Supplier Ranking Criteria (Review tab). Financial scoring uses straight bands per region-neutral scale; the regional matrix is an open point.',
          now())
  returning id into v;

  insert into public.scorecard_pillars (methodology_id, key, label, weight, description, sort) values
  (v, 'financial', 'Financial', 45, 'Commercial terms we hold with the supplier: payment terms, NTI and financial health.', 1),
  (v, 'compliance', 'Compliance', 20, 'Code of conduct, systems use, audits, certifications and sustainability credentials.', 2),
  (v, 'performance', 'Performance', 35, 'How the supplier delivers: on time in full, quality, responsiveness and competitiveness.', 3);

  insert into public.scorecard_criteria (methodology_id, pillar_key, key, label, weight, kind, unit, bands, fallback_criterion, source, description, open_point, sort) values
  (v, 'financial', 'payment_terms', 'Payment terms', 45, 'number', 'days',
   '[{"max":0,"score":0},{"below":30,"score":1},{"below":45,"score":2},{"below":60,"score":3},{"below":120,"score":4},{"score":5}]',
   null, 'Supplier data', 'Agreed payment term in days (end of month). Prepayment or deposit scores 0.',
   'Straight bands as proposed by EMEA. Jeff''s alternative rates payment terms and NTI together on a regional heatmap, relative to the supplier pool in each region. Not yet agreed.', 1),
  (v, 'financial', 'nti', 'NTI', 45, 'number', '%',
   '[{"max":0,"score":0},{"below":3,"score":1},{"below":5,"score":2},{"below":10,"score":3},{"below":15,"score":4},{"score":5}]',
   null, 'Supplier data', 'Net trade income (rebate) agreed with the supplier, as a % of spend. The score is shown, not the NTI value.',
   'Whether the NTI % itself stays visible is open (BI point 3).', 2),
  (v, 'financial', 'credit_check', 'Credit check', 10, 'option', null,
   '[{"value":"pass","label":"Pass","score":5},{"value":"watch","label":"Watch","score":3},{"value":"fail","label":"Fail","score":0}]',
   null, 'Credit agency', 'Latest credit check result.', 'Bands not defined in the source; Pass/Watch/Fail proposed.', 3),

  (v, 'compliance', 'coc', 'Signed Code of Conduct', 5, 'option', null,
   '[{"value":"yes","label":"Signed","score":5},{"value":"no","label":"Not signed","score":0}]',
   null, 'Supplier data', 'Signed adm Indicia Code of Conduct on file.',
   'Sustainability view: a vendor without a signed CoC should not be scored or onboarded. Applied here as a PSL block (setting).', 1),
  (v, 'compliance', 'eproc', 'eProc engagement', 5, 'option', null,
   '[{"value":"eproc","label":"Uses eProc","score":5},{"value":"offline","label":"Offline","score":0}]',
   null, 'Finance report (eProc cube)', 'Supplier submits through eProc rather than offline.',
   'Legacy Indicia suppliers: status unclear (phase 2). EMEA proposed scoring document submission speed instead.', 2),
  (v, 'compliance', 'csr_audit', 'CSR audit', 30, 'option', null,
   '[{"value":"diamond","label":"Diamond","score":5},{"value":"green","label":"Green","score":4},{"value":"orange","label":"Orange","score":2},{"value":"expired","label":"Expired","score":1},{"value":"red","label":"Red or Black","score":0}]',
   null, 'Supplier data', 'Latest CSR audit grade. Grace periods: new suppliers 6 months, incumbents 12 months, expired 4 months to re-audit.',
   'Sustainability asked for CSR at 35% and the Sustainability pillar at 20% overall.', 3),
  (v, 'compliance', 'ems_audit', 'EMS audit', 10, 'option', null,
   '[{"value":"diamond","label":"Diamond","score":5},{"value":"certified","label":"ISO 14001 certified","score":5},{"value":"green","label":"Green","score":4},{"value":"orange","label":"Orange","score":1},{"value":"red","label":"Red or Black","score":0}]',
   null, 'Supplier data', 'Environmental management audit grade, or ISO 14001 certification.',
   'ISO 14001 is pass/fail, not graded; "certified" added at 5. Source for legacy Indicia suppliers open.', 4),
  (v, 'compliance', 'qms_audit', 'QMS audit', 15, 'option', null,
   '[{"value":"diamond","label":"Diamond","score":5},{"value":"certified","label":"ISO 9001 certified","score":5},{"value":"green","label":"Green","score":4},{"value":"orange","label":"Orange","score":1},{"value":"red","label":"Red or Black","score":0}]',
   null, 'Supplier data', 'Quality management audit grade, or ISO 9001 certification.',
   'Several regions think QMS belongs under Procurement partnership or Performance, not Compliance.', 5),
  (v, 'compliance', 'fsc', 'FSC certification', 15, 'option', null,
   '[{"value":"active","label":"Active","score":5},{"value":"expired","label":"Expired or missing (print, corrugate or wood supplier)","score":0},{"value":"not_applicable","label":"Not a print, corrugate or wood supplier","score":null}]',
   'csr_audit', 'Supplier data', 'Applies to suppliers whose top categories include print, corrugate or wood. For everyone else it takes the CSR audit score.',
   'Using the CSR score for non-print suppliers nearly doubles CSR''s weight for them. Open to a better reallocation.', 6),
  (v, 'compliance', 'sedex', 'SEDEX membership', 5, 'option', null,
   '[{"value":"active","label":"Active","score":5},{"value":"expired","label":"Expired","score":1},{"value":"none","label":"No membership","score":0}]',
   null, 'Supplier data', 'SEDEX membership status.',
   'APAC: accept equivalent client audits (e.g. client responsible-sourcing audits). Sustainability asked for 10%.', 7),
  (v, 'compliance', 'diverse', 'Small and diverse supplier', 5, 'option', null,
   '[{"value":"yes","label":"Small and diverse","score":5},{"value":"no","label":"No","score":0}]',
   null, 'Supplier data', 'Supplier is classed as small and diverse.', null, 8),
  (v, 'compliance', 'renewable', 'Renewable energy', 10, 'option', null,
   '[{"value":"full","label":"100% renewable","score":5},{"value":"partial","label":"Partly renewable","score":3},{"value":"none","label":"Non-renewable","score":0}]',
   null, 'Supplier data', 'Share of the supplier''s energy from renewable sources.', 'Added at Sustainability''s request.', 9),

  (v, 'performance', 'otif', 'On time in full (OTIF)', 30, 'number', '%',
   '[{"above":98,"score":5},{"min":96,"score":4},{"min":95,"score":3},{"min":90,"score":2},{"score":1}]',
   null, 'PO data (Stocktool)', 'Last 12 months: share of POs where confirmed arrival at destination is on or before the estimated arrival date. Uses whatever history exists if under 12 months.',
   'Accuracy depends on account teams updating delivery dates when clients change them.', 1),
  (v, 'performance', 'non_conformance', 'Non-conformance', 30, 'composite', null,
   '{"parts":[
      {"key":"nc_spoilage","label":"Spoilage value (last 12 months)","unit":"USD","weight":50,"bands":[{"max":0,"score":5},{"below":5000,"score":3},{"below":10000,"score":2},{"score":0}]},
      {"key":"nc_claims","label":"Number of claims","unit":"claims","weight":25,"bands":[{"max":0,"score":5},{"max":3,"score":3},{"max":5,"score":1},{"score":0}]},
      {"key":"nc_settled","label":"Claim value settled by supplier","unit":"%","weight":15,"bands":[{"min":100,"score":5},{"min":96,"score":3},{"min":90,"score":1},{"score":0}]},
      {"key":"nc_resolution_days","label":"Days to close an issue","unit":"days","weight":10,"bands":[{"max":7,"score":5},{"max":20,"score":3},{"score":0}]}
    ]}',
   null, 'QC claims (Airtable today; Gravity planned)', 'Weighted from spoilage, claim count, claim value settled and speed of resolution. Faster resolution scores higher.',
   'Source not maintained; needs standardising into one system (phase 2). APAC: normalise by spend and job complexity.', 2),
  (v, 'performance', 'sla_quotes', 'SLA on quotes', 10, 'number', '%',
   '[{"above":95,"score":5},{"min":90,"score":3},{"score":0}]',
   null, 'Supplier quotes', 'Share of quotes submitted on or before the brief return date.',
   'Promo: add SLA on samples. Some want this replaced by competitive bids.', 3),
  (v, 'performance', 'competitive_bids', 'Competitive bids', 30, 'number', '%',
   '[{"min":30,"score":5},{"min":20,"score":4},{"min":10,"score":3},{"min":5,"score":2},{"above":0,"score":1},{"score":0}]',
   null, 'Sourcing RFQ results', 'Brief win rate: share of briefs quoted where this supplier was awarded.',
   'Bands proposed, not in the source. Data source and method to agree (phase 2). Delphine: include cost transparency and innovation.', 4);

  insert into public.scorecard_audit (methodology_id, action, detail) values (v, 'activated', '{"note":"Initial version"}');
end $$;
