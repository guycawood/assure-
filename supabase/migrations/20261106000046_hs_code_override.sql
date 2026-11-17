-- HS codes on the job and supplier views, with an override and an input.
--   * A spec's HS code now records where it came from (person, library suggestion, or the supplier's declaration), who set it and why.
--     Every change is written to the job's activity (sourcing_events).
--   * A supplier can declare the HS code they use for a spec they are quoting or supplying (spec_hs_declarations). That is an input,
--     not an override: staff see it next to the spec's code and choose to accept it or keep their own.
--   * spec_hs_overview gives staff, for a job or a supplier, each spec with its code, the library's suggestion and what suppliers declared.
-- A spec on a live or awarded RFQ is locked for most changes, but an HS code is Stocktool article data and stays editable, as before.

alter table public.job_specs
  add column if not exists hs_code_source text check (hs_code_source in ('person', 'library', 'supplier')),
  add column if not exists hs_code_note text,
  add column if not exists hs_code_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists hs_code_set_at timestamptz;

create table public.spec_hs_declarations (
  spec_id uuid not null references public.job_specs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  hs_code text not null check (hs_code ~ '^[0-9]{4}([.]?[0-9]{2}){0,3}$'),
  note text,
  declared_by uuid references public.profiles(id) on delete set null,
  declared_at timestamptz not null default now(),
  primary key (spec_id, supplier_id)
);
alter table public.spec_hs_declarations enable row level security;
create policy shd_read on public.spec_hs_declarations for select to authenticated using (public.is_internal() or supplier_id = public.my_supplier_id());
revoke insert, update, delete on public.spec_hs_declarations from authenticated, anon;

create or replace function public._hs_clean(p text) returns text language plpgsql immutable as $$
declare v text := nullif(replace(trim(coalesce(p, '')), ' ', ''), '');
begin
  if v is not null and v !~ '^[0-9]{4}([.]?[0-9]{2}){0,3}$' then raise exception 'An HS code is 4 to 10 digits, for example 4911.10'; end if;
  return v;
end $$;

-- Staff set, change or clear a spec's HS code. Blank clears it. The source says where it came from.
create or replace function public.spec_hs_set(p_spec uuid, p_code text, p_source text default 'person', p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.job_specs; v text := public._hs_clean(p_code); v_src text := case when public._hs_clean(p_code) is null then null else coalesce(nullif(p_source, ''), 'person') end;
begin
  if not public.is_internal() then raise exception 'Only staff can set a spec''s HS code' using errcode = '42501'; end if;
  if v_src is not null and v_src not in ('person', 'library', 'supplier') then raise exception 'Unknown source %', p_source; end if;
  select * into s from public.job_specs where id = p_spec for update;
  if s.id is null then raise exception 'Spec not found'; end if;
  if s.hs_code is not distinct from v and s.hs_code_source is not distinct from v_src then return; end if;
  perform set_config('sourcing.system_write', 'on', true); -- HS code stays editable on a locked spec
  update public.job_specs set hs_code = v, hs_code_source = v_src, hs_code_note = nullif(trim(coalesce(p_note, '')), ''),
         hs_code_set_by = auth.uid(), hs_code_set_at = now() where id = p_spec;
  perform set_config('sourcing.system_write', 'off', true);
  perform public._sourcing_event(s.job_id, 'spec', s.id, 'hs_code_set',
    jsonb_build_object('from', s.hs_code, 'to', v, 'source', v_src, 'note', nullif(trim(coalesce(p_note, '')), '')));
end $$;

-- Staff: each spec of a job, or each spec a supplier is on, with its code, the library's suggestion and the suppliers' declarations.
create or replace function public.spec_hs_overview(p_job uuid default null, p_supplier uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_internal() then raise exception 'Only staff can see this' using errcode = '42501'; end if;
  if p_job is null and p_supplier is null then raise exception 'Say which job or supplier'; end if;
  with specs as (
    select sp.* from public.job_specs sp
     where (p_job is not null and sp.job_id = p_job)
        or (p_job is null and p_supplier is not null and exists (
              select 1 from public.estimate_lines el join public.estimates e on e.id = el.estimate_id
               where el.spec_id = sp.id and e.supplier_id = p_supplier and e.status <> 'declined'))
  ), decl as (
    select d.spec_id, d.supplier_id, d.hs_code, d.note, d.declared_at, 'declared'::text as via from public.spec_hs_declarations d
    union all
    select el.spec_id, e.supplier_id, nullif(trim(r.hs_code), ''), null, null, 'quote'
      from public.estimate_lines el join public.estimates e on e.id = el.estimate_id
      join public.rfq_response_lines r on r.response_id = e.response_id and r.line_id = el.rfq_line_id
     where nullif(trim(r.hs_code), '') is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'spec_id', s.id, 'job_id', s.job_id, 'job_number', j.job_number, 'job_title', j.title, 'spec_no', s.spec_no, 'title', s.title, 'is_draft', s.is_draft,
      'hs_code', s.hs_code, 'source', s.hs_code_source, 'note', s.hs_code_note, 'set_at', s.hs_code_set_at,
      'set_by_name', (select full_name from public.profiles where id = s.hs_code_set_by),
      'suggestion', public.hs_code_resolve(s.id),
      'declared', coalesce((select jsonb_agg(jsonb_build_object('supplier_id', d.supplier_id, 'supplier_name', su.name, 'hs_code', d.hs_code, 'note', d.note, 'via', d.via, 'declared_at', d.declared_at) order by su.name)
                              from decl d join public.suppliers su on su.id = d.supplier_id
                             where d.spec_id = s.id and d.hs_code is not null and (p_supplier is null or d.supplier_id = p_supplier)), '[]'::jsonb)
    ) order by j.job_number, s.spec_no), '[]'::jsonb) into v
    from specs s join public.jobs j on j.id = s.job_id;
  return v;
