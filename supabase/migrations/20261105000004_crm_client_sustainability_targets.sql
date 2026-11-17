-- Client sustainability targets on the CRM client profile (5 Nov 2026).
--
-- The client's standing sustainability requirements, held once on the client and used everywhere a brief is written
-- or ideated: Briefing+ pre-fills a new brief's targets from here, and ideation merges them with the brief's own
-- (the stricter wins) so concepts respect the client's commitments even when a brief leaves them out. The Impact
-- Grade floor is the "grade floor" of the System X journey (CRM: client commitments and grade floor), on the 0-100
-- Impact Grade scale. Changes go through crm_client_set_sustainability and are logged in the CRM audit trail.

create table public.crm_client_sustainability (
  client_id uuid primary key references public.sourcing_clients(id) on delete cascade,
  statement text,                                   -- what the client wants, in their words
  min_recycled_pct int check (min_recycled_pct is null or min_recycled_pct between 0 and 100),
  require_fsc boolean not null default false,
  excluded_materials text[] not null default '{}',  -- e.g. PVC, virgin plastic: ideation never suggests them
  recyclable_required boolean not null default false,
  reuse_expected boolean not null default false,
  impact_grade_floor numeric(4,1) check (impact_grade_floor is null or impact_grade_floor between 0 and 100),
  reporting_obligations text,
  source_contract_id uuid references public.crm_contracts(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.crm_client_sustainability enable row level security;
create policy crm_cs_read on public.crm_client_sustainability for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.crm_client_sustainability from authenticated, anon;

create or replace function public._crm_cs_json(r public.crm_client_sustainability) returns jsonb language sql immutable as $$
  select case when r.client_id is null then null else jsonb_build_object(
    'client_id', r.client_id, 'statement', r.statement, 'min_recycled_pct', r.min_recycled_pct, 'require_fsc', r.require_fsc,
    'excluded_materials', to_jsonb(r.excluded_materials), 'recyclable_required', r.recyclable_required, 'reuse_expected', r.reuse_expected,
    'impact_grade_floor', r.impact_grade_floor, 'reporting_obligations', r.reporting_obligations, 'source_contract_id', r.source_contract_id,
    'updated_at', r.updated_at) end;
$$;

/** Set the client's sustainability targets. Internal CRM users; a reason is required; logged in the CRM audit trail. */
create or replace function public.crm_client_set_sustainability(p_client uuid, p jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.crm_client_sustainability; n public.crm_client_sustainability; v_floor numeric; v_pct int; v_mats text[];
begin
  perform public._crm_require();
  if not exists (select 1 from public.sourcing_clients where id = p_client) then raise exception 'Client not found'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why (e.g. the contract clause or the client''s policy)'; end if;
  v_pct := nullif(p->>'min_recycled_pct', '')::int;
  if v_pct is not null and v_pct not between 0 and 100 then raise exception 'Minimum recycled content is 0 to 100%%'; end if;
  v_floor := nullif(p->>'impact_grade_floor', '')::numeric;
  if v_floor is not null and v_floor not between 0 and 100 then raise exception 'The Impact Grade floor is 0 to 100'; end if;
  -- One entry per material, whatever the case it was typed in.
  select coalesce(array_agg(m order by lower(m)), '{}') into v_mats
    from (select distinct on (lower(trim(x))) trim(x) m from jsonb_array_elements_text(coalesce(p->'excluded_materials', '[]'::jsonb)) x
           where trim(x) <> '' order by lower(trim(x))) s;
  if nullif(p->>'source_contract_id', '') is not null
     and not exists (select 1 from public.crm_contracts where id = (p->>'source_contract_id')::uuid and client_id = p_client) then
    raise exception 'That contract belongs to another client';
  end if;
  select * into o from public.crm_client_sustainability where client_id = p_client for update;
  insert into public.crm_client_sustainability as t (client_id, statement, min_recycled_pct, require_fsc, excluded_materials, recyclable_required,
    reuse_expected, impact_grade_floor, reporting_obligations, source_contract_id, updated_by, updated_at)
  values (p_client, nullif(trim(p->>'statement'), ''), v_pct, coalesce((p->>'require_fsc')::boolean, false), v_mats,
    coalesce((p->>'recyclable_required')::boolean, false), coalesce((p->>'reuse_expected')::boolean, false), v_floor,
    nullif(trim(p->>'reporting_obligations'), ''), nullif(p->>'source_contract_id', '')::uuid, auth.uid(), now())
  on conflict (client_id) do update set statement = excluded.statement, min_recycled_pct = excluded.min_recycled_pct, require_fsc = excluded.require_fsc,
    excluded_materials = excluded.excluded_materials, recyclable_required = excluded.recyclable_required, reuse_expected = excluded.reuse_expected,
    impact_grade_floor = excluded.impact_grade_floor, reporting_obligations = excluded.reporting_obligations,
    source_contract_id = excluded.source_contract_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into n;
  perform public._crm_event(p_client, 'client', p_client::text, 'sustainability_targets_changed',
    jsonb_build_object('from', public._crm_cs_json(o) - 'updated_at' - 'client_id', 'to', public._crm_cs_json(n) - 'updated_at' - 'client_id', 'reason', trim(p_reason)));
end $$;

/**
 * The client's targets for a brief or ideation: by client id, else by the client name or code typed on the brief
 * (the same matching the Client Portal uses). Null when the client has none.
 */
create or replace function public.client_sustainability_targets(p_client uuid default null, p_client_text text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := coalesce(p_client, public._client_match(p_client_text)); r public.crm_client_sustainability; c public.sourcing_clients;
begin
  if not public.is_internal() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if v is null then return null; end if;
  select * into r from public.crm_client_sustainability where client_id = v;
  if r.client_id is null then return null; end if;
  select * into c from public.sourcing_clients where id = v;
  return public._crm_cs_json(r) || jsonb_build_object('client_code', c.code, 'client_name', c.name,
    'source_contract_code', (select contract_code from public.crm_contracts where id = r.source_contract_id));
end $$;

revoke execute on function public._crm_cs_json(public.crm_client_sustainability) from public, anon, authenticated;
grant execute on function public.crm_client_set_sustainability(uuid, jsonb, text), public.client_sustainability_targets(uuid, text) to authenticated;
