-- Final creative files, aligned to the Global Business Transformation process "Creative work needed":
--   cr19 prepare the final files and send them to the client
-- The team starts a delivery, uploads the files against it, then sends it. The client sees only sent deliveries.
-- A changed file goes out as a new delivery (the earlier ones stay on record).

create table public.brief_deliveries (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs(id) on delete cascade,
  round int not null,
  status text not null default 'draft' check (status in ('draft', 'sent')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  unique (brief_id, round)
);
alter table public.brief_deliveries enable row level security;
create policy bd_read on public.brief_deliveries for select to authenticated using (public.is_internal());
revoke insert, update, delete on public.brief_deliveries from authenticated, anon;

create or replace function public.creative_delivery_start(p_brief uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare b public.briefs; v_round int; v_id uuid;
begin
  perform public._briefing_require_internal();
  select * into b from public.briefs where id = p_brief for update;
  if b.id is null then raise exception 'Brief not found'; end if;
  if b.creative_needed is not true then raise exception 'This brief is not marked as needing creative input'; end if;
  if b.status in ('archived', 'spec_created') then raise exception 'A % brief cannot take a delivery', replace(b.status, '_', ' '); end if;
  if not public._creative_started(b) then raise exception 'Creative work starts after the kick-off or the confirmed client PO. Record that on the brief first.'; end if;
  if exists (select 1 from public.brief_deliveries where brief_id = p_brief and status = 'draft') then raise exception 'A delivery is already being prepared on this brief'; end if;
  select coalesce(max(round), 0) + 1 into v_round from public.brief_deliveries where brief_id = p_brief;
  insert into public.brief_deliveries (brief_id, round, created_by) values (p_brief, v_round, auth.uid()) returning id into v_id;
  return v_id;
end $$;
grant execute on function public.creative_delivery_start(uuid) to authenticated;

create or replace function public.creative_delivery_send(p_delivery uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.brief_deliveries; b public.briefs; v_client uuid; v_files int;
begin
  perform public._briefing_require_internal();
  select * into d from public.brief_deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Delivery not found'; end if;
  if d.status <> 'draft' then raise exception 'This delivery has already been sent'; end if;
  select count(*) into v_files from public.files where entity_type = 'brief_delivery' and entity_id = d.id::text;
  if v_files = 0 then raise exception 'Upload the final files first'; end if;
  select * into b from public.briefs where id = d.brief_id;
  v_client := public._brief_client(b);
  if v_client is null then raise exception 'This brief has no client to send the files to'; end if;
  update public.brief_deliveries set status = 'sent', note = nullif(trim(p_note), ''), sent_by = auth.uid(), sent_at = now() where id = p_delivery;
  perform public._brief_event(d.brief_id, 'final_files_sent', b.status, b.status, v_files || ' file(s), delivery ' || d.round || coalesce(': ' || nullif(trim(p_note), ''), ''));
  perform public.notify(cu.user_id, 'client', 'Final files ready: ' || b.title, coalesce(nullif(trim(p_note), ''), 'We have sent the final creative files.'), '/client-portal/briefs/' || b.id)
    from public.client_users cu where cu.client_id = v_client;
end $$;
grant execute on function public.creative_delivery_send(uuid, text) to authenticated;

create or replace function public.creative_deliveries_internal(p_brief uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Internal staff only' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'round', d.round, 'status', d.status, 'note', d.note, 'created_at', d.created_at, 'sent_at', d.sent_at,
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'content_type', f.content_type) order by f.created_at), '[]'::jsonb)
                  from public.files f where f.entity_type = 'brief_delivery' and f.entity_id = d.id::text)) order by d.round desc), '[]'::jsonb)
    from public.brief_deliveries d where d.brief_id = p_brief);
end $$;
grant execute on function public.creative_deliveries_internal(uuid) to authenticated;

-- What the client sees: only deliveries that have been sent, only for its own briefs.
create or replace function public.client_creative_deliveries(p_brief uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.briefs; v_client uuid;
begin
  select * into b from public.briefs where id = p_brief;
  if b.id is null then return '[]'::jsonb; end if;
  v_client := public._brief_client(b);
  if v_client is null or public.my_client_role(v_client) is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'round', d.round, 'note', d.note, 'sent_at', d.sent_at,
      'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'content_type', f.content_type) order by f.created_at), '[]'::jsonb)
                  from public.files f where f.entity_type = 'brief_delivery' and f.entity_id = d.id::text)) order by d.round desc), '[]'::jsonb)
    from public.brief_deliveries d where d.brief_id = p_brief and d.status = 'sent');
end $$;
grant execute on function public.client_creative_deliveries(uuid) to authenticated;

-- Clients may open the files of a delivery once it has been sent to them (as for proofs).
create or replace function public.file_content(p_id uuid)
returns table (file_name text, content_type text, content_b64 text, storage_path text)
language sql stable security definer set search_path = public as $$
  select f.file_name, f.content_type, encode(f.content, 'base64'), f.storage_path from public.files f
  where f.id = p_id and (public.is_internal() or (f.supplier_id is not null and f.supplier_id = public.my_supplier_id())
    or exists (select 1 from public.po_proofs pr join public.purchase_orders po on po.id = pr.po_id join public.jobs j on j.id = po.job_id
                where f.entity_type = 'po_proof' and f.entity_id = pr.id::text and pr.sent_to_client_at is not null
                  and j.client_id in (select public.my_client_ids()))
    or exists (select 1 from public.brief_deliveries d join public.briefs b on b.id = d.brief_id
                where f.entity_type = 'brief_delivery' and f.entity_id = d.id::text and d.status = 'sent'
                  and public._brief_client(b) in (select public.my_client_ids())));
$$;
