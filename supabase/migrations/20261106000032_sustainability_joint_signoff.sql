-- Sustainability team and joint sign-offs (the vendor management deck, slides 11 to 13).
--   Role     a Sustainability team level in SRM: procurement-level visibility, ESG and compliance review, joint sign-off; strategic tools and
--            libraries are view only; no commercial approvals and no user administration.
--   Joint    one approval with two required signatures: a procurement director (CPO or Regional Procurement Director) and the Sustainability
--            team, different people. Either side can reject, with a reason. Both approvers and timestamps are kept.
--   ESG      Sustainability or procurement leadership raises a concern against a vendor, linked to a job or document; deciding it (clear,
--            accept with conditions, escalate) needs a joint approval.
--   Onboarding release can require a joint approval. It is a governed setting, off until the team is staffed.
-- Form-change sign-off (deck slide 18) is not built here: it needs versioned onboarding forms first.

insert into public.division_capabilities (key, label, description, sort) values
  ('strategic_tools_view', 'View strategic tools', 'See scenarios and strategic analysis without changing them.', 65),
  ('libraries_view',       'View libraries and methodologies', 'See the division''s libraries and methodologies without changing them.', 85),
  ('esg_review',           'Review ESG and compliance', 'Review vendor evidence and raise ESG or compliance concerns, linked to the vendor and any job or document.', 90),
  ('joint_approve',        'Sign joint approvals', 'Sign one side of a joint approval: onboarding, ESG decisions and form changes.', 95);

insert into public.division_roles (module, key, label, rank, description, capabilities) values
  ('assure', 'sustainability', 'Sustainability team', 6,
   'Procurement-level visibility with ESG and compliance review. Co-approves onboarding and ESG decisions with procurement. Strategic tools and libraries are view only. No commercial approvals or user administration.',
   '{vendor_performance,vendor_payment_status,see_money,strategic_tools_view,libraries_view,esg_review,joint_approve}');
update public.division_roles set capabilities = capabilities || '{esg_review,joint_approve}' where module = 'assure' and key in ('cpo', 'regional_procurement_director');

-- The capability check, now with the new capabilities. People with no assignment keep their older SRM role: a procurement director signs the procurement side.
create or replace function public.division_can(p_module text, p_capability text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_key text; v_caps text[]; v_legacy text;
begin
  if public.is_admin() then return true; end if;
  if not public.is_internal() then return false; end if;
  v_key := public._division_role_key(auth.uid(), p_module);
  if v_key is not null then
    select capabilities into v_caps from public.division_roles where module = p_module and key = v_key;
    return coalesce(p_capability = any (v_caps), false);
  end if;
  v_legacy := coalesce(public.my_srt_role(), '');
  return case p_capability
    when 'vendor_performance' then true
    when 'vendor_payment_status' then true
    when 'see_money' then v_legacy in ('lead', 'finance', 'procurement', 'head', 'director')
                          or coalesce((select is_lead or is_finance from public.sourcing_user_access where user_id = auth.uid()), false)
    when 'approve_exceptions' then v_legacy in ('lead', 'procurement', 'head', 'director')
    when 'approve_regional' then v_legacy in ('head', 'director')
    when 'strategic_tools' then v_legacy in ('head', 'director')
    when 'strategic_tools_view' then v_legacy in ('head', 'director')
    when 'joint_approve' then v_legacy = 'director'
    when 'esg_review' then v_legacy = 'director'
    when 'manage_users' then public.can_govern(p_module)
    when 'manage_libraries' then public.can_govern(p_module)
    when 'libraries_view' then public.can_govern(p_module)
    else false end;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Governed settings per division
-- ---------------------------------------------------------------------------------------------------------------------
create table public.division_settings (
  module text not null,
  key text not null,
  value jsonb not null,
  reason text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (module, key)
);
alter table public.division_settings enable row level security;
create policy ds_read on public.division_settings for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.division_settings from authenticated, anon;

create or replace function public.division_setting(p_module text, p_key text, p_default jsonb default 'null'::jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.division_settings where module = p_module and key = p_key), p_default);
$$;
revoke execute on function public.division_setting(text, text, jsonb) from public, anon;
grant execute on function public.division_setting(text, text, jsonb) to authenticated;