end $$;

-- Vendor: the specs on my estimates, the buyer's code and the one I declared.
create or replace function public.vendor_hs_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); v jsonb;
begin
  if v_sup is null then raise exception 'Not a vendor account' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'spec_id', s.id, 'job_number', j.job_number, 'spec_no', s.spec_no, 'title', s.title, 'buyer_code', s.hs_code,
      'mine', coalesce((select hs_code from public.spec_hs_declarations d where d.spec_id = s.id and d.supplier_id = v_sup),
                       (select nullif(trim(r.hs_code), '') from public.estimate_lines el2 join public.estimates e2 on e2.id = el2.estimate_id
                          join public.rfq_response_lines r on r.response_id = e2.response_id and r.line_id = el2.rfq_line_id
                         where el2.spec_id = s.id and e2.supplier_id = v_sup and nullif(trim(r.hs_code), '') is not null limit 1)),
      'note', (select note from public.spec_hs_declarations d where d.spec_id = s.id and d.supplier_id = v_sup),
      'declared_at', (select declared_at from public.spec_hs_declarations d where d.spec_id = s.id and d.supplier_id = v_sup)
    ) order by j.job_number, s.spec_no), '[]'::jsonb) into v
    from public.job_specs s join public.jobs j on j.id = s.job_id
   where exists (select 1 from public.estimate_lines el join public.estimates e on e.id = el.estimate_id
                  where el.spec_id = s.id and e.supplier_id = v_sup and e.status <> 'declined');
  return v;
end $$;

-- Vendor: declare (or clear) the HS code I use for a spec I am supplying. It does not change the spec; staff decide.
create or replace function public.vendor_hs_declare(p_spec uuid, p_code text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_sup uuid := public.my_supplier_id(); v text := public._hs_clean(p_code); s public.job_specs;
begin
  if v_sup is null then raise exception 'Not a vendor account' using errcode = '42501'; end if;
  select sp.* into s from public.job_specs sp
   where sp.id = p_spec and exists (select 1 from public.estimate_lines el join public.estimates e on e.id = el.estimate_id
                                     where el.spec_id = sp.id and e.supplier_id = v_sup and e.status <> 'declined');
  if s.id is null then raise exception 'That spec is not one you are supplying'; end if;
  if v is null then
    delete from public.spec_hs_declarations where spec_id = p_spec and supplier_id = v_sup;
  else
    insert into public.spec_hs_declarations (spec_id, supplier_id, hs_code, note, declared_by)
    values (p_spec, v_sup, v, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
    on conflict (spec_id, supplier_id) do update set hs_code = excluded.hs_code, note = excluded.note, declared_by = auth.uid(), declared_at = now();
  end if;
  perform public._sourcing_event(s.job_id, 'spec', s.id, 'hs_code_declared',
    jsonb_build_object('supplier_id', v_sup, 'hs_code', v, 'note', nullif(trim(coalesce(p_note, '')), '')));
end $$;

revoke execute on function public._hs_clean(text), public.spec_hs_set(uuid, text, text, text), public.spec_hs_overview(uuid, uuid),
  public.vendor_hs_list(), public.vendor_hs_declare(uuid, text, text) from public, anon;
grant execute on function public.spec_hs_set(uuid, text, text, text), public.spec_hs_overview(uuid, uuid),
  public.vendor_hs_list(), public.vendor_hs_declare(uuid, text, text), public._hs_clean(text) to authenticated;
