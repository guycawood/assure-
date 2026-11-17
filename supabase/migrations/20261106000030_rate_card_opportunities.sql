-- Rate card opportunities: where the sourcing team should build the next rate card. It looks at what has actually been bought (priced estimate lines
-- in the last N months) and groups repeat purchases by spec type, material and a clean title, in one currency. A group shows how often it was bought,
-- across how many jobs, clients and vendors, the spend, the price range, and how much of it was already priced from a rate card. Groups that are mostly
-- covered by a rate card, or that were dismissed with a reason, are left out. Starting a request from one carries the evidence into the request.

create table public.rate_card_opportunity_dismissals (
  key text primary key,
  label text not null,
  reason text not null check (length(trim(reason)) >= 3),
  dismissed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  dismissed_at timestamptz not null default now()
);
alter table public.rate_card_opportunity_dismissals enable row level security;
create policy rcod_read on public.rate_card_opportunity_dismissals for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.rate_card_opportunity_dismissals from authenticated, anon;

create or replace function public.rate_card_opportunities(p_months int default 12, p_min_orders int default 3, p_search text default null, p_include_dismissed boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_internal() then raise exception 'Only internal staff can see rate card opportunities' using errcode = '42501'; end if;
  if p_months is null or p_months < 1 or p_months > 60 then raise exception 'Choose between 1 and 60 months'; end if;
  with lines as (
    select s.spec_type, s.substrate_id,
           coalesce(nullif(trim(regexp_replace(regexp_replace(lower(trim(s.title)), '\([^)]*\)|\S*[0-9]\S*', '', 'g'), '\s+', ' ', 'g')), ''), '(untitled)') as tkey,
           s.title, el.estimate_id, e.job_id, j.client_id, e.supplier_id, el.quantity, el.unit_cost, el.line_cost, e.created_at, e.benchmark_source = 'rate_card' as via_card, e.currency
      from public.estimate_lines el
      join public.estimates e on e.id = el.estimate_id
      join public.job_specs s on s.id = el.spec_id
      join public.jobs j on j.id = e.job_id
     where e.status <> 'declined' and el.unit_cost > 0 and e.created_at >= now() - make_interval(months => p_months)
  ), g as (
    select spec_type, substrate_id, tkey, currency, min(title) as example,
           count(distinct estimate_id) as orders, count(distinct job_id) as jobs, count(distinct client_id) as clients, count(distinct supplier_id) as suppliers,
           sum(quantity) as qty, min(quantity) as qty_min, max(quantity) as qty_max, round(sum(line_cost), 2) as spend,
           round(avg(unit_cost), 4) as avg_cost, min(unit_cost) as min_cost, max(unit_cost) as max_cost, max(created_at) as last_at,
           count(*) filter (where via_card) as card_lines, count(*) as lines
      from lines group by spec_type, substrate_id, tkey, currency
  ), k as (
    select g.*, g.spec_type || '|' || coalesce(g.substrate_id::text, '') || '|' || g.tkey || '|' || g.currency as key from g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', k.key, 'example', k.example, 'title_key', k.tkey, 'spec_type', k.spec_type, 'substrate', sub.name, 'substrate_code', sub.code, 'currency', k.currency,
      'orders', k.orders, 'jobs', k.jobs, 'clients', k.clients, 'suppliers', k.suppliers, 'qty', k.qty, 'qty_min', k.qty_min, 'qty_max', k.qty_max, 'spend', k.spend,
      'avg_cost', k.avg_cost, 'min_cost', k.min_cost, 'max_cost', k.max_cost,
      'spread_pct', round((k.max_cost - k.min_cost) / nullif(k.min_cost, 0) * 100, 1), 'last_at', k.last_at,
      'card_share_pct', round(k.card_lines::numeric / k.lines * 100, 0),
      'open_request', exists (select 1 from public.rate_card_requests r where r.status in ('requested', 'taken', 'pricing', 'drafted') and lower(r.title) like '%' || k.tkey || '%' and k.tkey <> '(untitled)'),
      'dismissed', d.key is not null, 'dismissed_reason', d.reason
    ) order by k.spend desc), '[]'::jsonb) into v_out
    from k
    left join public.library_records sub on sub.id = k.substrate_id
    left join public.rate_card_opportunity_dismissals d on d.key = k.key
   where k.orders >= coalesce(p_min_orders, 1)
     and k.card_lines::numeric / k.lines < 0.8
     and (p_include_dismissed or d.key is null)
     and (nullif(trim(p_search), '') is null or lower(k.example || ' ' || k.tkey || ' ' || coalesce(sub.name, '')) like '%' || lower(trim(p_search)) || '%');
  return v_out;
end $$;

create or replace function public.rate_card_opportunity_dismiss(p_key text, p_label text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._sourcing_team() then raise exception 'Only the sourcing team can dismiss an opportunity' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Say why this is not worth a rate card'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'Opportunity not found'; end if;
  insert into public.rate_card_opportunity_dismissals (key, label, reason) values (p_key, left(coalesce(p_label, p_key), 200), trim(p_reason))
  on conflict (key) do update set reason = excluded.reason, dismissed_by = auth.uid(), dismissed_at = now();
end $$;

create or replace function public.rate_card_opportunity_restore(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._sourcing_team() then raise exception 'Only the sourcing team can restore an opportunity' using errcode = '42501'; end if;
  delete from public.rate_card_opportunity_dismissals where key = p_key;
end $$;

revoke execute on function public.rate_card_opportunities(int, int, text, boolean), public.rate_card_opportunity_dismiss(text, text, text), public.rate_card_opportunity_restore(text) from public, anon;
grant execute on function public.rate_card_opportunities(int, int, text, boolean), public.rate_card_opportunity_dismiss(text, text, text), public.rate_card_opportunity_restore(text) to authenticated;
