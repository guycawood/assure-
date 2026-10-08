-- Shopper IQ: performance taxonomy, campaign effectiveness and the visual asset library.
-- Taxonomy value sets are Watchtower libraries (touchpoint_types, p2p_stages, defined in 20261009000002); records here
-- reference them by real FK. Spend is what was paid; execution score comes from in-store assessment (0-100, prototype
-- DisplayAssessment composite); uplift is only shown with its source, because it needs data from outside the platform.

create table public.siq_effectiveness (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  region text not null,
  market text not null,
  touchpoint_id uuid not null references public.library_records(id),
  p2p_stage_id uuid references public.library_records(id),
  channel text,
  period_start date,
  period_end date,
  spend numeric not null default 0 check (spend >= 0),
  currency text not null default 'EUR',
  units int check (units is null or units >= 0),
  execution_score numeric check (execution_score is null or execution_score between 0 and 100),
  uplift_pct numeric,
  uplift_source text not null default 'not_measured' check (uplift_source in ('not_measured','client_reported','retailer_data','panel_data')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (uplift_pct is null or uplift_source <> 'not_measured'),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index siq_effectiveness_campaign_idx on public.siq_effectiveness (campaign_id);

create sequence public.siq_asset_no;
create table public.siq_assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique default ('AS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.siq_asset_no')::text, 5, '0')),
  title text not null check (length(trim(title)) > 0),
  asset_type text not null check (asset_type in ('production_art','render_3d','executional_image','playbook')),
  campaign_id uuid references public.campaigns(id) on delete set null,
  brief_id uuid references public.briefs(id) on delete set null,
  region text,
  market text,
  brand text,
  touchpoint_id uuid references public.library_records(id),
  p2p_stage_id uuid references public.library_records(id),
  file_name text,
  file_url text,       -- placeholder until file storage is wired
  metadata jsonb not null default '{}'::jsonb,   -- headline, theme, format, visual_elements ...
  metadata_source text not null default 'manual' check (metadata_source in ('manual','job','ai_extracted')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.siq_effectiveness enable row level security;
alter table public.siq_assets enable row level security;
create policy siq_eff_read on public.siq_effectiveness for select to authenticated using (public.is_internal());
create policy siq_assets_read on public.siq_assets for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.siq_effectiveness, public.siq_assets from authenticated, anon;

create or replace function public._siq_library_id(p_key text, p_value text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if coalesce(trim(p_value), '') = '' then return null; end if;
  select id into v from public.library_records
    where library_key = p_key and status = 'active'
      and (id::text = p_value or code = p_value)
    order by version desc limit 1;
  if v is null then raise exception 'Unknown % value: %', replace(p_key, '_', ' '), p_value; end if;
  return v;
end $$;

create or replace function public.siq_record_effectiveness(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tp uuid; v_st uuid;
begin
  perform public._briefing_require_internal();
  if nullif(p->>'campaign_id', '') is null then raise exception 'Choose a campaign'; end if;
  if coalesce(trim(p->>'region'), '') = '' or coalesce(trim(p->>'market'), '') = '' then raise exception 'Region and market are both required'; end if;
  v_tp := public._siq_library_id('touchpoint_types', p->>'touchpoint');
  if v_tp is null then raise exception 'Choose a touchpoint'; end if;
  v_st := public._siq_library_id('p2p_stages', p->>'p2p_stage');
  insert into public.siq_effectiveness (campaign_id, region, market, touchpoint_id, p2p_stage_id, channel, period_start, period_end,
    spend, currency, units, execution_score, uplift_pct, uplift_source, notes, created_by)
  values ((p->>'campaign_id')::uuid, trim(p->>'region'), upper(trim(p->>'market')), v_tp, v_st, nullif(trim(p->>'channel'), ''),
    nullif(p->>'period_start', '')::date, nullif(p->>'period_end', '')::date, coalesce(nullif(p->>'spend', '')::numeric, 0),
    coalesce(nullif(p->>'currency', ''), 'EUR'), nullif(p->>'units', '')::int, nullif(p->>'execution_score', '')::numeric,
    nullif(p->>'uplift_pct', '')::numeric, coalesce(nullif(p->>'uplift_source', ''), 'not_measured'), nullif(trim(p->>'notes'), ''), auth.uid())
  returning id into v_id;
  insert into public.library_refs (record_id, ref_table, ref_id) values (v_tp, 'siq_effectiveness', v_id::text) on conflict do nothing;
  if v_st is not null then insert into public.library_refs (record_id, ref_table, ref_id) values (v_st, 'siq_effectiveness', v_id::text) on conflict do nothing; end if;
  return v_id;
end $$;

create or replace function public.siq_add_asset(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tp uuid; v_st uuid; c public.campaigns;
begin
  perform public._briefing_require_internal();
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Give the asset a title'; end if;
  v_tp := public._siq_library_id('touchpoint_types', p->>'touchpoint');
  v_st := public._siq_library_id('p2p_stages', p->>'p2p_stage');
  if nullif(p->>'campaign_id', '') is not null then select * into c from public.campaigns where id = (p->>'campaign_id')::uuid; end if;
  insert into public.siq_assets (title, asset_type, campaign_id, brief_id, region, market, brand, touchpoint_id, p2p_stage_id,
    file_name, file_url, metadata, metadata_source, created_by)
  values (trim(p->>'title'), coalesce(nullif(p->>'asset_type', ''), 'executional_image'), c.id, nullif(p->>'brief_id', '')::uuid,
    nullif(trim(p->>'region'), ''), upper(nullif(trim(p->>'market'), '')),
    -- Metadata from the campaign where the person left it blank (applied automatically, like the job codes in the taxonomy deck).
    coalesce(nullif(trim(p->>'brand'), ''), c.brands[1]), v_tp, v_st,
    nullif(trim(p->>'file_name'), ''), nullif(trim(p->>'file_url'), ''), coalesce(p->'metadata', '{}'::jsonb),
    case when c.id is not null and nullif(trim(p->>'brand'), '') is null then 'job' else 'manual' end, auth.uid())
  returning id into v_id;
  if v_tp is not null then insert into public.library_refs (record_id, ref_table, ref_id) values (v_tp, 'siq_assets', v_id::text) on conflict do nothing; end if;
  if v_st is not null then insert into public.library_refs (record_id, ref_table, ref_id) values (v_st, 'siq_assets', v_id::text) on conflict do nothing; end if;
  return v_id;
end $$;

-- Reporting views (security_invoker: the caller's RLS applies). Names come from joins, never stored copies.
create view public.siq_effectiveness_v with (security_invoker = true) as
  select e.*, c.name as campaign_name, c.campaign_code, c.client, c.brands, c.campaign_type, c.activation_objective,
    tp.code as touchpoint_code, tp.name as touchpoint_name, st.code as p2p_stage_code, st.name as p2p_stage_name
  from public.siq_effectiveness e
  join public.campaigns c on c.id = e.campaign_id
  join public.library_records tp on tp.id = e.touchpoint_id
  left join public.library_records st on st.id = e.p2p_stage_id;

create view public.siq_assets_v with (security_invoker = true) as
  select a.*, c.name as campaign_name, c.client, tp.name as touchpoint_name, st.name as p2p_stage_name
  from public.siq_assets a
  left join public.campaigns c on c.id = a.campaign_id
  left join public.library_records tp on tp.id = a.touchpoint_id
  left join public.library_records st on st.id = a.p2p_stage_id;

revoke execute on function public._siq_library_id(text, text) from public, anon, authenticated;
grant execute on function public.siq_record_effectiveness(jsonb), public.siq_add_asset(jsonb) to authenticated;
