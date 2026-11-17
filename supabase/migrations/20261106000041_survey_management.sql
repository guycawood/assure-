-- Survey management in CRM: reminders to people who have not answered, scheduled sends, and automatic closing.
-- Templates are already governed library records (create, new version, approval, audit); the template editor screen uses those functions.
--   * Reminder: at most two per recipient, the first at least 3 days after the invitation and each at least 5 days after the last. Contacts who
--     have opted out or left since the invitation are skipped, and the reason is kept. Uses the SURVEY-REMINDER email template.
--   * Scheduled send: a draft wave with recipients can be given a date. On that day the platform sends it as the person who scheduled it, so
--     the same recipient checks and the same size-approval rule apply. A schedule is cleared once it has run, whatever the result.
--   * Closing: a sent wave is closed the day after its closing date.

alter table public.crm_survey_waves add column scheduled_for date, add column scheduled_by uuid references public.profiles(id) on delete set null;
alter table public.crm_survey_recipients add column reminders_sent int not null default 0, add column last_reminded_at timestamptz, add column reminder_skipped text;

insert into public.library_records (library_key, code, name, data, status, effective_from)
select 'crm_email_templates', 'SURVEY-REMINDER', 'Customer satisfaction survey reminder',
  '{"subject":"A reminder: how are we doing, {{first_name}}?","body":"Dear {{first_name}},\n\nA short reminder: we sent you our survey for {{client_name}} and your answers have not reached us yet. It takes about ten minutes and goes straight to the team.\n\nTake the survey: {{link}}\n\nThank you,\n{{owner_name}}\n\nNo longer want these emails? {{unsubscribe}}"}'::jsonb,
  'active', date '2026-01-01'
 where not exists (select 1 from public.library_records r where r.library_key = 'crm_email_templates' and r.code = 'SURVEY-REMINDER');

