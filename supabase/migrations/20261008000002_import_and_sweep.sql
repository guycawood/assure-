-- CSV import of existing onboarding trackers, and the daily compliance sweep.

-- ---------------------------------------------------------------------------
-- Bulk import (SRT lead / admin). Rows come from the import page as JSON:
--   [{ "name": "...", "supplier_code": "...", "market": "...", "region": "APAC",
--      "client": "Unilever", "category": "...", "ytd_spend": 184000,
--      "primary_contact_email": "...", "gates": { "msa": "missing", "bank": "verified" } }]
-- Duplicates (same supplier_code, or same name + market) are skipped, never overwritten.
-- ---------------------------------------------------------------------------
create or replace function public.import_suppliers(p_rows jsonb, p_route text default 'standard')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  g record;
  v_id uuid;
  v_created int := 0;
  v_skipped int := 0;
  v_gates int := 0;
  v_skipped_names text[] := '{}';
  v_name text;
  v_code text;
  v_market text;
  v_status text;
begin
  if not (public.is_admin() or public.my_srt_role() = 'lead') then
    raise exception 'Only an SRT lead or admin can import suppliers' using errcode = '42501';
  end if;
  if p_route not in ('standard', 'fast_track') then raise exception 'Unknown onboarding route %', p_route; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Import data must be a list of rows'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Import at most 2,000 suppliers at a time'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(trim(r->>'name'), '');
    if v_name is null then v_skipped := v_skipped + 1; continue; end if;
    v_code := nullif(trim(r->>'supplier_code'), '');
    v_market := nullif(trim(r->>'market'), '');

    if exists (
      select 1 from public.suppliers s
       where (v_code is not null and s.supplier_code = v_code)
          or (lower(s.name) = lower(v_name) and coalesce(lower(s.market), '') = coalesce(lower(v_market), ''))
    ) then
      v_skipped := v_skipped + 1;
      if array_length(v_skipped_names, 1) is null or array_length(v_skipped_names, 1) < 20 then
        v_skipped_names := v_skipped_names || v_name;
      end if;
      continue;
    end if;

    insert into public.suppliers (name, supplier_code, market, region, client, category, ytd_spend,
                                  primary_contact_email, onboarding_route)
    values (
      v_name, v_code, v_market,
      case when r->>'region' in ('APAC','EMEA','Americas','GSC') then r->>'region' end,
      case when r->>'client' in ('Unilever','Heineken','Coloplast','BAU','Other') then r->>'client' end,
      nullif(trim(r->>'category'), ''),
      greatest(coalesce(nullif(r->>'ytd_spend', '')::numeric, 0), 0),
      nullif(lower(trim(r->>'primary_contact_email')), ''),
      p_route
    )
    returning id into v_id;
    v_created := v_created + 1;

    if jsonb_typeof(r->'gates') = 'object' then
      for g in select key, value #>> '{}' as val from jsonb_each(r->'gates') loop
        v_status := g.val;
        continue when v_status not in ('missing','requested','received','verified','not_required');
        continue when v_status = 'missing';
        continue when not exists (select 1 from public.gate_definitions d where d.key = g.key and d.active);
        update public.supplier_gates
           set status = v_status,
               verified_by = case when v_status = 'verified' then auth.uid() end,
               verified_at = case when v_status = 'verified' then now() end,
               note = 'Imported from tracker',
               updated_by = auth.uid(), updated_at = now()
         where supplier_id = v_id and gate_key = g.key;
        insert into public.gate_audit_log (supplier_id, gate_key, from_status, to_status, note, actor)
        values (v_id, g.key, 'missing', v_status, 'Imported from tracker', auth.uid());
        v_gates := v_gates + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'gates_set', v_gates, 'skipped_names', to_jsonb(v_skipped_names));
end $$;

grant execute on function public.import_suppliers(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily sweep: recompute every supplier (expiry and fast-track dates move with
-- time) and raise renewal tickets for certificates expiring soon.
-- Scheduled with pg_cron; an SRT lead or admin can also run it from the dashboard.
-- ---------------------------------------------------------------------------
create or replace function public.srt_daily_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days int;
  v_renewals int;
  v_suppliers int := 0;
  s record;
begin
  -- auth.uid() is null when run by pg_cron; signed-in callers must be lead/admin.
  if auth.uid() is not null and not (public.is_admin() or public.my_srt_role() = 'lead') then
    raise exception 'Only an SRT lead or admin can run the compliance sweep' using errcode = '42501';
  end if;
  select expiry_warning_days into v_days from public.srt_settings where id;

  for s in select id from public.suppliers loop
    perform public.recompute_supplier_compliance(s.id);
    v_suppliers := v_suppliers + 1;
  end loop;

  insert into public.srt_tickets (type, title, supplier_id, gate_key, priority, assignee, due_date, source, client, market, created_by)
  select 'certificate_renewal',
         d.label || ' expires ' || to_char(g.expiry_date, 'DD Mon YYYY') || ': ' || sup.name,
         sup.id, d.key,
         case when d.critical and g.expiry_date - current_date <= 7 then 'high' else 'normal' end,
         sup.srt_owner,
         greatest(g.expiry_date, current_date),
         'cert_expiry', sup.client, sup.market, auth.uid()
    from public.supplier_gates g
    join public.gate_definitions d on d.key = g.gate_key and d.active and d.has_expiry
    join public.suppliers sup on sup.id = g.supplier_id and sup.active
   where g.status in ('verified', 'received')
     and g.expiry_date is not null
     and g.expiry_date <= current_date + v_days
  on conflict do nothing;
  get diagnostics v_renewals = row_count;

  return jsonb_build_object('suppliers_checked', v_suppliers, 'renewal_tickets', v_renewals);
end $$;

grant execute on function public.srt_daily_sweep() to authenticated;

-- Replace the schedule suggested in the first migration with the full sweep:
--   select cron.schedule('srt-daily-sweep', '15 0 * * *', $$ select public.srt_daily_sweep() $$);
