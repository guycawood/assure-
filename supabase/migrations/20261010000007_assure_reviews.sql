-- Assure+ business reviews (QBRs, check-ins, escalations, renewals).
-- Outcomes, discussion notes and sentiment are internal and are never shown to the vendor.
-- Vendors see only reviews that are shared with them, through vendor_business_reviews, and can respond.
-- Outcome approval: changing the outcomes puts them back to 'pending'; only the Procurement head (or an admin),
-- and not the person who created the review, approves or rejects them.

create table public.business_reviews (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  title text not null check (length(trim(title)) > 0),
  description text,
  review_type text not null default 'qbr' check (review_type in ('qbr','check_in','escalation','renewal','other')),
  meeting_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  internal_attendees text[] not null default '{}',
  vendor_attendees text[] not null default '{}',
  agenda_items text[] not null default '{}' check (cardinality(agenda_items) >= 1),
  presentation_path text,
  shared_with_vendor boolean not null default false,
  next_review_date date,
  -- internal only
  key_outcomes text,
  discussion_notes text,
  overall_sentiment text check (overall_sentiment is null or overall_sentiment in ('positive','neutral','needs_attention')),
  -- decision fields: only via assure_review_approve_outcomes()
  outcomes_approval_status text not null default 'not_set' check (outcomes_approval_status in ('not_set','pending','approved','rejected')),
  outcomes_approved_by uuid references public.profiles(id) on delete set null,
  outcomes_approved_at timestamptz,
  outcomes_review_note text,
  -- vendor response: only via assure_review_vendor_respond()
  vendor_response text not null default 'none' check (vendor_response in ('none','accepted','suggested_reschedule','notes')),
  vendor_suggested_date date,
  vendor_notes text,
  vendor_responded_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index business_reviews_supplier_idx on public.business_reviews (supplier_id, meeting_date desc);
create index business_reviews_date_idx on public.business_reviews (meeting_date);
create trigger business_reviews_region before insert on public.business_reviews
  for each row execute function public._assure_fill_region_market();

create or replace function public._review_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('assure.system_write', true) = 'on' then new.updated_at := now(); return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.outcomes_approved_by := null; new.outcomes_approved_at := null; new.outcomes_review_note := null;
    new.vendor_response := 'none'; new.vendor_suggested_date := null; new.vendor_notes := null; new.vendor_responded_at := null;
    new.outcomes_approval_status := case when nullif(trim(coalesce(new.key_outcomes, '')), '') is null then 'not_set' else 'pending' end;
  else
    new.created_by := old.created_by;
    new.outcomes_approved_by := old.outcomes_approved_by; new.outcomes_approved_at := old.outcomes_approved_at;
    new.outcomes_review_note := old.outcomes_review_note;
    new.vendor_response := old.vendor_response; new.vendor_suggested_date := old.vendor_suggested_date;
    new.vendor_notes := old.vendor_notes; new.vendor_responded_at := old.vendor_responded_at;
    if nullif(trim(coalesce(new.key_outcomes, '')), '') is null then
      new.outcomes_approval_status := 'not_set'; new.outcomes_approved_by := null; new.outcomes_approved_at := null;
    elsif new.key_outcomes is distinct from old.key_outcomes then
      new.outcomes_approval_status := 'pending'; new.outcomes_approved_by := null; new.outcomes_approved_at := null;
    else
      new.outcomes_approval_status := old.outcomes_approval_status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger business_reviews_before before insert or update on public.business_reviews
  for each row execute function public._review_before();

create or replace function public._review_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._assure_log(new.supplier_id, 'review', new.id, 'scheduled', null, new.status, 'Business review scheduled: ' || new.title, to_char(new.meeting_date, 'DD Mon YYYY'));
  else
    if new.status is distinct from old.status then
      perform public._assure_log(new.supplier_id, 'review', new.id, 'status_changed', old.status, new.status, 'Business review ' || new.status || ': ' || new.title, null);
    end if;
    if new.shared_with_vendor and not old.shared_with_vendor then
      perform public._assure_log(new.supplier_id, 'review', new.id, 'shared', null, null, 'Business review shared with the vendor: ' || new.title, null);
    end if;
  end if;
  return null;
end $$;
create trigger business_reviews_after after insert or update on public.business_reviews
  for each row execute function public._review_after();

alter table public.business_reviews enable row level security;
create policy br_read on public.business_reviews for select to authenticated using (public.is_internal());
create policy br_insert on public.business_reviews for insert to authenticated with check (public.is_internal());
create policy br_update on public.business_reviews for update to authenticated using (public.is_internal()) with check (public.is_internal());
create policy br_delete on public.business_reviews for delete to authenticated using (public.is_admin());

-- Vendor view: shared reviews only, no internal fields.
create view public.vendor_business_reviews as
  select id, supplier_id, title, description, review_type, meeting_date, status, internal_attendees, vendor_attendees, agenda_items,
         presentation_path, next_review_date, vendor_response, vendor_suggested_date, vendor_notes, vendor_responded_at, created_at
    from public.business_reviews
   where supplier_id = public.my_supplier_id() and shared_with_vendor;
revoke all on public.vendor_business_reviews from anon;
grant select on public.vendor_business_reviews to authenticated;

create or replace function public.assure_review_approve_outcomes(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.business_reviews;
begin
  if not (public.is_admin() or coalesce(public.my_srt_role(), '') = 'head') then
    raise exception 'Only the Procurement head can approve review outcomes' using errcode = '42501';
  end if;
  select * into r from public.business_reviews where id = p_id for update;
  if not found then raise exception 'Review not found'; end if;
  if r.outcomes_approval_status <> 'pending' then raise exception 'There are no outcomes waiting for approval'; end if;
  if r.created_by = auth.uid() then raise exception 'You created this review, so someone else must approve its outcomes' using errcode = '42501'; end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why the outcomes are rejected'; end if;
  perform set_config('assure.system_write', 'on', true);
  update public.business_reviews set outcomes_approval_status = case when p_approve then 'approved' else 'rejected' end,
    outcomes_approved_by = auth.uid(), outcomes_approved_at = now(), outcomes_review_note = nullif(trim(p_note), '') where id = p_id;
  perform set_config('assure.system_write', 'off', true);
  perform public._assure_log(r.supplier_id, 'review', p_id, case when p_approve then 'outcomes_approved' else 'outcomes_rejected' end,
    'pending', case when p_approve then 'approved' else 'rejected' end, 'Review outcomes ' || case when p_approve then 'approved' else 'rejected' end, nullif(trim(p_note), ''));
end $$;

create or replace function public.assure_review_vendor_respond(p_id uuid, p_response text, p_suggested date, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.business_reviews;
begin
  select * into r from public.business_reviews where id = p_id for update;
  if not found or not r.shared_with_vendor or public.my_supplier_id() is null or r.supplier_id <> public.my_supplier_id() or public.is_internal() then
    raise exception 'This review is not shared with your company' using errcode = '42501';
  end if;
  if p_response not in ('accepted','suggested_reschedule','notes') then raise exception 'Unknown response %', p_response; end if;
  if p_response = 'suggested_reschedule' and p_suggested is null then raise exception 'Suggest a new date'; end if;
  perform set_config('assure.system_write', 'on', true);
  update public.business_reviews set vendor_response = p_response, vendor_suggested_date = p_suggested,
    vendor_notes = nullif(trim(p_notes), ''), vendor_responded_at = now() where id = p_id;
  perform set_config('assure.system_write', 'off', true);
  perform public._assure_log(r.supplier_id, 'review', p_id, 'vendor_response', r.vendor_response, p_response, 'Vendor responded to ' || r.title, nullif(trim(p_notes), ''));
end $$;

revoke execute on function public._review_before(), public._review_after() from public, anon, authenticated;
grant execute on function public.assure_review_approve_outcomes(uuid, boolean, text), public.assure_review_vendor_respond(uuid, text, date, text) to authenticated;
