-- WhatsApp and WeChat as delivery channels on SRM vendor conversations.
-- The conversation stays the single record. A channel adds: a contact (number or ID) with a recorded opt-in, an outbound queue with
-- delivery status, a reply window rule per channel (WhatsApp: free text only within 24 hours of the vendor's last message, otherwise an
-- approved template), and an inbound function that files a reply into the vendor's open conversation or holds it for review.
-- The functions that the sender and the webhooks call (messaging_claim, _result, _delivery, _inbound) are not granted to signed-in users.

-- ---------------------------------------------------------------------------
-- Contacts and opt-in
-- ---------------------------------------------------------------------------
create table public.supplier_message_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'wechat')),
  address text not null check (length(trim(address)) between 3 and 120),
  display_name text,
  status text not null default 'pending' check (status in ('pending', 'opted_in', 'opted_out')),
  opt_in_method text, opted_in_at timestamptz, opted_in_by uuid references public.profiles(id) on delete set null, opted_out_at timestamptz,
  last_inbound_at timestamptz,
  added_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (channel, address)
);
create index smc_supplier_idx on public.supplier_message_contacts (supplier_id);
alter table public.supplier_message_contacts enable row level security;
create policy smc_read on public.supplier_message_contacts for select to authenticated using (public.is_internal() or supplier_id = public.my_supplier_id());
revoke insert, update, delete on public.supplier_message_contacts from authenticated, anon;

create table public.messaging_channel_settings (
  channel text primary key check (channel in ('whatsapp', 'wechat')),
  window_hours int check (window_hours is null or window_hours between 1 and 720)   -- null: no reply window (e.g. WeCom)
);
insert into public.messaging_channel_settings values ('whatsapp', 24), ('wechat', 48);
alter table public.messaging_channel_settings enable row level security;
create policy mcs_read on public.messaging_channel_settings for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.messaging_channel_settings from authenticated, anon;

create table public.message_templates (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  label text not null check (length(trim(label)) > 0),
  body text not null check (length(trim(body)) > 0 and length(body) <= 1000),     -- {{1}}, {{2}} are filled in when sent
  provider_name text not null,                                                      -- the template's name at the provider
  language text not null default 'en',
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_by uuid references public.profiles(id) on delete set null, approved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.message_templates enable row level security;
create policy mt_read on public.message_templates for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.message_templates from authenticated, anon;
insert into public.message_templates (key, label, body, provider_name, status, approved_at) values
  ('rfq_invitation', 'Quote request invitation', 'Hello {{1}}, you have a new quote request ({{2}}) waiting in the vendor portal. Please respond by {{3}}.', 'rfq_invitation', 'approved', now()),
  ('po_issued', 'Purchase order issued', 'Hello {{1}}, purchase order {{2}} has been issued to you. Please accept it in the vendor portal.', 'po_issued', 'approved', now()),
  ('document_request', 'Document request', 'Hello {{1}}, we need an updated {{2}} from you. Please upload it in the vendor portal.', 'document_request', 'approved', now()),
  ('payment_scheduled', 'Payment scheduled', 'Hello {{1}}, the payment for invoice {{2}} is scheduled for {{3}}.', 'payment_scheduled', 'approved', now());

-- Messages carry their channel; only the send and inbound functions may set anything other than the portal.
alter table public.messages add column channel text not null default 'portal' check (channel in ('portal', 'whatsapp', 'wechat'));
alter table public.messages add column contact_id uuid references public.supplier_message_contacts(id) on delete set null;
alter table public.messages add column external_id text;
create unique index messages_external_idx on public.messages (channel, external_id) where external_id is not null;

create or replace function public._message_channel_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('assure.system_write', true), '') <> 'on' and coalesce(current_setting('assure.msg_channel_ok', true), '') <> 'on' then
    new.channel := 'portal'; new.contact_id := null; new.external_id := null;
  end if;
  return new;
