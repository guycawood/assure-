-- Assure+ contracts: templates, contracts, parties (signing order), activity, negotiation log.
-- Status flow (assure_contract_action, legal moves only):
--   draft -> sent -> (viewed | in_review) -> signed parties -> counter_signed (all signers done, atomic)
--   sent/viewed/in_review -> expired ; any non-final -> cancelled ; any -> amended (a new draft version is created)
-- Signing order is enforced: a signer can't sign before everyone with a lower order has signed.
-- Vendors see their own supplier's contracts once sent (no internal notes), and the parties on them.

create sequence public.contract_no;

create table public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  category text not null default 'custom'
    check (category in ('proposals','sales_contracts','service_agreements','nda','sow','terms_conditions','amendments','custom')),
  folder text,
  description text,
  content text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public._template_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger contract_templates_before before insert or update on public.contract_templates
  for each row execute function public._template_before();

alter table public.contract_templates enable row level security;
create policy ctpl_read on public.contract_templates for select to authenticated using (public.is_internal());
create policy ctpl_insert on public.contract_templates for insert to authenticated with check (public.is_internal());
create policy ctpl_update on public.contract_templates for update to authenticated using (public.is_internal()) with check (public.is_internal());
create policy ctpl_delete on public.contract_templates for delete to authenticated using (public.is_admin() or created_by = auth.uid());

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_ref text unique,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  region text,
  market text,
  template_id uuid references public.contract_templates(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  document_type text not null default 'contract' check (document_type in ('contract','amendment','nda','addendum','quote','sow','other')),
  -- decision fields: only via assure_contract_action() / assure_contract_sign()
  status text not null default 'draft'
    check (status in ('draft','sent','viewed','in_review','signed','counter_signed','declined','expired','cancelled','amended')),
  version int not null default 1,
  parent_contract_id uuid references public.contracts(id) on delete set null,
  content_summary text,
  document_path text,
  value numeric(14,2) check (value is null or value >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  start_date date,
  end_date date,
  due_date date,
  sent_at timestamptz,
  finalized_at timestamptz,
  internal_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index contracts_supplier_idx on public.contracts (supplier_id);
create index contracts_end_idx on public.contracts (end_date) where status in ('signed','counter_signed');
create trigger contracts_region before insert on public.contracts for each row execute function public._assure_fill_region_market();

create table public.contract_parties (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null default 'signer' check (role in ('signer','reviewer','cc')),
  signing_order int not null default 1 check (signing_order >= 1),
  is_internal boolean not null default false,
  -- decision fields
  status text not null default 'pending' check (status in ('pending','sent','viewed','signed','declined')),
  signed_at timestamptz,
  signature_evidence text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index contract_parties_contract_idx on public.contract_parties (contract_id, signing_order);

create table public.contract_activity (
  id bigint generated always as identity primary key,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  event_type text not null check (event_type in ('created','sent','viewed','signed','declined','amended','commented','expired','cancelled','reminder','edited')),
  description text,
  actor uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index contract_activity_contract_idx on public.contract_activity (contract_id, created_at desc);

create table public.contract_negotiations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  clause text not null check (length(trim(clause)) > 0),
  complexity text not null check (complexity in ('high','low')),
  risk text not null check (risk in ('high','low')),
  action text generated always as (
    case when complexity = 'high' and risk = 'low' then 'use_query_matrix_conditions'
         when complexity = 'high' and risk = 'high' then 'hold_escalate'
         when complexity = 'low' and risk = 'low' then 'accept_fix'
         else 'use_query_matrix' end) stored,
  rationale text,
  outcome_note text,
  logged_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Field guard: status and system fields only change inside the functions; content edits only while draft.
create or replace function public._contract_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('assure.system_write', true) = 'on' then new.updated_at := now(); return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.version := 1; new.parent_contract_id := null; new.sent_at := null; new.finalized_at := null;
    new.created_by := auth.uid();
    new.contract_ref := 'CT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.contract_no')::text, 5, '0');
  else
    if old.status <> 'draft' and (new.title, new.document_type, new.content_summary, new.document_path, new.value, new.currency,
        new.start_date, new.end_date, new.supplier_id) is distinct from
       (old.title, old.document_type, old.content_summary, old.document_path, old.value, old.currency,
        old.start_date, old.end_date, old.supplier_id) then
      raise exception 'This contract has been sent; amend it to change its terms';
    end if;
    new.status := old.status; new.version := old.version; new.parent_contract_id := old.parent_contract_id;
    new.sent_at := old.sent_at; new.finalized_at := old.finalized_at; new.created_by := old.created_by; new.contract_ref := old.contract_ref;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger contracts_before before insert or update on public.contracts for each row execute function public._contract_before();

create or replace function public._contract_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.contract_activity (contract_id, event_type, description, actor)
  values (new.id, 'created', case when new.parent_contract_id is null then 'Contract created' else 'Amendment v' || new.version || ' created' end, auth.uid());
  if new.supplier_id is not null then
    perform public._assure_log(new.supplier_id, 'contract', new.id, 'created', null, new.status, 'Contract created: ' || new.title, null);
  end if;
  return null;
end $$;
create trigger contracts_after_insert after insert on public.contracts for each row execute function public._contract_after_insert();

create or replace function public._party_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if current_setting('assure.system_write', true) = 'on' then return new; end if;
  select status into v_status from public.contracts where id = coalesce(new.contract_id, old.contract_id);
  if v_status <> 'draft' then raise exception 'Recipients can only be changed while the contract is a draft'; end if;
  if tg_op = 'DELETE' then return old; end if;
  new.status := 'pending'; new.signed_at := null; new.signature_evidence := null; new.recorded_by := null;
  return new;
end $$;
create trigger contract_parties_before before insert or update or delete on public.contract_parties
  for each row execute function public._party_before();

alter table public.contracts enable row level security;
alter table public.contract_parties enable row level security;
alter table public.contract_activity enable row level security;
alter table public.contract_negotiations enable row level security;

create policy ct_read on public.contracts for select to authenticated using (public.is_internal());
create policy ct_insert on public.contracts for insert to authenticated with check (public.is_internal());
create policy ct_update on public.contracts for update to authenticated using (public.is_internal()) with check (public.is_internal());
revoke delete on public.contracts from authenticated, anon;

create policy cp_read on public.contract_parties for select to authenticated using (public.is_internal());
create policy cp_write on public.contract_parties for all to authenticated using (public.is_internal()) with check (public.is_internal());

create policy ca_read on public.contract_activity for select to authenticated using (public.is_internal());
create policy ca_comment on public.contract_activity for insert to authenticated
  with check (public.is_internal() and event_type = 'commented' and actor = auth.uid() and nullif(trim(coalesce(description, '')), '') is not null);
revoke update, delete on public.contract_activity from authenticated, anon;

create policy cn_read on public.contract_negotiations for select to authenticated using (public.is_internal());
create policy cn_insert on public.contract_negotiations for insert to authenticated with check (public.is_internal() and logged_by = auth.uid());
create policy cn_update on public.contract_negotiations for update to authenticated using (public.is_internal()) with check (public.is_internal());
create policy cn_delete on public.contract_negotiations for delete to authenticated using (public.is_admin());

-- Vendor views.
create view public.vendor_contracts as
  select id, contract_ref, supplier_id, title, document_type, status, version, parent_contract_id, content_summary, document_path,
         value, currency, start_date, end_date, due_date, sent_at, finalized_at, created_at, updated_at
    from public.contracts
   where supplier_id = public.my_supplier_id() and status <> 'draft';
create view public.vendor_contract_parties as
  select p.id, p.contract_id, p.name, p.email, p.role, p.signing_order, p.status, p.signed_at
    from public.contract_parties p join public.contracts c on c.id = p.contract_id
   where c.supplier_id = public.my_supplier_id() and c.status <> 'draft';
revoke all on public.vendor_contracts, public.vendor_contract_parties from anon;
grant select on public.vendor_contracts, public.vendor_contract_parties to authenticated;

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create or replace function public.assure_contract_action(p_id uuid, p_action text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.contracts; v_to text; v_new uuid;
begin
  perform public._assure_require_internal();
  select * into c from public.contracts where id = p_id for update;
  if not found then raise exception 'Contract not found'; end if;

  if p_action = 'send' then
    if c.status <> 'draft' then raise exception 'Only a draft can be sent'; end if;
    if not exists (select 1 from public.contract_parties where contract_id = p_id and role = 'signer') then
      raise exception 'Add at least one signer before sending';
    end if;
    v_to := 'sent';
  elsif p_action in ('mark_viewed','mark_in_review') then
    if c.status not in ('sent','viewed','in_review') then raise exception 'Only a sent contract can be marked %', replace(p_action, 'mark_', ''); end if;
    v_to := case when p_action = 'mark_viewed' then 'viewed' else 'in_review' end;
  elsif p_action = 'decline' then
    if c.status not in ('sent','viewed','in_review') then raise exception 'Only a sent contract can be declined'; end if;
    if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Record why it was declined'; end if;
    v_to := 'declined';
  elsif p_action = 'expire' then
    if c.status not in ('sent','viewed','in_review') then raise exception 'Only a contract waiting for signature can be expired'; end if;
    v_to := 'expired';
  elsif p_action = 'cancel' then
    if c.status in ('cancelled','signed','counter_signed','expired','amended') then raise exception 'This contract can''t be cancelled now'; end if;
    if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why the contract is being cancelled'; end if;
    v_to := 'cancelled';
  elsif p_action = 'remind' then
    if c.status not in ('sent','viewed','in_review') then raise exception 'Reminders are for contracts waiting for signature'; end if;
    insert into public.contract_activity (contract_id, event_type, description, actor) values (p_id, 'reminder', coalesce(nullif(trim(p_note), ''), 'Reminder logged'), auth.uid());
    return p_id;
  elsif p_action = 'amend' then
    if c.status in ('draft','amended','cancelled') then raise exception 'This contract can''t be amended'; end if;
    perform set_config('assure.system_write', 'on', true);
    insert into public.contracts (contract_ref, supplier_id, template_id, title, document_type, status, version, parent_contract_id, content_summary,
                                  document_path, value, currency, start_date, end_date, due_date, created_by)
    values ('CT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.contract_no')::text, 5, '0'), c.supplier_id, c.template_id,
            regexp_replace(c.title, ' \(Amendment v\d+\)$', '') || ' (Amendment v' || (c.version + 1) || ')', 'amendment', 'draft', c.version + 1, c.id,
            coalesce(nullif(trim(p_note), ''), 'Amendment of ' || c.title), c.document_path, c.value, c.currency, c.start_date, c.end_date, c.due_date, auth.uid())
    returning id into v_new;
    insert into public.contract_parties (contract_id, name, email, role, signing_order, is_internal)
    select v_new, name, email, role, signing_order, is_internal from public.contract_parties where contract_id = p_id;
    update public.contracts set status = 'amended' where id = p_id;
    perform set_config('assure.system_write', 'off', true);
    insert into public.contract_activity (contract_id, event_type, description, actor) values (p_id, 'amended', 'Superseded by amendment v' || (c.version + 1), auth.uid());
    if c.supplier_id is not null then
      perform public._assure_log(c.supplier_id, 'contract', p_id, 'amended', c.status, 'amended', 'Contract amended: ' || c.title, nullif(trim(p_note), ''));
    end if;
    return v_new;
  else
    raise exception 'Unknown action %', p_action;
  end if;

  perform set_config('assure.system_write', 'on', true);
  update public.contracts set status = v_to, sent_at = case when v_to = 'sent' then now() else sent_at end where id = p_id;
  if v_to = 'sent' then
    update public.contract_parties set status = 'sent' where contract_id = p_id and status = 'pending';
  end if;
  perform set_config('assure.system_write', 'off', true);
  insert into public.contract_activity (contract_id, event_type, description, actor)
  values (p_id, case v_to when 'viewed' then 'viewed' when 'in_review' then 'viewed' when 'declined' then 'declined'
                          when 'expired' then 'expired' when 'cancelled' then 'cancelled' else 'sent' end,
          coalesce(nullif(trim(p_note), ''), 'Status ' || c.status || ' → ' || v_to), auth.uid());
  if c.supplier_id is not null then
    perform public._assure_log(c.supplier_id, 'contract', p_id, p_action, c.status, v_to, 'Contract: ' || c.title, nullif(trim(p_note), ''));
  end if;
  return p_id;
end $$;

-- Record a signature for a party. Staff record it with evidence (e-signature reference or scanned copy).
create or replace function public.assure_contract_sign(p_party uuid, p_evidence text)
returns text language plpgsql security definer set search_path = public as $$
declare p public.contract_parties; c public.contracts; v_left int;
begin
  perform public._assure_require_internal();
  select * into p from public.contract_parties where id = p_party for update;
  if not found then raise exception 'Recipient not found'; end if;
  select * into c from public.contracts where id = p.contract_id for update;
  if c.status not in ('sent','viewed','in_review','signed') then raise exception 'This contract is not out for signature'; end if;
  if p.role <> 'signer' then raise exception 'Only signers sign'; end if;
  if p.status in ('signed','declined') then raise exception 'This recipient has already %', p.status; end if;
  if nullif(trim(coalesce(p_evidence, '')), '') is null then raise exception 'Record the signature evidence (e-signature reference or signed copy)'; end if;
  if exists (select 1 from public.contract_parties where contract_id = p.contract_id and role = 'signer'
               and signing_order < p.signing_order and status <> 'signed') then
    raise exception 'Earlier signers must sign first';
  end if;
  perform set_config('assure.system_write', 'on', true);
  update public.contract_parties set status = 'signed', signed_at = now(), signature_evidence = trim(p_evidence), recorded_by = auth.uid() where id = p_party;
  insert into public.contract_activity (contract_id, event_type, description, actor) values (c.id, 'signed', p.name || ' signed', auth.uid());
  select count(*) into v_left from public.contract_parties where contract_id = c.id and role = 'signer' and status <> 'signed';
  if v_left = 0 then
    update public.contracts set status = 'counter_signed', finalized_at = now() where id = c.id;
    insert into public.contract_activity (contract_id, event_type, description, actor) values (c.id, 'signed', 'All signers complete: contract finalised', auth.uid());
    if c.supplier_id is not null then
      perform public._assure_log(c.supplier_id, 'contract', c.id, 'finalised', c.status, 'counter_signed', 'Contract finalised: ' || c.title, null);
    end if;
  end if;
  perform set_config('assure.system_write', 'off', true);
  return case when v_left = 0 then 'counter_signed' else 'signed' end;
end $$;

revoke execute on function public._template_before(), public._contract_before(), public._contract_after_insert(), public._party_before()
  from public, anon, authenticated;
grant execute on function public.assure_contract_action(uuid, text, text), public.assure_contract_sign(uuid, text) to authenticated;
