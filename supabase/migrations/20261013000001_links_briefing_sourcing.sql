-- Links between standalone modules: Briefing+ → Sourcing+.
-- Real foreign keys now that both modules exist, and one function that turns a brief hand-off into a job.

alter table public.jobs add constraint jobs_brief_fk foreign key (brief_id) references public.briefs(id) on delete set null;
alter table public.job_specs add constraint job_specs_brief_fk foreign key (brief_id) references public.briefs(id) on delete set null;
alter table public.briefs add constraint briefs_resulting_job_fk foreign key (resulting_job_id) references public.jobs(id) on delete set null;
alter table public.brief_handoffs add constraint brief_handoffs_job_fk foreign key (job_id) references public.jobs(id) on delete set null;

-- Accept a pending hand-off into a new job (client chosen by the buyer). Region, market, brand and title come from the brief.
create or replace function public.job_create_from_handoff(p_handoff uuid, p_client uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare h public.brief_handoffs; b public.briefs; v_job uuid;
begin
  if not public.is_internal() then raise exception 'Internal users only' using errcode = '42501'; end if;
  select * into h from public.brief_handoffs where id = p_handoff for update;
  if h.id is null then raise exception 'Hand-off not found'; end if;
  if h.status <> 'pending' then raise exception 'This hand-off has already been accepted'; end if;
  select * into b from public.briefs where id = h.brief_id;
  insert into public.jobs (title, client_id, region, market, brief_id, brand, campaign_name, currency, target_delivery_date, notes)
  values (coalesce(nullif(h.payload->'concept'->>'name', ''), b.title), p_client,
          coalesce(b.region, 'EMEA'), coalesce(b.market, 'Unknown'), b.id, b.brand, b.title, coalesce(b.currency, 'EUR'), b.target_launch,
          'From Briefing+ ' || coalesce(b.brief_code, '') || ': ' || coalesce(h.payload->'concept'->>'creative_direction', ''))
  returning id into v_job;
  update public.brief_handoffs set job_id = v_job where id = h.id;
  perform public.brief_handoff_accept(h.id, v_job);
  return v_job;
end $$;
grant execute on function public.job_create_from_handoff(uuid, uuid) to authenticated;