end $$;
create trigger trg_message_channel before insert on public.messages for each row execute function public._message_channel_guard();

create table public.message_outbound (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  contact_id uuid not null references public.supplier_message_contacts(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'wechat')),
  kind text not null check (kind in ('text', 'template')),
  template_key text references public.message_templates(key),
  vars jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  error text, external_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index mo_queue_idx on public.message_outbound (status, next_attempt_at);
create index mo_ext_idx on public.message_outbound (channel, external_id);
alter table public.message_outbound enable row level security;
create policy mo_read on public.message_outbound for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.message_outbound from authenticated, anon;

create table public.message_inbound_unmatched (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'wechat')),
  address text not null, display_name text, body text not null, external_id text,
  status text not null default 'pending' check (status in ('pending', 'attached', 'dismissed')),
  received_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null, decided_at timestamptz
);
create unique index miu_external_idx on public.message_inbound_unmatched (channel, external_id) where external_id is not null;
alter table public.message_inbound_unmatched enable row level security;
create policy miu_read on public.message_inbound_unmatched for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.message_inbound_unmatched from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- WhatsApp numbers are kept as digits only (country code first); WeChat IDs as typed.
create or replace function public._msg_norm(p_channel text, p_address text) returns text
language plpgsql immutable as $$
declare v text := trim(coalesce(p_address, ''));
begin
  if p_channel = 'whatsapp' then
    if v !~ '^\+?[0-9 ()-]{7,20}$' then raise exception 'Enter the WhatsApp number with its country code, for example +44 7700 900123'; end if;
    return regexp_replace(v, '[^0-9]', '', 'g');
  end if;
  if length(v) < 3 or length(v) > 120 or v ~ '\s' then raise exception 'Enter the WeChat or WeCom ID without spaces'; end if;
  return v;
end $$;

