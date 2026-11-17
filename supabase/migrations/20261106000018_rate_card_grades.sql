-- Rate cards carry an Impact Grade. A card without a reviewed grade cannot be chosen.
-- The grade is worked out by the same engine as specs (TypeScript) from the card's material, size and supplier;
-- this file stores what the engine worked out, keeps the audit trail, and enforces a second-person review.

create table public.rate_card_grades (
  card_id uuid primary key references public.library_records(id) on delete cascade,
  score numeric(4,1) check (score is null or score between 0 and 100),
  letter text,
  coverage numeric(5,2) check (coverage is null or coverage between 0 and 100),
  confidence int check (confidence is null or confidence between 0 and 100),
  range_low numeric(4,1),
  range_high numeric(4,1),
  pef_mpt numeric check (pef_mpt is null or pef_mpt >= 0),
  supplier_score numeric(4,1) check (supplier_score is null or supplier_score between 0 and 100),
  inputs jsonb not null default '{}'::jsonb,
  tiers jsonb not null default '{}'::jsonb,
  sub_scores jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'reviewed', 'disputed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rate_card_grade_events (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.library_records(id) on delete cascade,
  action text not null check (action in ('calculate', 'review')),
  detail jsonb not null default '{}'::jsonb,
  reason text,
  by uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index rate_card_grade_events_idx on public.rate_card_grade_events (card_id, at desc);

alter table public.rate_card_grades enable row level security;
alter table public.rate_card_grade_events enable row level security;
create policy rcg_read on public.rate_card_grades for select to authenticated using (public.is_internal());
create policy rcge_read on public.rate_card_grade_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.rate_card_grades, public.rate_card_grade_events from authenticated, anon;

-- Save what the engine worked out for a card. p: {score, letter, coverage, confidence, range_low, range_high, pef_mpt,
-- supplier_score, inputs, tiers, sub_scores, warnings}. A recalculation that changes the grade goes back to unreviewed.
create or replace function public.rate_card_grade_save(p_card uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev numeric; v_had boolean; v_score numeric := nullif(p->>'score', '')::numeric;
begin
  if not public.is_internal() then raise exception 'Only staff can save a rate card grade' using errcode = '42501'; end if;
  if not exists (select 1 from public.library_records where id = p_card and library_key = 'rate_cards') then raise exception 'Rate card not found'; end if;
  select score, true into v_prev, v_had from public.rate_card_grades where card_id = p_card;
  if v_had is null then insert into public.rate_card_grades (card_id, updated_by) values (p_card, auth.uid()); end if;
  update public.rate_card_grades set
    score = v_score, letter = p->>'letter', coverage = nullif(p->>'coverage', '')::numeric, confidence = nullif(p->>'confidence', '')::int,
    range_low = nullif(p->>'range_low', '')::numeric, range_high = nullif(p->>'range_high', '')::numeric,
    pef_mpt = nullif(p->>'pef_mpt', '')::numeric, supplier_score = nullif(p->>'supplier_score', '')::numeric,
    inputs = coalesce(p->'inputs', '{}'::jsonb), tiers = coalesce(p->'tiers', '{}'::jsonb),
    sub_scores = coalesce(p->'sub_scores', '[]'::jsonb), warnings = coalesce(p->'warnings', '[]'::jsonb),
    review_status = case when v_prev is distinct from v_score then 'unreviewed' else review_status end,
    reviewed_by = case when v_prev is distinct from v_score then null else reviewed_by end,
    reviewed_at = case when v_prev is distinct from v_score then null else reviewed_at end,
    updated_by = auth.uid(), updated_at = now()
  where card_id = p_card;
  insert into public.rate_card_grade_events (card_id, action, detail, by)
  values (p_card, 'calculate', jsonb_build_object('from', v_prev, 'to', v_score, 'confidence', p->'confidence'), auth.uid());
end $$;
revoke execute on function public.rate_card_grade_save(uuid, jsonb) from public, anon;
grant execute on function public.rate_card_grade_save(uuid, jsonb) to authenticated;

-- Review decision. Whoever last calculated the grade cannot review it.
create or replace function public.rate_card_grade_review(p_card uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rate_card_grades;
begin
  if not public.is_internal() then raise exception 'Only staff can review a rate card grade' using errcode = '42501'; end if;
  if p_status not in ('reviewed', 'disputed', 'unreviewed') then raise exception 'Unknown review status'; end if;
  select * into r from public.rate_card_grades where card_id = p_card;
  if r.card_id is null then raise exception 'This rate card has no grade yet'; end if;
  if p_status = 'reviewed' and r.updated_by is not distinct from auth.uid() then
    raise exception 'A different person must review it: you last calculated this grade';
  end if;
  if p_status = 'disputed' and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say what is wrong'; end if;
  update public.rate_card_grades set review_status = p_status,
    reviewed_by = case when p_status = 'unreviewed' then null else auth.uid() end,
    reviewed_at = case when p_status = 'unreviewed' then null else now() end,
    review_note = nullif(trim(p_note), '') where card_id = p_card;
  insert into public.rate_card_grade_events (card_id, action, detail, reason, by)
  values (p_card, 'review', jsonb_build_object('status', p_status), p_note, auth.uid());
end $$;
revoke execute on function public.rate_card_grade_review(uuid, text, text) from public, anon;
grant execute on function public.rate_card_grade_review(uuid, text, text) to authenticated;

-- The rate card list for Sourcing: every card with its supplier, its grade and whether it can be chosen today.
-- Chosen = active, in date, supplier eligible in SRM, and a reviewed grade.
create or replace function public.sourcing_rate_cards() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate cards' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'code', r.code, 'name', r.name, 'status', r.status, 'effective_from', r.effective_from, 'effective_to', r.effective_to,
      'spec_type', r.data->>'spec_type', 'substrate_code', r.data->>'substrate_code',
      'length_mm', r.data->>'finished_length_mm', 'width_mm', r.data->>'finished_width_mm',
      'min_qty', r.data->>'min_qty', 'max_qty', r.data->>'max_qty',
      'unit_price', r.data->>'unit_price', 'currency', r.data->>'currency', 'client_code', r.data->>'client_code',
      'supplier_id', s.id, 'supplier_name', s.name, 'supplier_eligible', (s.id is not null and s.active and not s.purchasing_blocked),
      'grade', case when g.card_id is null then null else jsonb_build_object('score', g.score, 'letter', g.letter, 'confidence', g.confidence,
                 'range_low', g.range_low, 'range_high', g.range_high, 'review_status', g.review_status, 'updated_at', g.updated_at) end,
      'in_date', (r.status = 'active' and r.effective_from <= current_date and (r.effective_to is null or r.effective_to >= current_date)),
      'selectable', coalesce(r.status = 'active' and r.effective_from <= current_date and (r.effective_to is null or r.effective_to >= current_date)
                     and s.id is not null and s.active and not s.purchasing_blocked and g.review_status = 'reviewed', false)
    ) order by r.code), '[]'::jsonb)
    into v_out
    from public.library_records r
    left join public.suppliers s on s.supplier_code = r.data->>'supplier_code'
    left join public.rate_card_grades g on g.card_id = r.id
   where r.library_key = 'rate_cards' and r.status in ('active', 'pending_approval');
  return v_out;
end $$;
revoke execute on function public.sourcing_rate_cards() from public, anon;
grant execute on function public.sourcing_rate_cards() to authenticated;
