-- Assure+ performance: period scores per supplier and the performance issues feed.
-- Scores are entered by staff through assure_record_performance() (audited); the composite is computed, never typed.
-- Issues are generated here, on the server, from the latest period and the certificates (never by the vendor):
--   NCRs raised in the period > 0 (critical at 5+, high at 3+), defect rate > 2% (critical at 8+, high at 5+),
--   OTIF < 70 (critical under 50), certificate expired (critical), certificate expiring within 90 days (high).
-- Vendors see their own issues (no internal notes) and respond; staff resolve.

create table public.performance_records (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  period text not null check (period ~ '^\d{4}-Q[1-4]$'),
  cost_score numeric(5,2) check (cost_score between 0 and 100),
  otif_score numeric(5,2) check (otif_score between 0 and 100),
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  compliance_score numeric(5,2) check (compliance_score between 0 and 100),
  sustainability_score numeric(5,2) check (sustainability_score between 0 and 100),
  composite_score numeric(5,2),
  ncr_count int not null default 0 check (ncr_count >= 0),
  defect_rate numeric(5,2) check (defect_rate is null or defect_rate between 0 and 100),
  internal_notes text,
  entered_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (supplier_id, period)
);
create trigger performance_records_region before insert on public.performance_records
  for each row execute function public._assure_fill_region_market();

-- Composite = plain average of the scores that have data (no hidden weighting).
create or replace function public._perf_composite() returns trigger
language plpgsql as $$
declare v numeric[] := array_remove(array[new.cost_score, new.otif_score, new.quality_score, new.compliance_score, new.sustainability_score], null);
begin
  new.composite_score := case when cardinality(v) = 0 then null else round((select avg(x) from unnest(v) x), 2) end;
  new.updated_at := now();
  return new;
end $$;
create trigger performance_records_composite before insert or update on public.performance_records
  for each row execute function public._perf_composite();

alter table public.performance_records enable row level security;
create policy perf_read on public.performance_records for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.performance_records from authenticated, anon;

create view public.vendor_performance_records as
  select id, supplier_id, period, cost_score, otif_score, quality_score, compliance_score, sustainability_score,
         composite_score, ncr_count, defect_rate, updated_at
    from public.performance_records where supplier_id = public.my_supplier_id();
revoke all on public.vendor_performance_records from anon;
grant select on public.vendor_performance_records to authenticated;