create or replace function public.crm_survey_wave_remind(p_wave uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.crm_survey_waves; r record; t public.library_records; v_vars jsonb; v_block text; v_sent int := 0; v_skipped int := 0; v_early int := 0; v_done int := 0;
begin
  perform public._crm_require();
  select * into w from public.crm_survey_waves where id = p_wave for update;
  if w.id is null then raise exception 'Survey wave not found'; end if;
  if w.status <> 'sent' then raise exception 'Reminders go out for a wave that has been sent and is still open'; end if;
  if w.closes_on is not null and w.closes_on < current_date then raise exception 'This wave has passed its closing date'; end if;
  select * into t from public.library_effective('crm_email_templates', 'SURVEY-REMINDER', current_date);
  for r in select sr.id, sr.token, sr.reminders_sent, sr.sent_at, sr.last_reminded_at, ct as contact, c.name as client_name,
                  coalesce(nullif(p.full_name, ''), p.email, 'Our team') as owner_name
             from public.crm_survey_recipients sr join public.crm_contacts ct on ct.id = sr.contact_id join public.sourcing_clients c on c.id = sr.client_id
             left join public.profiles p on p.id = sr.owner
            where sr.wave_id = p_wave and sr.status in ('sent', 'opened') loop
    if r.reminders_sent >= 2 then v_done := v_done + 1; continue; end if;
    if (r.last_reminded_at is null and r.sent_at > now() - interval '3 days') or (r.last_reminded_at is not null and r.last_reminded_at > now() - interval '5 days') then
      v_early := v_early + 1; continue;
    end if;
    v_block := public.crm_contact_send_block(r.contact);
    if v_block is not null then
      update public.crm_survey_recipients set reminder_skipped = v_block where id = r.id;
      v_skipped := v_skipped + 1; continue;
    end if;
    v_vars := jsonb_build_object('first_name', public._crm_first_name((r.contact).full_name), 'owner_name', r.owner_name, 'client_name', r.client_name,
      'link', '/s/' || r.token, 'unsubscribe', '/u/' || r.token);
    insert into public.email_outbox (to_email, subject, body, link, created_by, source, source_id)
    values ((r.contact).email, public._crm_render(coalesce(t.data->>'subject', 'A reminder: how are we doing?'), v_vars), public._crm_render(coalesce(t.data->>'body', '{{link}}'), v_vars),
            '/s/' || r.token, auth.uid(), 'crm_survey_reminder', r.id);
    update public.crm_survey_recipients set reminders_sent = reminders_sent + 1, last_reminded_at = now(), reminder_skipped = null where id = r.id;
    v_sent := v_sent + 1;
  end loop;
  if v_sent = 0 then
    raise exception 'No reminders to send: % too soon to remind, % already reminded twice, % cannot be emailed', v_early, v_done, v_skipped;
  end if;
  perform public._crm_event(null, 'survey_wave', p_wave::text, 'reminded', jsonb_build_object('sent', v_sent, 'skipped', v_skipped));
  return jsonb_build_object('sent', v_sent, 'too_soon', v_early, 'already_reminded_twice', v_done, 'skipped', v_skipped);
end $$;

create or replace function public.crm_survey_wave_schedule(p_wave uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare w public.crm_survey_waves;
begin
  perform public._crm_require();
  select * into w from public.crm_survey_waves where id = p_wave for update;
  if w.id is null then raise exception 'Survey wave not found'; end if;
  if w.status <> 'draft' then raise exception 'Only a wave that has not been sent can be scheduled'; end if;
  if p_date is null then
    update public.crm_survey_waves set scheduled_for = null, scheduled_by = null where id = p_wave;
    perform public._crm_event(null, 'survey_wave', p_wave::text, 'unscheduled', '{}'::jsonb);
    return;
  end if;
  if p_date < current_date then raise exception 'Choose today or a later date'; end if;
  if w.closes_on is not null and p_date >= w.closes_on then raise exception 'The send date must be before the closing date'; end if;
  if not exists (select 1 from public.crm_survey_recipients where wave_id = p_wave) then raise exception 'Add contacts to the wave before scheduling it'; end if;
  update public.crm_survey_waves set scheduled_for = p_date, scheduled_by = auth.uid() where id = p_wave;
  perform public._crm_event(null, 'survey_wave', p_wave::text, 'scheduled', jsonb_build_object('date', p_date));
end $$;

-- Platform runner: send what is due, close what has ended. Acts as the person who scheduled the send.
create or replace function public.crm_survey_run_due() returns jsonb
language plpgsql security definer set search_path = public as $$
declare w record; v_sent int := 0; v_pending int := 0; v_failed int := 0; v_closed int := 0; v_res text;
begin
  for w in select id, scheduled_by, created_by, name from public.crm_survey_waves where status = 'draft' and scheduled_for is not null and scheduled_for <= current_date loop
    perform set_config('request.jwt.claim.sub', coalesce(w.scheduled_by, w.created_by)::text, true);
    begin
      v_res := public.crm_survey_wave_send(w.id);
      if v_res = 'sent' then v_sent := v_sent + 1; else v_pending := v_pending + 1; end if;
      update public.crm_survey_waves set scheduled_for = null where id = w.id;
      perform public._crm_event(null, 'survey_wave', w.id::text, 'scheduled_send', jsonb_build_object('result', v_res));
    exception when others then
      v_failed := v_failed + 1;
      update public.crm_survey_waves set scheduled_for = null where id = w.id;
      perform public._crm_event(null, 'survey_wave', w.id::text, 'scheduled_send_failed', jsonb_build_object('error', sqlerrm));
      perform public.notify(coalesce(w.scheduled_by, w.created_by), 'crm', 'Scheduled survey did not send: ' || w.name, left(sqlerrm, 200), '/crm/surveys/' || w.id);
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  with c as (update public.crm_survey_waves set status = 'closed' where status = 'sent' and closes_on is not null and closes_on < current_date returning id)
  select count(*) into v_closed from c;
  return jsonb_build_object('sent', v_sent, 'waiting_for_approval', v_pending, 'failed', v_failed, 'closed', v_closed);
end $$;

revoke execute on function public.crm_survey_wave_remind(uuid), public.crm_survey_wave_schedule(uuid, date) from public, anon;
grant execute on function public.crm_survey_wave_remind(uuid), public.crm_survey_wave_schedule(uuid, date) to authenticated;
revoke execute on function public.crm_survey_run_due() from public, anon, authenticated;