-- The caller is staff, or a vendor user acting for their own company. Returns the supplier.
create or replace function public._msg_actor(p_supplier uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_internal() then return 'internal'; end if;
  if public._vendor_require('standard') <> p_supplier then raise exception 'Not your company' using errcode = '42501'; end if;
  perform public._vendor_require_area('profile');
  return 'vendor';
end $$;
revoke execute on function public._msg_actor(uuid), public._msg_norm(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Contacts: add, opt in, opt out, list
-- ---------------------------------------------------------------------------
create or replace function public.messaging_contact_add(p_supplier uuid, p_channel text, p_address text, p_name text default null, p_method text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_actor text := public._msg_actor(p_supplier); v_addr text; c public.supplier_message_contacts; v_method text; v_id uuid;
begin
  if p_channel not in ('whatsapp', 'wechat') then raise exception 'Choose WhatsApp or WeChat'; end if;
  v_addr := public._msg_norm(p_channel, p_address);
  v_method := case when v_actor = 'vendor' then 'vendor_portal' else nullif(trim(coalesce(p_method, '')), '') end;
  select * into c from public.supplier_message_contacts where channel = p_channel and address = v_addr for update;
  if c.id is not null and c.supplier_id <> p_supplier then raise exception 'This number or ID is already linked to another company'; end if;
  if c.id is null then
    insert into public.supplier_message_contacts (supplier_id, channel, address, display_name, status, opt_in_method, opted_in_at, opted_in_by)
    values (p_supplier, p_channel, v_addr, nullif(trim(coalesce(p_name, '')), ''), case when v_method is null then 'pending' else 'opted_in' end, v_method,
            case when v_method is null then null else now() end, case when v_method is null then null else auth.uid() end) returning id into v_id;
  else
    v_id := c.id;
    if v_method is not null and c.status <> 'opted_in' then
      update public.supplier_message_contacts set status = 'opted_in', opt_in_method = v_method, opted_in_at = now(), opted_in_by = auth.uid(), opted_out_at = null where id = c.id;
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.messaging_contact_opt_in(p_id uuid, p_method text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.supplier_message_contacts; v_actor text;
begin
  select * into c from public.supplier_message_contacts where id = p_id for update;
  if c.id is null then raise exception 'Contact not found' using errcode = '42501'; end if;
  v_actor := public._msg_actor(c.supplier_id);
  if v_actor = 'internal' and coalesce(trim(p_method), '') = '' then raise exception 'Say how the vendor agreed (for example: email confirmation on 12 Nov)'; end if;
  update public.supplier_message_contacts set status = 'opted_in', opt_in_method = case when v_actor = 'vendor' then 'vendor_portal' else trim(p_method) end,
         opted_in_at = now(), opted_in_by = auth.uid(), opted_out_at = null where id = p_id;
end $$;

create or replace function public.messaging_contact_opt_out(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.supplier_message_contacts;
begin
  select * into c from public.supplier_message_contacts where id = p_id for update;
  if c.id is null then raise exception 'Contact not found' using errcode = '42501'; end if;
  perform public._msg_actor(c.supplier_id);
  update public.supplier_message_contacts set status = 'opted_out', opted_out_at = now() where id = p_id;
end $$;

create or replace function public.messaging_contacts(p_supplier uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid := case when public.is_internal() then p_supplier else public.my_supplier_id() end;
begin
  if not public.is_internal() and v_sup is null then raise exception 'Only a vendor user can do this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'supplier_id', c.supplier_id, 'supplier_name', s.name, 'channel', c.channel, 'address', c.address,
      'display_name', c.display_name, 'status', c.status, 'opt_in_method', c.opt_in_method, 'opted_in_at', c.opted_in_at, 'last_inbound_at', c.last_inbound_at)
      order by s.name, c.channel, c.created_at)
    from public.supplier_message_contacts c join public.suppliers s on s.id = c.supplier_id where v_sup is null or c.supplier_id = v_sup), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Templates and channel rules (SRM owners)
-- ---------------------------------------------------------------------------
create or replace function public.messaging_template_save(p_key text, p_label text, p_body text, p_provider_name text, p_language text default 'en') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._form_require_editor();
  insert into public.message_templates (key, label, body, provider_name, language) values (p_key, trim(p_label), trim(p_body), trim(p_provider_name), coalesce(nullif(trim(p_language), ''), 'en'))
  on conflict (key) do update set label = excluded.label, body = excluded.body, provider_name = excluded.provider_name, language = excluded.language,
    status = case when message_templates.body is distinct from excluded.body then 'draft' else message_templates.status end;     -- changed wording must be approved again
end $$;

create or replace function public.messaging_template_set_status(p_key text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._form_require_editor();
  if p_status not in ('draft', 'approved', 'retired') then raise exception 'Choose draft, approved or retired'; end if;
  update public.message_templates set status = p_status, approved_by = case when p_status = 'approved' then auth.uid() end, approved_at = case when p_status = 'approved' then now() end where key = p_key;
  if not found then raise exception 'Template not found'; end if;
end $$;

create or replace function public.messaging_templates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  return coalesce((select jsonb_agg(to_jsonb(t) - 'approved_by' order by t.label) from public.message_templates t), '[]'::jsonb);
end $$;

create or replace function public.messaging_channel_set_window(p_channel text, p_hours int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._form_require_editor();
  update public.messaging_channel_settings set window_hours = p_hours where channel = p_channel;
  if not found then raise exception 'Unknown channel'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sending (staff)
-- ---------------------------------------------------------------------------
-- What can be sent on this conversation: each opted-in contact of the vendor, and whether free text is allowed now.
create or replace function public.messaging_conversation_channels(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sup uuid;
begin
  perform public._assure_require_internal();
  select supplier_id into v_sup from public.conversations where id = p_conversation;
  return coalesce((select jsonb_agg(jsonb_build_object('contact_id', c.id, 'channel', c.channel, 'name', c.display_name, 'address', c.address, 'tail', right(c.address, 4), 'last_inbound_at', c.last_inbound_at,
      'window_hours', s.window_hours,
      'free_text_ok', (s.window_hours is null or (c.last_inbound_at is not null and c.last_inbound_at > now() - make_interval(hours => s.window_hours))),
      'window_closes_at', case when s.window_hours is not null and c.last_inbound_at is not null then c.last_inbound_at + make_interval(hours => s.window_hours) end)
      order by c.channel, c.created_at)
    from public.supplier_message_contacts c join public.messaging_channel_settings s on s.channel = c.channel
    where c.supplier_id = v_sup and c.status = 'opted_in'), '[]'::jsonb);
end $$;

create or replace function public.messaging_send(p_conversation uuid, p_contact uuid, p_body text default null, p_template text default null, p_vars text[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare cv public.conversations; c public.supplier_message_contacts; s public.messaging_channel_settings; t public.message_templates;
  v_body text; v_free boolean; v_msg uuid; v_out uuid; v_i int; v_n int;
begin
  perform public._assure_require_internal();
  select * into cv from public.conversations where id = p_conversation;
  if cv.id is null or cv.status <> 'active' then raise exception 'Conversation not found or archived'; end if;
  select * into c from public.supplier_message_contacts where id = p_contact;
  if c.id is null or c.supplier_id <> cv.supplier_id then raise exception 'That contact does not belong to this vendor'; end if;
  if c.status <> 'opted_in' then raise exception 'This contact has not opted in to messages'; end if;
  select * into s from public.messaging_channel_settings where channel = c.channel;
  v_free := s.window_hours is null or (c.last_inbound_at is not null and c.last_inbound_at > now() - make_interval(hours => s.window_hours));

  if coalesce(trim(p_template), '') <> '' then
    select * into t from public.message_templates where key = p_template;
    if t.key is null or t.channel <> c.channel then raise exception 'That template is not available on this channel'; end if;
    if t.status <> 'approved' then raise exception 'That template is not approved yet'; end if;
    v_body := t.body; v_n := coalesce(cardinality(p_vars), 0);
    for v_i in 1..v_n loop v_body := replace(v_body, '{{' || v_i || '}}', coalesce(p_vars[v_i], '')); end loop;
    if v_body ~ '\{\{[0-9]+\}\}' then raise exception 'Fill in every field of the template'; end if;
  else
    v_body := nullif(trim(coalesce(p_body, '')), '');
    if v_body is null then raise exception 'Write a message first'; end if;
    if not v_free then
      raise exception 'The reply window is closed (the vendor has not written in the last % hours). Send an approved template instead', s.window_hours;
    end if;
  end if;

  perform set_config('assure.msg_channel_ok', 'on', true);
  insert into public.messages (conversation_id, body, channel, contact_id) values (p_conversation, v_body, c.channel, c.id) returning id into v_msg;
  perform set_config('assure.msg_channel_ok', 'off', true);
  insert into public.message_outbound (message_id, contact_id, channel, kind, template_key, vars)
  values (v_msg, c.id, c.channel, case when t.key is null then 'text' else 'template' end, t.key, to_jsonb(coalesce(p_vars, '{}'::text[]))) returning id into v_out;
  return v_out;
end $$;

-- Delivery status of the messages in a conversation.
create or replace function public.messaging_outbound_for(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  return coalesce((select jsonb_agg(jsonb_build_object('message_id', o.message_id, 'channel', o.channel, 'status', o.status, 'error', o.error, 'attempts', o.attempts, 'kind', o.kind))
    from public.message_outbound o join public.messages m on m.id = o.message_id where m.conversation_id = p_conversation), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Sender and webhooks (service only)
-- ---------------------------------------------------------------------------
create or replace function public.messaging_claim(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from public.message_outbound
     where (status = 'queued' and next_attempt_at <= now()) or (status = 'sending' and updated_at < now() - interval '5 minutes')
     order by created_at limit greatest(1, least(coalesce(p_limit, 20), 100)) for update skip locked) q;
  update public.message_outbound set status = 'sending', attempts = attempts + 1, updated_at = now() where id = any (v_ids);
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'channel', o.channel, 'kind', o.kind, 'address', c.address, 'body', m.body, 'attempts', o.attempts,
      'template', case when t.key is null then null else jsonb_build_object('name', t.provider_name, 'language', t.language, 'vars', o.vars) end) order by o.created_at)
    from public.message_outbound o join public.supplier_message_contacts c on c.id = o.contact_id join public.messages m on m.id = o.message_id
    left join public.message_templates t on t.key = o.template_key where o.id = any (v_ids)), '[]'::jsonb);
end $$;

create or replace function public.messaging_result(p_id uuid, p_ok boolean, p_external text default null, p_error text default null, p_permanent boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare o public.message_outbound;
begin
  select * into o from public.message_outbound where id = p_id for update;
  if o.id is null then return; end if;
  if p_ok then
    update public.message_outbound set status = 'sent', external_id = p_external, error = null, updated_at = now() where id = p_id;
  elsif p_permanent or o.attempts >= 5 then
    update public.message_outbound set status = 'failed', error = left(coalesce(p_error, 'Not delivered'), 500), updated_at = now() where id = p_id;
  else
    update public.message_outbound set status = 'queued', error = left(coalesce(p_error, 'Will retry'), 500), next_attempt_at = now() + make_interval(mins => o.attempts * o.attempts), updated_at = now() where id = p_id;
  end if;
end $$;

-- Delivery receipts move forward only (sent, delivered, read); a failure can arrive at any point.
create or replace function public.messaging_delivery(p_channel text, p_external text, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_rank jsonb := '{"queued":0,"sending":1,"sent":2,"delivered":3,"read":4}'::jsonb;
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then return; end if;
  update public.message_outbound set status = p_status, error = case when p_status = 'failed' then left(coalesce(p_error, 'Not delivered'), 500) else error end, updated_at = now()
   where channel = p_channel and external_id = p_external
     and (p_status = 'failed' or (v_rank->>p_status)::int > coalesce((v_rank->>status)::int, 99));
end $$;

create or replace function public.messaging_inbound(p_channel text, p_address text, p_body text, p_external text default null, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_addr text; c public.supplier_message_contacts; v_conv uuid; v_body text := left(trim(coalesce(p_body, '')), 10000); v_key text;
begin
  if p_channel not in ('whatsapp', 'wechat') then raise exception 'Unknown channel'; end if;
  if v_body = '' then return jsonb_build_object('result', 'ignored'); end if;
  v_addr := public._msg_norm(p_channel, p_address);
  if p_external is not null and (exists (select 1 from public.messages where channel = p_channel and external_id = p_external)
      or exists (select 1 from public.message_inbound_unmatched where channel = p_channel and external_id = p_external)) then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select * into c from public.supplier_message_contacts where channel = p_channel and address = v_addr for update;
  if c.id is null then
    insert into public.message_inbound_unmatched (channel, address, display_name, body, external_id) values (p_channel, v_addr, nullif(trim(coalesce(p_name, '')), ''), v_body, p_external);
    return jsonb_build_object('result', 'unmatched');
  end if;
  v_key := lower(v_body);
  if v_key in ('stop', 'unsubscribe', 'stop all', 'td', '退订') then
    update public.supplier_message_contacts set status = 'opted_out', opted_out_at = now(), last_inbound_at = now() where id = c.id;
    return jsonb_build_object('result', 'opted_out');
  end if;
  if v_key in ('start', 'subscribe') and c.status = 'opted_out' then
    update public.supplier_message_contacts set status = 'opted_in', opt_in_method = 'replied START', opted_in_at = now(), opted_out_at = null, last_inbound_at = now() where id = c.id;
    return jsonb_build_object('result', 'opted_in');
  end if;

  perform set_config('assure.system_write', 'on', true);
  select id into v_conv from public.conversations where supplier_id = c.supplier_id and status = 'active' order by coalesce(last_message_at, created_at) desc limit 1;
  if v_conv is null then
    insert into public.conversations (supplier_id, subject) values (c.supplier_id, 'Message from ' || coalesce(c.display_name, 'the vendor') || ' on ' || case c.channel when 'whatsapp' then 'WhatsApp' else 'WeChat' end) returning id into v_conv;
  end if;
  insert into public.messages (conversation_id, body, sender, sender_side, channel, contact_id, external_id) values (v_conv, v_body, null, 'supplier', c.channel, c.id, p_external);
  perform set_config('assure.system_write', 'off', true);
  update public.supplier_message_contacts set last_inbound_at = now() where id = c.id;
  return jsonb_build_object('result', 'attached', 'conversation_id', v_conv, 'supplier_id', c.supplier_id);
end $$;

-- Messages from numbers we do not know wait here for staff to link them to a vendor or dismiss them.
create or replace function public.messaging_unmatched() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'channel', channel, 'address', address, 'display_name', display_name, 'body', body, 'received_at', received_at) order by received_at)
    from public.message_inbound_unmatched where status = 'pending'), '[]'::jsonb);
end $$;

create or replace function public.messaging_unmatched_attach(p_id uuid, p_supplier uuid, p_method text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.message_inbound_unmatched; v_r jsonb;
begin
  perform public._assure_require_internal();
  select * into u from public.message_inbound_unmatched where id = p_id and status = 'pending' for update;
  if u.id is null then raise exception 'Message not found'; end if;
  if coalesce(trim(p_method), '') = '' then raise exception 'Say how the vendor agreed to be messaged (for example: they wrote to us first)'; end if;
  perform public.messaging_contact_add(p_supplier, u.channel, u.address, u.display_name, p_method);
  delete from public.message_inbound_unmatched where id = p_id;                       -- replayed below as a normal inbound message
  v_r := public.messaging_inbound(u.channel, u.address, u.body, u.external_id, u.display_name);
  return v_r;
end $$;

create or replace function public.messaging_unmatched_dismiss(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._assure_require_internal();
  update public.message_inbound_unmatched set status = 'dismissed', decided_by = auth.uid(), decided_at = now() where id = p_id and status = 'pending';
end $$;

-- Grants: staff and vendor functions to signed-in users; sender and webhook functions to nobody but the service role.
revoke execute on function public.messaging_contact_add(uuid, text, text, text, text), public.messaging_contact_opt_in(uuid, text), public.messaging_contact_opt_out(uuid),
  public.messaging_contacts(uuid), public.messaging_template_save(text, text, text, text, text), public.messaging_template_set_status(text, text), public.messaging_templates(),
  public.messaging_channel_set_window(text, int), public.messaging_conversation_channels(uuid), public.messaging_send(uuid, uuid, text, text, text[]),
  public.messaging_outbound_for(uuid), public.messaging_unmatched(), public.messaging_unmatched_attach(uuid, uuid, text), public.messaging_unmatched_dismiss(uuid) from public, anon;
grant execute on function public.messaging_contact_add(uuid, text, text, text, text), public.messaging_contact_opt_in(uuid, text), public.messaging_contact_opt_out(uuid),
  public.messaging_contacts(uuid), public.messaging_template_save(text, text, text, text, text), public.messaging_template_set_status(text, text), public.messaging_templates(),
  public.messaging_channel_set_window(text, int), public.messaging_conversation_channels(uuid), public.messaging_send(uuid, uuid, text, text, text[]),
  public.messaging_outbound_for(uuid), public.messaging_unmatched(), public.messaging_unmatched_attach(uuid, uuid, text), public.messaging_unmatched_dismiss(uuid) to authenticated;
revoke execute on function public.messaging_claim(int), public.messaging_result(uuid, boolean, text, text, boolean), public.messaging_delivery(text, text, text, text),
  public.messaging_inbound(text, text, text, text, text) from public, anon, authenticated;
