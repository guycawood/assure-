-- Assure+ messages (one conversation thread per supplier topic) and training (modules + completion tracking).
-- Messages: sender and side come from the signed-in user, never from the client. Staff see every conversation;
--           a vendor sees and writes only in their own supplier's conversations. Read state is per person.
-- Training: admins manage modules (links must be https). Assignments are made by admins or SRT leads;
--           a person moves their own assignment to in progress and then completed (it must be started first);
--           only admins waive.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  region text,
  market text,
  subject text not null check (length(trim(subject)) > 0),
  status text not null default 'active' check (status in ('active','archived')),
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create index conversations_supplier_idx on public.conversations (supplier_id, last_message_at desc);
create trigger conversations_region before insert on public.conversations
  for each row execute function public._assure_fill_region_market();

create or replace function public._conversation_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.last_message_at := null;
  else
    new.created_by := old.created_by; new.supplier_id := old.supplier_id;
  end if;
  return new;
end $$;
create trigger conversations_before before insert or update on public.conversations
  for each row execute function public._conversation_before();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 and length(body) <= 10000),
  sender uuid references public.profiles(id) on delete set null,
  sender_side text not null default 'internal' check (sender_side in ('internal','supplier')),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create or replace function public._message_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('assure.system_write', true) = 'on' then return new; end if;  -- demo seed / system imports
  new.sender := auth.uid();
  new.sender_side := case when public.is_internal() then 'internal' else 'supplier' end;
  new.created_at := now();
  return new;
end $$;
create trigger messages_before before insert on public.messages for each row execute function public._message_before();

create or replace function public._message_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  if new.sender is not null then
    insert into public.message_reads (conversation_id, user_id, last_read_at) values (new.conversation_id, new.sender, new.created_at)
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  end if;
  return null;
end $$;

create table public.message_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create trigger messages_after after insert on public.messages for each row execute function public._message_after();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;

create policy conv_read on public.conversations for select to authenticated
  using (public.is_internal() or supplier_id = public.my_supplier_id());
create policy conv_insert on public.conversations for insert to authenticated
  with check (public.is_internal() or supplier_id = public.my_supplier_id());
create policy conv_update on public.conversations for update to authenticated using (public.is_internal()) with check (public.is_internal());
revoke delete on public.conversations from authenticated, anon;

create policy msg_read on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id
                 and (public.is_internal() or c.supplier_id = public.my_supplier_id())));
create policy msg_insert on public.messages for insert to authenticated
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.status = 'active'
                      and (public.is_internal() or c.supplier_id = public.my_supplier_id())));
revoke update, delete on public.messages from authenticated, anon;

create policy mr_read on public.message_reads for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.message_reads from authenticated, anon;

create or replace function public.assure_mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations c where c.id = p_conversation
                 and (public.is_internal() or c.supplier_id = public.my_supplier_id())) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  insert into public.message_reads (conversation_id, user_id, last_read_at) values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Training
-- ---------------------------------------------------------------------------
create table public.training_modules (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  resource_type text not null default 'document' check (resource_type in ('video','document','faq')),
  description text,
  url text check (url is null or url ~* '^https://'),
  content text,
  category text not null default 'General',
  audience text not null default 'all' check (audience in ('internal','vendor','all')),
  duration_minutes int check (duration_minutes is null or duration_minutes > 0),
  display_order int not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.training_modules enable row level security;
create policy tm_read on public.training_modules for select to authenticated
  using (active and (public.is_internal() or audience in ('vendor','all')) or public.is_admin());
create policy tm_admin on public.training_modules for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.training_modules(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  due_date date,
  status text not null default 'assigned' check (status in ('assigned','in_progress','completed','waived')),
  started_at timestamptz,
  completed_at timestamptz,
  waived_by uuid references public.profiles(id) on delete set null,
  waive_reason text,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (module_id, user_id)
);
create index training_assignments_user_idx on public.training_assignments (user_id);

alter table public.training_assignments enable row level security;
create policy ta_read on public.training_assignments for select to authenticated
  using (user_id = auth.uid() or public.is_internal());
revoke insert, update, delete on public.training_assignments from authenticated, anon;

create or replace function public.assure_training_assign(p_module uuid, p_users uuid[], p_due date)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.is_admin() or coalesce(public.my_srt_role(), '') = 'lead') then
    raise exception 'Only admins and SRT leads assign training' using errcode = '42501';
  end if;
  if not exists (select 1 from public.training_modules where id = p_module and active) then raise exception 'Choose an active training module'; end if;
  insert into public.training_assignments (module_id, user_id, due_date, assigned_by)
  select p_module, u, p_due, auth.uid() from unnest(p_users) u
   where exists (select 1 from public.profiles where id = u)
  on conflict (module_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Self-enrol in an available module (starts it).
create or replace function public.assure_training_start(p_module uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.training_modules where id = p_module and active
                 and (public.is_internal() or audience in ('vendor','all'))) then
    raise exception 'Training module not found';
  end if;
  insert into public.training_assignments (module_id, user_id, status, started_at, assigned_by)
  values (p_module, auth.uid(), 'in_progress', now(), auth.uid())
  on conflict (module_id, user_id) do update set status = case when training_assignments.status = 'assigned' then 'in_progress' else training_assignments.status end,
    started_at = coalesce(training_assignments.started_at, now())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.assure_training_progress(p_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.training_assignments;
begin
  select * into a from public.training_assignments where id = p_id for update;
  if not found then raise exception 'Assignment not found'; end if;
  if p_status = 'waived' then
    if not public.is_admin() then raise exception 'Only admins can waive training' using errcode = '42501'; end if;
    if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Say why the training is waived'; end if;
    update public.training_assignments set status = 'waived', waived_by = auth.uid(), waive_reason = trim(p_reason) where id = p_id;
    return;
  end if;
  if a.user_id <> auth.uid() then raise exception 'You can only update your own training' using errcode = '42501'; end if;
  if p_status = 'in_progress' then
    if a.status <> 'assigned' then raise exception 'This training has already been started'; end if;
    update public.training_assignments set status = 'in_progress', started_at = now() where id = p_id;
  elsif p_status = 'completed' then
    if a.status <> 'in_progress' then raise exception 'Start the training before marking it complete'; end if;
    update public.training_assignments set status = 'completed', completed_at = now() where id = p_id;
  else
    raise exception 'Unknown status %', p_status;
  end if;
end $$;

revoke execute on function public._conversation_before(), public._message_before(), public._message_after() from public, anon, authenticated;
grant execute on function public.assure_mark_conversation_read(uuid), public.assure_training_assign(uuid, uuid[], date),
  public.assure_training_start(uuid), public.assure_training_progress(uuid, text, text) to authenticated;
