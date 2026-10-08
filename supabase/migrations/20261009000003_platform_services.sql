-- Platform services used by every module: file storage, notifications, and region/market master data (Data Management).

-- ---------------------------------------------------------------------------
-- Files. Production stores bytes in Supabase Storage (storage_path); demo mode keeps them in `content`.
-- Every file is tied to the record it belongs to; vendors can only see files on their own supplier.
-- ---------------------------------------------------------------------------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  entity_type text not null,
  entity_id text not null,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 255),
  content_type text not null default 'application/octet-stream',
  size_bytes int not null check (size_bytes between 1 and 15728640),
  storage_path text,
  content bytea,
  label text,
  uploaded_by uuid references public.profiles(id),
  uploaded_by_vendor boolean not null default false,
  created_at timestamptz not null default now()
);
create index files_entity_idx on public.files (entity_type, entity_id);
alter table public.files enable row level security;
create policy files_read on public.files for select to authenticated
  using (public.is_internal() or (supplier_id is not null and supplier_id = public.my_supplier_id()));
revoke insert, update, delete on public.files from authenticated, anon;

-- Register a file (bytes as base64 in demo; storage_path in production). Vendors can only attach to their own supplier.
create or replace function public.file_register(p_module text, p_entity_type text, p_entity_id text, p_supplier uuid,
  p_name text, p_type text, p_size int, p_base64 text, p_storage_path text, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_vendor boolean := not public.is_internal(); v_supplier uuid := p_supplier;
begin
  if auth.uid() is null then raise exception 'Sign in to upload' using errcode = '42501'; end if;
  if v_vendor then
    v_supplier := public.my_supplier_id();
    if v_supplier is null or (p_supplier is not null and p_supplier <> v_supplier) then
      raise exception 'You can only upload to your own company' using errcode = '42501';
    end if;
  end if;
  if p_base64 is null and p_storage_path is null then raise exception 'No file content'; end if;
  insert into public.files (module, entity_type, entity_id, supplier_id, file_name, content_type, size_bytes, storage_path, content, label, uploaded_by, uploaded_by_vendor)
  values (p_module, p_entity_type, p_entity_id, v_supplier, p_name, coalesce(nullif(p_type, ''), 'application/octet-stream'), p_size, p_storage_path,
          case when p_base64 is null then null else decode(p_base64, 'base64') end, nullif(p_label, ''), auth.uid(), v_vendor)
  returning id into v_id;
  return v_id;
end $$;

-- Read bytes (demo mode) with the same access rule as the table.
create or replace function public.file_content(p_id uuid)
returns table (file_name text, content_type text, content_b64 text, storage_path text)
language sql stable security definer set search_path = public as $$
  select f.file_name, f.content_type, encode(f.content, 'base64'), f.storage_path from public.files f
  where f.id = p_id and (public.is_internal() or (f.supplier_id is not null and f.supplier_id = public.my_supplier_id()));
$$;

create or replace function public.file_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.files;
begin
  select * into f from public.files where id = p_id;
  if f.id is null then raise exception 'File not found'; end if;
  if not (public.is_admin() or f.uploaded_by = auth.uid()) then raise exception 'Only the uploader or an admin can remove a file' using errcode = '42501'; end if;
  delete from public.files where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications (the bell). Written by other security-definer functions via notify(); users read and dismiss their own.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module text not null,
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.notifications from authenticated, anon;

create or replace function public.notify(p_user uuid, p_module text, p_title text, p_body text, p_href text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, module, title, body, href) select p_user, p_module, p_title, p_body, p_href where p_user is not null;
$$;
-- Notify everyone with an SRT role (or admins when p_role = 'admin').
create or replace function public.notify_role(p_role text, p_module text, p_title text, p_body text, p_href text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, module, title, body, href)
  select id, p_module, p_title, p_body, p_href from public.profiles where (p_role = 'admin' and is_admin) or srt_role = p_role;
$$;
create or replace function public.notifications_mark_read(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_id is null or id = p_id);
$$;
revoke execute on function public.notify(uuid, text, text, text, text), public.notify_role(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.file_register(text, text, text, uuid, text, text, int, text, text, text), public.file_content(uuid),
  public.file_delete(uuid), public.notifications_mark_read(uuid) to authenticated;

-- Notify a supplier's vendor users (Supplier Engagement touchpoints call this).
create or replace function public.notify_supplier(p_supplier uuid, p_module text, p_title text, p_body text, p_href text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, module, title, body, href)
  select id, p_module, p_title, p_body, p_href from public.profiles where supplier_id = p_supplier and user_type = 'vendor';
$$;
revoke execute on function public.notify_supplier(uuid, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Regions and markets (Data Management). Region and market are separate; a market belongs to one region.
-- ---------------------------------------------------------------------------
create table public.regions (code text primary key, name text not null, sort int not null default 0);
create table public.markets (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name text not null,
  region_code text not null references public.regions(code),
  m49_code text,
  currency text not null,
  active boolean not null default true
);
alter table public.regions enable row level security;
alter table public.markets enable row level security;
create policy regions_read on public.regions for select to authenticated using (true);
create policy markets_read on public.markets for select to authenticated using (true);
revoke insert, update, delete on public.regions, public.markets from authenticated, anon;

insert into public.regions (code, name, sort) values ('APAC','Asia Pacific',1), ('EMEA','Europe, Middle East and Africa',2), ('Americas','Americas',3), ('GSC','Global Supply Chain',4);
insert into public.markets (code, name, region_code, m49_code, currency) values
 ('AU','Australia','APAC','036','AUD'), ('CN','China','APAC','156','CNY'), ('HK','Hong Kong','APAC','344','HKD'), ('IN','India','APAC','356','INR'),
 ('ID','Indonesia','APAC','360','IDR'), ('JP','Japan','APAC','392','JPY'), ('KR','South Korea','APAC','410','KRW'), ('MY','Malaysia','APAC','458','MYR'),
 ('NZ','New Zealand','APAC','554','NZD'), ('PH','Philippines','APAC','608','PHP'), ('SG','Singapore','APAC','702','SGD'), ('TH','Thailand','APAC','764','THB'),
 ('TW','Taiwan','APAC','158','TWD'), ('VN','Vietnam','APAC','704','VND'),
 ('GB','United Kingdom','EMEA','826','GBP'), ('IE','Ireland','EMEA','372','EUR'), ('FR','France','EMEA','250','EUR'), ('DE','Germany','EMEA','276','EUR'),
 ('NL','Netherlands','EMEA','528','EUR'), ('BE','Belgium','EMEA','056','EUR'), ('ES','Spain','EMEA','724','EUR'), ('PT','Portugal','EMEA','620','EUR'),
 ('IT','Italy','EMEA','380','EUR'), ('PL','Poland','EMEA','616','PLN'), ('CZ','Czechia','EMEA','203','CZK'), ('SK','Slovakia','EMEA','703','EUR'),
 ('SE','Sweden','EMEA','752','SEK'), ('DK','Denmark','EMEA','208','DKK'), ('TR','Turkey','EMEA','792','TRY'), ('AE','United Arab Emirates','EMEA','784','AED'),
 ('SA','Saudi Arabia','EMEA','682','SAR'), ('ZA','South Africa','EMEA','710','ZAR'),
 ('US','United States','Americas','840','USD'), ('CA','Canada','Americas','124','CAD'), ('MX','Mexico','Americas','484','MXN'),
 ('BR','Brazil','Americas','076','BRL'), ('CO','Colombia','Americas','170','COP'), ('AR','Argentina','Americas','032','ARS'), ('CL','Chile','Americas','152','CLP');
