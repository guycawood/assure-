-- Briefing aligned to the Global Business Transformation "Client brief intake and validation" process (Target):
--   b2  the client sets the brief type: artworking, creative ideation, product brief (one or several)
--   b4  "creative input needed?" is decided by the account team; b5 the project manager reviews the brief with operational creative
--   b7  "brief clear and complete?" (timings, services, logistics, sustainability); b6 if not, the brief goes back to the client
--       with the reason, a client meeting if needed, and the client resubmits
-- The approval step cannot pass while a brief that needs creative input has not had its creative review.

alter table public.briefs
  add column if not exists brief_types text[] not null default '{}',
  add column if not exists creative_needed boolean,
  add column if not exists creative_route text check (creative_route is null or creative_route in ('internal', 'supplier')),
  add column if not exists creative_decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists creative_decided_at timestamptz,
  add column if not exists creative_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists creative_reviewed_at timestamptz,
  add column if not exists creative_review_note text,
  add column if not exists returned_reason text,
  add column if not exists returned_by uuid references public.profiles(id) on delete set null,
  add column if not exists returned_at timestamptz,
  add column if not exists meeting_requested boolean not null default false;

alter table public.briefs drop constraint if exists briefs_brief_types_check;
alter table public.briefs add constraint briefs_brief_types_check check (brief_types <@ array['artworking', 'creative_ideation', 'product_brief']::text[]);

alter table public.briefs drop constraint if exists briefs_status_check;
alter table public.briefs add constraint briefs_status_check
  check (status in ('draft', 'submitted', 'with_client', 'in_ideation', 'spec_created', 'archived'));