create or replace function public.division_setting_set(p_module text, p_key text, p_value jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only staff can change settings' using errcode = '42501'; end if;
  if not (public.can_govern(p_module) or public.division_can(p_module, 'manage_libraries')) then raise exception 'Only the division''s owners can change its settings' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Say why you are changing this'; end if;
  insert into public.division_settings (module, key, value, reason, updated_by) values (p_module, p_key, p_value, trim(p_reason), auth.uid())
  on conflict (module, key) do update set value = excluded.value, reason = excluded.reason, updated_by = auth.uid(), updated_at = now();
  insert into public.division_role_events (module, action, note) values (p_module, 'changed', 'Setting ' || p_key || ' set to ' || p_value::text || ': ' || trim(p_reason));
end $$;
revoke execute on function public.division_setting_set(text, text, jsonb, text) from public, anon;
grant execute on function public.division_setting_set(text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Joint approvals
-- ---------------------------------------------------------------------------------------------------------------------
create table public.joint_approvals (
  id uuid primary key default gen_random_uuid(),
  module text not null default 'assure',
  subject_type text not null check (subject_type in ('onboarding', 'esg_decision', 'form_change')),
  subject_id uuid not null,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  summary text not null check (length(trim(summary)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  requested_at timestamptz not null default now(),
  proc_by uuid references public.profiles(id) on delete set null, proc_at timestamptz, proc_note text,
  sust_by uuid references public.profiles(id) on delete set null, sust_at timestamptz, sust_note text,
  rejected_side text check (rejected_side in ('procurement', 'sustainability')),
  rejected_by uuid references public.profiles(id) on delete set null, rejected_at timestamptz, reject_reason text,
  decided_at timestamptz
);
create unique index joint_approvals_one_open on public.joint_approvals (subject_type, subject_id) where status = 'pending';
create index joint_approvals_supplier_idx on public.joint_approvals (supplier_id, requested_at desc);
create table public.joint_approval_events (
  id bigint generated always as identity primary key,
  approval_id uuid not null references public.joint_approvals(id) on delete cascade,
  event text not null,
  side text,
  note text,
  actor uuid references public.profiles(id) on delete set null default auth.uid(),
  at timestamptz not null default now()
);
alter table public.joint_approvals enable row level security;
alter table public.joint_approval_events enable row level security;
create policy ja_read on public.joint_approvals for select to authenticated using (public.is_internal());
create policy jae_read on public.joint_approval_events for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.joint_approvals, public.joint_approval_events from authenticated, anon;

-- Which side of a joint approval the caller signs: procurement for a CPO, Regional Procurement Director, a director on the older roles, or an admin;
-- sustainability for the Sustainability team. Anyone else signs nothing.
create or replace function public._joint_side() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_key text;
begin
  if not public.is_internal() then return null; end if;
  v_key := public._division_role_key(auth.uid(), 'assure');
  if v_key = 'sustainability' then return 'sustainability'; end if;
  if v_key in ('cpo', 'regional_procurement_director') then return 'procurement'; end if;
  if v_key is not null then return null; end if;
  if public.is_admin() or coalesce(public.my_srt_role(), '') = 'director' then return 'procurement'; end if;
  return null;
end $$;
revoke execute on function public._joint_side() from public, anon, authenticated;

create or replace function public._joint_notify(p_approval uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  for u in select distinct id from (
      select user_id as id from public.division_role_users where module = 'assure' and role_key in ('cpo', 'regional_procurement_director', 'sustainability')
      union select id from public.profiles where srt_role = 'director'
    ) x where id is not null loop
    perform public.notify(u.id, 'assure', p_title, p_body, '/assure/esg?tab=approvals');
  end loop;
end $$;
revoke execute on function public._joint_notify(uuid, text, text) from public, anon, authenticated;

create or replace function public.joint_approval_request(p_type text, p_subject uuid, p_summary text, p_supplier uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._assure_require_internal();
  if p_type not in ('onboarding', 'esg_decision', 'form_change') then raise exception 'Unknown kind of approval'; end if;
  if coalesce(trim(p_summary), '') = '' then raise exception 'Say what is being approved'; end if;
  if p_type = 'onboarding' and not exists (select 1 from public.suppliers where id = p_subject) then raise exception 'Supplier not found'; end if;
  if exists (select 1 from public.joint_approvals where subject_type = p_type and subject_id = p_subject and status = 'pending') then raise exception 'This is already waiting for approval'; end if;
  insert into public.joint_approvals (subject_type, subject_id, supplier_id, summary) values (p_type, p_subject, coalesce(p_supplier, case when p_type = 'onboarding' then p_subject end), trim(p_summary)) returning id into v_id;
  insert into public.joint_approval_events (approval_id, event, note) values (v_id, 'requested', trim(p_summary));
  perform public._joint_notify(v_id, 'Joint approval needed', left(trim(p_summary), 140));
  return v_id;
end $$;

create or replace function public.joint_approval_sign(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare a public.joint_approvals; v_side text := public._joint_side();
begin
  if v_side is null or not public.division_can('assure', 'joint_approve') then raise exception 'Only a procurement director or the Sustainability team can sign a joint approval' using errcode = '42501'; end if;
  select * into a from public.joint_approvals where id = p_id for update;
  if a.id is null then raise exception 'Approval not found'; end if;
  if a.status <> 'pending' then raise exception 'This approval is already %', a.status; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if v_side = 'procurement' and a.proc_by is not null then raise exception 'Procurement has already signed this'; end if;
  if v_side = 'sustainability' and a.sust_by is not null then raise exception 'Sustainability has already signed this'; end if;
  if not p_approve then
    if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say why you are rejecting it'; end if;
    update public.joint_approvals set status = 'rejected', rejected_side = v_side, rejected_by = auth.uid(), rejected_at = now(), reject_reason = trim(p_note), decided_at = now() where id = p_id;
    insert into public.joint_approval_events (approval_id, event, side, note) values (p_id, 'rejected', v_side, trim(p_note));
    perform public.notify(a.requested_by, 'assure', 'Joint approval rejected', left(trim(p_note), 140), '/assure/esg?tab=approvals');
    return 'rejected';
  end if;
  if v_side = 'procurement' then update public.joint_approvals set proc_by = auth.uid(), proc_at = now(), proc_note = nullif(trim(p_note), '') where id = p_id;
  else update public.joint_approvals set sust_by = auth.uid(), sust_at = now(), sust_note = nullif(trim(p_note), '') where id = p_id; end if;
  insert into public.joint_approval_events (approval_id, event, side, note) values (p_id, 'signed', v_side, nullif(trim(p_note), ''));
  select * into a from public.joint_approvals where id = p_id;
  if a.proc_by is not null and a.sust_by is not null then
    update public.joint_approvals set status = 'approved', decided_at = now() where id = p_id;
    insert into public.joint_approval_events (approval_id, event, note) values (p_id, 'approved', 'Both sides have signed');
    perform public.notify(a.requested_by, 'assure', 'Joint approval granted', left(a.summary, 140), '/assure/esg?tab=approvals');
    return 'approved';
  end if;
  return 'signed';
end $$;

create or replace function public.joint_approval_withdraw(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.joint_approvals;
begin
  select * into a from public.joint_approvals where id = p_id for update;
  if a.id is null or a.status <> 'pending' then raise exception 'Nothing to withdraw'; end if;
  if a.requested_by is distinct from auth.uid() and not public.is_admin() then raise exception 'Only the person who asked, or an admin, can withdraw it' using errcode = '42501'; end if;
  update public.joint_approvals set status = 'withdrawn', decided_at = now() where id = p_id;
  insert into public.joint_approval_events (approval_id, event, note) values (p_id, 'withdrawn', nullif(trim(p_note), ''));
end $$;

create or replace function public.joint_approval_is_approved(p_type text, p_subject uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.joint_approvals where subject_type = p_type and subject_id = p_subject and status = 'approved');
$$;

create or replace function public.joint_approvals_list(p_status text default null, p_supplier uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb; v_side text := public._joint_side();
begin
  perform public._assure_require_internal();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'subject_type', a.subject_type, 'subject_id', a.subject_id, 'supplier_id', a.supplier_id, 'supplier_name', s.name, 'summary', a.summary, 'status', a.status,
      'requested_at', a.requested_at, 'requested_by', rq.full_name,
      'proc_by', pb.full_name, 'proc_at', a.proc_at, 'proc_note', a.proc_note, 'sust_by', sb.full_name, 'sust_at', a.sust_at, 'sust_note', a.sust_note,
      'rejected_side', a.rejected_side, 'reject_reason', a.reject_reason, 'decided_at', a.decided_at,
      'my_side', v_side, 'can_sign', a.status = 'pending' and v_side is not null and public.division_can('assure', 'joint_approve')
                                     and ((v_side = 'procurement' and a.proc_by is null) or (v_side = 'sustainability' and a.sust_by is null))
    ) order by (a.status = 'pending') desc, a.requested_at desc), '[]'::jsonb) into v_out
    from public.joint_approvals a
    left join public.suppliers s on s.id = a.supplier_id
    left join public.profiles rq on rq.id = a.requested_by left join public.profiles pb on pb.id = a.proc_by left join public.profiles sb on sb.id = a.sust_by
   where (p_status is null or a.status = p_status) and (p_supplier is null or a.supplier_id = p_supplier);
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- ESG and compliance concerns, linked to a vendor and optionally a job or document; deciding one needs a joint approval.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.vendor_esg_flags (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  document_id uuid references public.supplier_documents(id) on delete set null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  summary text not null check (length(trim(summary)) > 0),
  detail text,
  status text not null default 'open' check (status in ('open', 'decision_pending', 'cleared', 'accepted', 'escalated')),
  raised_by uuid references public.profiles(id) on delete set null default auth.uid(),
  raised_at timestamptz not null default now(),
  proposed_decision text check (proposed_decision in ('clear', 'accept', 'escalate')),
  decision_note text,
  joint_approval_id uuid references public.joint_approvals(id) on delete set null,
  decided_at timestamptz
);
create index vendor_esg_flags_supplier_idx on public.vendor_esg_flags (supplier_id, raised_at desc);
alter table public.vendor_esg_flags enable row level security;
create policy esg_read on public.vendor_esg_flags for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.vendor_esg_flags from authenticated, anon;

create or replace function public.esg_flag_raise(p_supplier uuid, p_severity text, p_summary text, p_detail text default null, p_job uuid default null, p_document uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; s public.suppliers; v_name text;
begin
  perform public._assure_require_internal();
  if not public.division_can('assure', 'esg_review') then raise exception 'Only the Sustainability team or procurement leadership can raise an ESG concern' using errcode = '42501'; end if;
  select * into s from public.suppliers where id = p_supplier;
  if s.id is null then raise exception 'Supplier not found'; end if;
  if coalesce(trim(p_summary), '') = '' then raise exception 'Say what the concern is'; end if;
  if p_severity not in ('low', 'medium', 'high') then raise exception 'Choose low, medium or high'; end if;
  if p_job is not null and not exists (select 1 from public.jobs where id = p_job) then raise exception 'Job not found'; end if;
  if p_document is not null and not exists (select 1 from public.supplier_documents where id = p_document and supplier_id = p_supplier) then raise exception 'That document is not on this vendor'; end if;
  insert into public.vendor_esg_flags (supplier_id, job_id, document_id, severity, summary, detail) values (p_supplier, p_job, p_document, p_severity, trim(p_summary), nullif(trim(p_detail), ''))
  returning id into v_id;
  perform public.notify(s.procurement_owner, 'assure', 'ESG concern on ' || s.name, left(trim(p_summary), 140), '/assure/esg?tab=flags');
  perform public.notify(s.srt_owner, 'assure', 'ESG concern on ' || s.name, left(trim(p_summary), 140), '/assure/esg?tab=flags');
  return v_id;
end $$;

-- Propose how a concern is settled: clear it, accept it with conditions, or escalate. It takes effect once both sides sign.
create or replace function public.esg_flag_propose_decision(p_flag uuid, p_decision text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare f public.vendor_esg_flags; v_id uuid; v_name text;
begin
  perform public._assure_require_internal();
  if not public.division_can('assure', 'esg_review') then raise exception 'Only the Sustainability team or procurement leadership can propose an ESG decision' using errcode = '42501'; end if;
  select * into f from public.vendor_esg_flags where id = p_flag for update;
  if f.id is null then raise exception 'Concern not found'; end if;
  if f.status <> 'open' then raise exception 'This concern is %', replace(f.status, '_', ' '); end if;
  if p_decision not in ('clear', 'accept', 'escalate') then raise exception 'Choose clear, accept or escalate'; end if;
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say why'; end if;
  select name into v_name from public.suppliers where id = f.supplier_id;
  v_id := public.joint_approval_request('esg_decision', f.id, 'ESG decision on ' || v_name || ': ' || p_decision || '. ' || f.summary, f.supplier_id);
  update public.vendor_esg_flags set status = 'decision_pending', proposed_decision = p_decision, decision_note = trim(p_note), joint_approval_id = v_id where id = p_flag;
  return v_id;
end $$;

-- Apply the outcome of a joint approval to what it was about.
create or replace function public.trg_joint_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.subject_type = 'esg_decision' and new.status is distinct from old.status then
    if new.status = 'approved' then
      update public.vendor_esg_flags set status = case proposed_decision when 'clear' then 'cleared' when 'accept' then 'accepted' else 'escalated' end, decided_at = now() where id = new.subject_id;
    elsif new.status in ('rejected', 'withdrawn') then
      update public.vendor_esg_flags set status = 'open', proposed_decision = null, joint_approval_id = null where id = new.subject_id and status = 'decision_pending';
    end if;
  end if;
  return new;
end $$;
create trigger joint_apply after update of status on public.joint_approvals for each row execute function public.trg_joint_apply();

create or replace function public.esg_flags_list(p_supplier uuid default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  perform public._assure_require_internal();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'supplier_id', f.supplier_id, 'supplier_name', s.name, 'job_id', f.job_id, 'job_number', j.job_number, 'document_id', f.document_id, 'document_title', d.title,
      'severity', f.severity, 'summary', f.summary, 'detail', f.detail, 'status', f.status, 'raised_by', p.full_name, 'raised_at', f.raised_at,
      'proposed_decision', f.proposed_decision, 'decision_note', f.decision_note, 'joint_approval_id', f.joint_approval_id, 'decided_at', f.decided_at
    ) order by (f.status in ('open', 'decision_pending')) desc, f.raised_at desc), '[]'::jsonb) into v_out
    from public.vendor_esg_flags f join public.suppliers s on s.id = f.supplier_id
    left join public.jobs j on j.id = f.job_id left join public.supplier_documents d on d.id = f.document_id left join public.profiles p on p.id = f.raised_by
   where (p_supplier is null or f.supplier_id = p_supplier) and (p_status is null or f.status = p_status);
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Onboarding release can require the joint approval. Off by default; the SRM owners turn it on when the Sustainability team is in place.
-- ---------------------------------------------------------------------------------------------------------------------
alter function public.onboarding_activate(uuid, jsonb) rename to _js_pre_onboarding_activate;
revoke execute on function public._js_pre_onboarding_activate(uuid, jsonb) from public, anon, authenticated;
create function public.onboarding_activate(p_supplier uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((public.division_setting('assure', 'joint_onboarding_required', 'false'::jsonb))::text, 'false') = 'true'
     and not public.joint_approval_is_approved('onboarding', p_supplier) then
    raise exception 'Onboarding needs a joint approval from a procurement director and the Sustainability team before this vendor is released';
  end if;
  perform public._js_pre_onboarding_activate(p_supplier, p);
end $$;
revoke execute on function public.onboarding_activate(uuid, jsonb) from public, anon;
grant execute on function public.onboarding_activate(uuid, jsonb) to authenticated;

revoke execute on function public.joint_approval_request(text, uuid, text, uuid), public.joint_approval_sign(uuid, boolean, text), public.joint_approval_withdraw(uuid, text),
  public.joint_approval_is_approved(text, uuid), public.joint_approvals_list(text, uuid), public.esg_flag_raise(uuid, text, text, text, uuid, uuid),
  public.esg_flag_propose_decision(uuid, text, text), public.esg_flags_list(uuid, text) from public, anon;
grant execute on function public.joint_approval_request(text, uuid, text, uuid), public.joint_approval_sign(uuid, boolean, text), public.joint_approval_withdraw(uuid, text),
  public.joint_approval_is_approved(text, uuid), public.joint_approvals_list(text, uuid), public.esg_flag_raise(uuid, text, text, text, uuid, uuid),
  public.esg_flag_propose_decision(uuid, text, text), public.esg_flags_list(uuid, text) to authenticated;
