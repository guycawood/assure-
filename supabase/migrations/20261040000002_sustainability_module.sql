-- Sustainability becomes its own module (tab, sidebar, About and Watchtower), like SRM or Shopper IQ.
--   * Its libraries move from the master Watchtower to the Sustainability Watchtower. Keys and records are unchanged,
--     so every module that reads them (Sourcing, Logistics) carries on as before.
--   * watchtower_health_sustainability: the standard health rows for the module Watchtower.

update public.library_definitions set module = 'sustainability'
 where key in ('substrates', 'material_emission_factors', 'transport_emission_factors', 'impact_grade_dimensions',
               'conscious_ordering_rules', 'spend_emission_factors');

-- The rule values are not secret; the health view reads them as the signed-in user.
grant execute on function public._cor_rule(text, numeric) to authenticated;

create view public.watchtower_health_sustainability with (security_invoker = true) as
  with l as (select * from public.conscious_ordering_lines()),
  r as (select public._cor_rule('COR-TARGET', 85) as target, public._cor_rule('COR-MIN-ORDERS', 3) as min_orders),
  tot as (
    select coalesce(round(100.0 * sum(l.installed) filter (where l.status = 'reconciled') / nullif(sum(l.ordered) filter (where l.status = 'reconciled'), 0), 1), 0) as util,
           coalesce(round(100.0 * sum(l.ordered) filter (where l.status <> 'untracked') / nullif(sum(l.ordered), 0), 1), 0) as coverage,
           count(*) filter (where l.status = 'reconciled') as reconciled
      from l),
  flagged as (
    select count(*)::numeric as n from (
      select l.brand, l.market from l, r where l.status = 'reconciled'
       group by l.brand, l.market, r.target, r.min_orders
      having count(*) >= r.min_orders and 100.0 * sum(l.installed) / nullif(sum(l.ordered), 0) < r.target) x),
  unlinked as (
    select count(*)::numeric as n from public.library_records s
     where s.library_key = 'substrates' and s.status = 'active'
       and not exists (select 1 from public.library_records f where f.library_key = 'material_emission_factors' and f.status = 'active'
                        and f.code in (s.data->>'virgin_factor_code', s.data->>'recycled_factor_code')))
  select 'sustainability'::text as module, 'ordering_utilisation'::text as metric, 'Installed of ordered (%)'::text as label, tot.util as value, r.target as target,
         case when tot.reconciled = 0 or tot.util >= r.target then 'ok' when tot.util >= r.target - 5 then 'warn' else 'bad' end as status from tot, r
  union all select 'sustainability', 'ordering_evidence', 'Ordered units with install or stock evidence (%)', tot.coverage, 80,
         case when tot.coverage >= 80 then 'ok' when tot.coverage >= 40 then 'warn' else 'bad' end from tot
  union all select 'sustainability', 'over_ordering', 'Brand and market combinations over-ordering', flagged.n, 0, case when flagged.n = 0 then 'ok' else 'warn' end from flagged
  union all select 'sustainability', 'substrates_unlinked', 'Substrates without an emission factor', unlinked.n, 0, case when unlinked.n = 0 then 'ok' else 'warn' end from unlinked;

revoke insert, update, delete on public.watchtower_health_sustainability from authenticated, anon;
