-- Impact Grade rolled up as an average: per supplier (specs on their purchase orders) and per client (specs on their jobs).
-- Staff see every supplier and client. A vendor sees only their own company; a client user only their own client(s).
-- Plain average of the specs that have a grade; "specs" counts every spec in scope, "graded" the ones with a grade.

create or replace function public.impact_grade_by_supplier(p_supplier uuid default null)
returns table (supplier_id uuid, avg_grade numeric, specs int, graded int)
language plpgsql stable security definer set search_path = public as $$
declare v_scope uuid;
begin
  if public.is_internal() then v_scope := p_supplier;
  elsif public.my_supplier_id() is not null then v_scope := public.my_supplier_id();
  else raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  with sp as (
    select distinct po.supplier_id as sid, el.spec_id
      from public.purchase_orders po join public.estimate_lines el on el.estimate_id = po.estimate_id
     where po.supplier_id is not null and (v_scope is null or po.supplier_id = v_scope)
  )
  select sp.sid, round(avg(s.impact_grade), 1), count(*)::int, count(s.impact_grade)::int
    from sp join public.job_specs s on s.id = sp.spec_id
   group by sp.sid;
end $$;

create or replace function public.impact_grade_by_client(p_client uuid default null)
returns table (client_id uuid, avg_grade numeric, specs int, graded int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() and not exists (select 1 from public.my_client_ids()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  select j.client_id, round(avg(s.impact_grade), 1), count(*)::int, count(s.impact_grade)::int
    from public.job_specs s join public.jobs j on j.id = s.job_id
   where j.client_id is not null
     and (p_client is null or j.client_id = p_client)
     and (public.is_internal() or j.client_id in (select public.my_client_ids()))
   group by j.client_id;
end $$;

grant execute on function public.impact_grade_by_supplier(uuid), public.impact_grade_by_client(uuid) to authenticated;