-- b2 / b4: brief types and the creative decision. Author or an admin, while the brief can still be edited.
create or replace function public.brief_set_process(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_types text[]; v_needed boolean; v_route text;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_id for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.status not in ('draft', 'submitted', 'with_client', 'in_ideation') then raise exception 'A % brief can no longer be edited', replace(b.status, '_', ' '); end if;
  if b.created_by is distinct from auth.uid() and not public.is_admin() then raise exception 'Only the author (or an admin) can change this brief' using errcode = '42501'; end if;
  if p ? 'brief_types' then
    v_types := public._text_array(p->'brief_types');
    if not (v_types <@ array['artworking', 'creative_ideation', 'product_brief']::text[]) then raise exception 'Unknown brief type'; end if;
    update public.briefs set brief_types = v_types, updated_at = now() where id = p_id;
  end if;
  if p ? 'creative_needed' then
    v_needed := nullif(p->>'creative_needed', '')::boolean;
    v_route := nullif(p->>'creative_route', '');
    if v_needed is true and v_route is null then raise exception 'Say whether creative is done by a supplier or the internal creative team'; end if;
    if v_route is not null and v_route not in ('internal', 'supplier') then raise exception 'Unknown creative route'; end if;
    update public.briefs set creative_needed = v_needed, creative_route = case when v_needed then v_route else null end,
      creative_decided_by = auth.uid(), creative_decided_at = now(),
      -- changing the decision clears an earlier creative review
      creative_reviewed_by = case when v_needed is true then creative_reviewed_by else null end,
      creative_reviewed_at = case when v_needed is true then creative_reviewed_at else null end,
      updated_at = now() where id = p_id;
    perform public._brief_event(p_id, 'creative_decision', b.status, b.status,
      case when v_needed then 'Creative input needed (' || v_route || ')' else 'No creative input needed' end);
  end if;
end $$;
grant execute on function public.brief_set_process(uuid, jsonb) to authenticated;

-- b5: the project manager reviews the brief with operational creative. Anyone internal except the person who decided creative is needed
-- is not required; the check is that the review happened and who did it.
create or replace function public.brief_creative_review(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_id for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.creative_needed is not true then raise exception 'This brief is not marked as needing creative input'; end if;
  if b.status not in ('draft', 'submitted', 'with_client', 'in_ideation') then raise exception 'A % brief can no longer be reviewed', replace(b.status, '_', ' '); end if;
  update public.briefs set creative_reviewed_by = auth.uid(), creative_reviewed_at = now(), creative_review_note = nullif(trim(p_note), ''), updated_at = now() where id = p_id;
  perform public._brief_event(p_id, 'creative_reviewed', b.status, b.status, nullif(trim(p_note), ''));
end $$;
grant execute on function public.brief_creative_review(uuid, text) to authenticated;

-- b6: send the brief back to the client with the reason; optionally ask for a client meeting.
create or replace function public.brief_send_back(p_id uuid, p_reason text, p_meeting boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_id for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.status not in ('draft', 'submitted') then raise exception 'Only a draft or submitted brief can be sent back to the client'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Tell the client what is missing or unclear'; end if;
  update public.briefs set status = 'with_client', approval_status = null, returned_reason = trim(p_reason), returned_by = auth.uid(), returned_at = now(),
    meeting_requested = coalesce(p_meeting, false), updated_at = now() where id = p_id;
  perform public._brief_event(p_id, 'sent_back_to_client', b.status, 'with_client', trim(p_reason) || case when p_meeting then ' (client meeting requested)' else '' end);
  if b.created_by is not null and b.created_by is distinct from auth.uid() then
    perform public.notify(b.created_by, 'briefing', 'Brief sent back to the client: ' || b.brief_code, left(trim(p_reason), 140), '/briefing/' || b.id);
  end if;
end $$;
grant execute on function public.brief_send_back(uuid, text, boolean) to authenticated;

-- The client answers and resubmits: the brief goes back to submitted and through the completeness check and approval again.
create or replace function public.client_brief_resubmit(p_brief uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_client uuid; v_name text;
begin
  select * into b from public.briefs where id = p_brief for update;
  if b.id is null then raise exception 'Brief not found' using errcode = '42501'; end if;
  v_client := coalesce(b.client_id, (select client_id from public.campaigns where id = b.campaign_id));
  if v_client is null then raise exception 'Brief not found' using errcode = '42501'; end if;
  perform public._client_actor(v_client);
  if b.status <> 'with_client' then raise exception 'This brief is not waiting for you'; end if;
  if length(coalesce(p_note, '')) > 4000 then raise exception 'Keep the note under 4,000 characters'; end if;
  if coalesce(trim(p_note), '') <> '' then
    insert into public.client_comments (brief_id, client_id, body, author) values (b.id, v_client, trim(p_note), auth.uid());
  end if;
  update public.briefs set status = 'submitted', approval_status = 'pending', submitted_at = now(), updated_at = now() where id = p_brief;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
  perform public._brief_event(p_brief, 'client_resubmitted', 'with_client', 'submitted', nullif(trim(p_note), ''));
  perform public.notify(b.created_by, 'briefing', format('%s resubmitted %s', v_name, b.brief_code), left(coalesce(nullif(trim(p_note), ''), 'Resubmitted by the client.'), 140), '/briefing/' || b.id);
end $$;
grant execute on function public.client_brief_resubmit(uuid, text) to authenticated;

-- Approval cannot pass while creative input is needed and the creative review has not happened (b5 before b7/b8).
create or replace function public.brief_decide(p_id uuid, p_decision text, p_comments text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_to text; pol record;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_id for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.status <> 'submitted' or b.approval_status is distinct from 'pending' then raise exception 'This brief is not waiting for approval'; end if;
  if b.created_by = auth.uid() then raise exception 'You cannot approve your own brief: another team member must review it' using errcode = '42501'; end if;
  select * into pol from public._approval_policy('BRIEF', b.client_id, b.market, b.budget_high);
  if pol.approver_role is not null and not public.approval_has_role(pol.approver_role, 'briefing') then
    raise exception 'This brief needs a % to decide it (approval policy %)', lower(public.approval_role_label(pol.approver_role)), pol.code using errcode = '42501';
  end if;
  if p_decision not in ('approved','changes_requested') then raise exception 'Choose approve or request changes'; end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_comments), '') = '' then raise exception 'Say what needs to change'; end if;
  if p_decision = 'approved' and b.creative_needed is true and b.creative_reviewed_at is null then
    raise exception 'This brief needs creative input: the creative review has to be done before it is approved';
  end if;
  v_to := case when p_decision = 'approved' then 'in_ideation' else 'draft' end;
  update public.briefs set status = v_to, approval_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
    approval_comments = nullif(trim(p_comments), ''), updated_at = now() where id = p_id;
  insert into public.brief_approvals (brief_id, decision, comments, decided_by) values (p_id, p_decision, nullif(trim(p_comments), ''), auth.uid());
  perform public._brief_event(p_id, p_decision, 'submitted', v_to, nullif(trim(p_comments), ''));
  perform public.notify(b.created_by, 'briefing', case when p_decision = 'approved' then 'Brief approved: ' else 'Changes requested: ' end || b.brief_code,
    nullif(trim(p_comments), ''), '/briefing/' || b.id);
end $$;

-- The client sees the new lifecycle events, and why the brief came back to them.
create or replace function public.client_portal_brief(p_brief uuid, p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := public._client_scope(p_client); b public.briefs;
begin
  if p_brief not in (select public._client_brief_ids(v)) then return null; end if;
  select * into b from public.briefs where id = p_brief;
  return public._client_brief_row(b) || jsonb_build_object(
    'objective', b.objective, 'brief_text', b.brief_text, 'target_outlets', b.target_outlets, 'product_category', b.product_category,
    'sustainability_targets', b.sustainability_targets, 'min_recycled_pct', b.min_recycled_pct, 'require_fsc', b.require_fsc,
    'client_id', coalesce(b.client_id, (select client_id from public.campaigns where id = b.campaign_id)),
    'returned_reason', case when b.status = 'with_client' then b.returned_reason end,
    'meeting_requested', case when b.status = 'with_client' then b.meeting_requested end,
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'to_status', e.to_status, 'at', e.at) order by e.at), '[]'::jsonb)
                   from public.brief_events e where e.brief_id = b.id
                    and e.event in ('submitted','approved','changes_requested','archived','handoff_created','spec_created','sent_back_to_client','client_resubmitted')),
    'comments', public._client_comment_rows(b.id));
end $$;