-- p_scores: {cost, otif, quality, compliance, sustainability, ncr_count, defect_rate, notes}
create or replace function public.assure_record_performance(p_supplier uuid, p_period text, p_scores jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old public.performance_records;
begin
  perform public._assure_require_internal();
  if not (public.assure_is_vendor_manager() or public.assure_is_procurement()) then
    raise exception 'Only vendor managers, procurement or admins can record performance scores' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-Q[1-4]$' then raise exception 'Period must look like 2026-Q3'; end if;
  select * into v_old from public.performance_records where supplier_id = p_supplier and period = p_period;
  insert into public.performance_records (supplier_id, period, cost_score, otif_score, quality_score, compliance_score, sustainability_score,
                                          ncr_count, defect_rate, internal_notes, entered_by)
  values (p_supplier, p_period, (p_scores->>'cost')::numeric, (p_scores->>'otif')::numeric, (p_scores->>'quality')::numeric,
          (p_scores->>'compliance')::numeric, (p_scores->>'sustainability')::numeric, coalesce((p_scores->>'ncr_count')::int, 0),
          (p_scores->>'defect_rate')::numeric, nullif(p_scores->>'notes', ''), auth.uid())
  on conflict (supplier_id, period) do update set
    cost_score = excluded.cost_score, otif_score = excluded.otif_score, quality_score = excluded.quality_score,
    compliance_score = excluded.compliance_score, sustainability_score = excluded.sustainability_score,
    ncr_count = excluded.ncr_count, defect_rate = excluded.defect_rate, internal_notes = excluded.internal_notes, entered_by = auth.uid()
  returning id into v_id;
  perform public._assure_log(p_supplier, 'performance', v_id, case when v_old.id is null then 'recorded' else 'corrected' end,
    v_old.composite_score::text, (select composite_score::text from public.performance_records where id = v_id),
    'Performance ' || p_period || case when v_old.id is null then ' recorded' else ' corrected' end, null);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Performance issues feed
-- ---------------------------------------------------------------------------
create table public.performance_issues (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  issue_type text not null check (issue_type in ('ncr','defect_rate','otif_miss','compliance_expired','compliance_expiring','quality_drop')),
  source_key text not null,
  title text not null,
  period text,
  severity text not null default 'medium' check (severity in ('critical','high','medium','low')),
  acknowledgement_status text not null default 'pending' check (acknowledgement_status in ('pending','acknowledged','responded','resolved','disputed')),
  acknowledged_at timestamptz,
  supplier_response text,
  corrective_action text,
  target_resolution_date date,
  internal_notes text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (supplier_id, source_key)
);
create index performance_issues_supplier_idx on public.performance_issues (supplier_id, created_at desc);
create trigger performance_issues_region before insert on public.performance_issues
  for each row execute function public._assure_fill_region_market();

alter table public.performance_issues enable row level security;
create policy pi_read on public.performance_issues for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.performance_issues from authenticated, anon;

create view public.vendor_performance_issues as
  select id, supplier_id, issue_type, title, period, severity, acknowledgement_status, acknowledged_at, supplier_response,
         corrective_action, target_resolution_date, resolved_at, created_at
    from public.performance_issues where supplier_id = public.my_supplier_id();
revoke all on public.vendor_performance_issues from anon;
grant select on public.vendor_performance_issues to authenticated;

-- Raise issues for one supplier (or every supplier when p_supplier is null). Idempotent: one issue per source.
create or replace function public.assure_generate_issues(p_supplier uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; m int; s record; p public.performance_records;
begin
  perform public._assure_require_internal();
  for s in select id from public.suppliers where p_supplier is null or id = p_supplier loop
    select * into p from public.performance_records where supplier_id = s.id order by period desc limit 1;
    if p.id is not null then
      if p.ncr_count > 0 then
        insert into public.performance_issues (supplier_id, issue_type, source_key, title, period, severity)
        values (s.id, 'ncr', 'ncr:' || p.period, p.ncr_count || ' non-conformance report' || case when p.ncr_count > 1 then 's' else '' end || ' raised in ' || p.period,
                p.period, case when p.ncr_count >= 5 then 'critical' when p.ncr_count >= 3 then 'high' else 'medium' end)
        on conflict do nothing;
        get diagnostics m = row_count; n := n + m;
      end if;
      if coalesce(p.defect_rate, 0) > 2 then
        insert into public.performance_issues (supplier_id, issue_type, source_key, title, period, severity)
        values (s.id, 'defect_rate', 'defect:' || p.period, 'Defect rate of ' || p.defect_rate || '% is above the 2% target in ' || p.period,
                p.period, case when p.defect_rate >= 8 then 'critical' when p.defect_rate >= 5 then 'high' else 'medium' end)
        on conflict do nothing;
        get diagnostics m = row_count; n := n + m;
      end if;
      if p.otif_score is not null and p.otif_score < 70 then
        insert into public.performance_issues (supplier_id, issue_type, source_key, title, period, severity)
        values (s.id, 'otif_miss', 'otif:' || p.period, 'On time in full score of ' || p.otif_score || ' is below the minimum of 70 in ' || p.period,
                p.period, case when p.otif_score < 50 then 'critical' else 'high' end)
        on conflict do nothing;
        get diagnostics m = row_count; n := n + m;
      end if;
    end if;
    insert into public.performance_issues (supplier_id, issue_type, source_key, title, period, severity)
    select s.id,
           case when c.expiry_date < current_date then 'compliance_expired' else 'compliance_expiring' end,
           case when c.expiry_date < current_date then 'cert_expired:' else 'cert_expiring:' end || c.id,
           lr.name || case when c.expiry_date < current_date then ' certificate has expired' else ' certificate expires soon' end,
           case when c.expiry_date < current_date then 'Expired ' else 'Expires ' end || to_char(c.expiry_date, 'DD Mon YYYY'),
           case when c.expiry_date < current_date then 'critical' else 'high' end
      from public.supplier_certificates c join public.library_records lr on lr.id = c.cert_type_id
     where c.supplier_id = s.id and not c.not_applicable and c.verification_status <> 'rejected'
       and public.assure_expiry_status(c.expiry_date) in ('expired','expiring_soon')
    on conflict do nothing;
    get diagnostics m = row_count; n := n + m;
  end loop;
  return n;
end $$;

create or replace function public.assure_issue_vendor_respond(p_id uuid, p_action text, p_response text, p_corrective text, p_target date)
returns void language plpgsql security definer set search_path = public as $$
declare i public.performance_issues; v_to text;
begin
  select * into i from public.performance_issues where id = p_id for update;
  if not found or public.my_supplier_id() is null or i.supplier_id <> public.my_supplier_id() or public.is_internal() then
    raise exception 'This issue is not for your company' using errcode = '42501';
  end if;
  if i.acknowledgement_status = 'resolved' then raise exception 'This issue is resolved'; end if;
  if p_action = 'acknowledge' then v_to := 'acknowledged';
  elsif p_action in ('respond','dispute') then
    if nullif(trim(coalesce(p_response, '')), '') is null then raise exception 'Write your response first'; end if;
    v_to := case when p_action = 'respond' then 'responded' else 'disputed' end;
  else raise exception 'Unknown action %', p_action;
  end if;
  update public.performance_issues set acknowledgement_status = v_to, acknowledged_at = coalesce(acknowledged_at, now()),
    supplier_response = coalesce(nullif(trim(p_response), ''), supplier_response),
    corrective_action = coalesce(nullif(trim(p_corrective), ''), corrective_action),
    target_resolution_date = coalesce(p_target, target_resolution_date)
   where id = p_id;
  perform public._assure_log(i.supplier_id, 'issue', p_id, 'vendor_' || p_action, i.acknowledgement_status, v_to, i.title, nullif(trim(p_response), ''));
end $$;

create or replace function public.assure_issue_resolve(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.performance_issues;
begin
  perform public._assure_require_internal();
  select * into i from public.performance_issues where id = p_id for update;
  if not found then raise exception 'Issue not found'; end if;
  if i.acknowledgement_status = 'resolved' then raise exception 'Already resolved'; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Record how the issue was resolved'; end if;
  update public.performance_issues set acknowledgement_status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
    internal_notes = trim(p_note) where id = p_id;
  perform public._assure_log(i.supplier_id, 'issue', p_id, 'resolved', i.acknowledgement_status, 'resolved', i.title, trim(p_note));
end $$;

grant execute on function public.assure_record_performance(uuid, text, jsonb), public.assure_generate_issues(uuid),
  public.assure_issue_vendor_respond(uuid, text, text, text, date), public.assure_issue_resolve(uuid, text) to authenticated;
