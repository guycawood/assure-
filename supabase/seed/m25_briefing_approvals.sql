-- DUMMY DATA: Briefing+ concept approvals (runs after m20_briefing). Ideation sessions with concepts in every approval
-- state: waiting for approval (one overdue), approved and waiting for the Heineken client approver, proposed, a high-budget
-- concept that needs the Procurement head, and campaign ideation concepts (one approved, ready to become briefs).
-- People are matched by email: directly when the profiles already exist, otherwise when the demo users are created
-- (concept_approvals is append-only, so its demo rows keep a blank actor on a fresh build).

create table if not exists public._demo_concept_people (concept_name text primary key, submitted_email text, decided_email text, author_email text);
alter table public._demo_concept_people enable row level security;
revoke all on public._demo_concept_people from authenticated, anon;
insert into public._demo_concept_people values
  ('Shelf-ready gondola tray', 'pedro.procurement@adm-indicia.com', null, 'pedro.procurement@adm-indicia.com'),
  ('Corrugated gondola end with QR header', 'pedro.procurement@adm-indicia.com', 'lena.lead@adm-indicia.com', 'pedro.procurement@adm-indicia.com'),
  ('Modular board display', null, null, 'pedro.procurement@adm-indicia.com'),
  ('Condensation-proof freezer topper', 'lena.lead@adm-indicia.com', null, 'lena.lead@adm-indicia.com'),
  ('Chiller door wrap', 'arjun.agent@adm-indicia.com', 'hana.head@adm-indicia.com', 'arjun.agent@adm-indicia.com'),
  ('Bar runner and coaster kit', 'arjun.agent@adm-indicia.com', null, 'arjun.agent@adm-indicia.com')
on conflict (concept_name) do nothing;

create or replace function public._demo_person(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where lower(email) = lower(p_email) limit 1;
$$;
revoke execute on function public._demo_person(text) from public, anon, authenticated;

do $$
declare v_s uuid; v_m bigint; b public.briefs; v_c uuid;
begin
  if exists (select 1 from public.ideation_concepts where name = 'Shelf-ready gondola tray') then return; end if;

  -- BR-2026-00001 (Heineken GB, approved brief): three concepts.
  select * into b from public.briefs where brief_code = 'BR-2026-00001';
  if b.id is not null then
    insert into public.ideation_sessions (kind, brief_id, context, creative_params, created_by, created_at)
    values ('brief', b.id, jsonb_build_object('client', b.client, 'brand', b.brand, 'market', b.market),
            '{"innovation":"balanced","sustainability":"high","budget":"respect"}', public._demo_person('pedro.procurement@adm-indicia.com'), now() - interval '6 days')
    returning id into v_s;
    insert into public.ideation_messages (session_id, role, content, model, prompt_version, demo, created_at)
    values (v_s, 'assistant', 'Three buildable directions for the Heineken 0.0 gondola end, all board-first and tool-free.', 'demo-rules', 'brief-ideation/v1', true, now() - interval '6 days')
    returning id into v_m;
    insert into public.ideation_concepts (session_id, message_id, brief_id, kind, idx, is_top, name, data, model, prompt_version, demo, created_at,
      status, submitted_by, submitted_at, submit_note, decided_by, decided_at, decision_comments, client_approval_required, client_status)
    values
      (v_s, v_m, b.id, 'spec_concept', 0, true, 'Shelf-ready gondola tray',
       '{"name":"Shelf-ready gondola tray","suggested_spec_type":"3d","creative_direction":"Shelf-ready trays in recycled board that drop straight onto the gondola, with the tournament creative on the header.","suggested_substrate_name":"Folding box board 350gsm (recycled)","suggested_length":1200,"suggested_width":400,"suggested_depth":1800,"suggested_unit":"mm","fit_score":84,"indicative_unit_price":38.5,"price_currency":"GBP","indicative_quantity":50,"indicative_total":1925,"price_basis":"Demo rate card","rationale":"Fast to build and fully recyclable.","risks":["Header weight on the top tray"]}',
       'demo-rules', 'brief-ideation/v1', true, now() - interval '6 days',
       'submitted_for_approval', public._demo_person('pedro.procurement@adm-indicia.com'), now() - interval '4 days', 'Our preferred direction for the trial stores.', null, null, null, true, 'not_required'),
      (v_s, v_m, b.id, 'spec_concept', 1, false, 'Corrugated gondola end with QR header',
       '{"name":"Corrugated gondola end with QR header","suggested_spec_type":"3d","creative_direction":"A corrugated gondola end holding 4-packs and 10-packs, with a QR header linking to the match-day promotion.","suggested_substrate_name":"Corrugated board E/B flute (kraft)","suggested_length":1250,"suggested_width":600,"suggested_depth":1900,"suggested_unit":"mm","fit_score":79,"indicative_unit_price":52,"price_currency":"GBP","indicative_quantity":50,"indicative_total":2600,"price_basis":"Demo rate card","rationale":"Holds both pack sizes and survives six weeks."}',
       'demo-rules', 'brief-ideation/v1', true, now() - interval '6 days',
       'approved', public._demo_person('pedro.procurement@adm-indicia.com'), now() - interval '3 days', null,
       public._demo_person('lena.lead@adm-indicia.com'), now() - interval '2 days', 'Approved. Over to Heineken for sign-off.', true, 'pending'),
      (v_s, v_m, b.id, 'spec_concept', 2, false, 'Modular board display',
       '{"name":"Modular board display","suggested_spec_type":"3d","creative_direction":"Modular board cubes that stack to fit any gondola height.","suggested_substrate_name":"Solid bleached board 300gsm","fit_score":68,"rationale":"Flexible but slower to build."}',
       'demo-rules', 'brief-ideation/v1', true, now() - interval '6 days',
       'proposed', null, null, null, null, null, null, false, 'not_required');
    for v_c in select id from public.ideation_concepts where session_id = v_s and status <> 'proposed' loop
      insert into public.concept_approvals (concept_id, brief_id, stage, action, comments, actor, at)
      select c.id, c.brief_id, 'internal', 'submitted', c.submit_note, c.submitted_by, c.submitted_at from public.ideation_concepts c where c.id = v_c;
      insert into public.concept_approvals (concept_id, brief_id, stage, action, comments, actor, at)
      select c.id, c.brief_id, 'internal', 'approved', c.decision_comments, c.decided_by, c.decided_at from public.ideation_concepts c where c.id = v_c and c.status = 'approved';
    end loop;
    insert into public.brief_events (brief_id, event, from_status, to_status, note, actor, at) values
      (b.id, 'concept_submitted', 'in_ideation', 'in_ideation', 'Shelf-ready gondola tray', public._demo_person('pedro.procurement@adm-indicia.com'), now() - interval '4 days'),
      (b.id, 'concept_submitted', 'in_ideation', 'in_ideation', 'Corrugated gondola end with QR header', public._demo_person('pedro.procurement@adm-indicia.com'), now() - interval '3 days'),
      (b.id, 'concept_approved', 'in_ideation', 'in_ideation', 'Corrugated gondola end with QR header', public._demo_person('lena.lead@adm-indicia.com'), now() - interval '2 days');
  end if;

  -- BR-2026-00005 (Magnum Italy, top budget 45,000): a concept that needs the Procurement head (AP-CONCEPT-HIGH).
  select * into b from public.briefs where brief_code = 'BR-2026-00005';
  if b.id is not null then
    insert into public.ideation_sessions (kind, brief_id, context, creative_params, created_by, created_at)
    values ('brief', b.id, jsonb_build_object('client', b.client, 'brand', b.brand, 'market', b.market), '{}', public._demo_person('lena.lead@adm-indicia.com'), now() - interval '2 days')
    returning id into v_s;
    insert into public.ideation_messages (session_id, role, content, model, prompt_version, demo, created_at)
    values (v_s, 'assistant', 'A freezer topper that copes with condensation and keeps the gold finish.', 'demo-rules', 'brief-ideation/v1', true, now() - interval '2 days')
    returning id into v_m;
    insert into public.ideation_concepts (session_id, message_id, brief_id, kind, idx, is_top, name, data, model, prompt_version, demo, created_at,
      status, submitted_by, submitted_at, client_approval_required, client_status)
    values (v_s, v_m, b.id, 'spec_concept', 0, true, 'Condensation-proof freezer topper',
      '{"name":"Condensation-proof freezer topper","suggested_spec_type":"2d","creative_direction":"Gold-finish topper on a moisture-resistant board with a recyclable film face.","suggested_substrate_name":"Corrugated board E/B flute (kraft)","fit_score":81,"rationale":"30% less plastic than last year."}',
      'demo-rules', 'brief-ideation/v1', true, now() - interval '2 days',
      'submitted_for_approval', public._demo_person('lena.lead@adm-indicia.com'), now() - interval '1 day', false, 'not_required')
    returning id into v_c;
    insert into public.concept_approvals (concept_id, brief_id, stage, action, actor, at)
    values (v_c, b.id, 'internal', 'submitted', public._demo_person('lena.lead@adm-indicia.com'), now() - interval '1 day');
  end if;

  -- Campaign ideation (Heineken): one approved product type ready to become briefs, one waiting for approval.
  insert into public.ideation_sessions (kind, objective, context, creative_params, created_by, created_at)
  values ('campaign', 'Drive trial of Heineken 0.0 in bars and convenience stores this winter.', '{"client":"Heineken","brand":"Heineken 0.0","division":"Beer"}', '{}',
          public._demo_person('arjun.agent@adm-indicia.com'), now() - interval '5 days')
  returning id into v_s;
  insert into public.ideation_messages (session_id, role, content, model, prompt_version, demo, created_at)
  values (v_s, 'assistant', 'Two product types that suit a winter trial push.', 'demo-rules', 'campaign-ideation/v1', true, now() - interval '5 days')
  returning id into v_m;
  insert into public.ideation_concepts (session_id, message_id, brief_id, kind, idx, is_top, name, data, model, prompt_version, demo, created_at,
    status, submitted_by, submitted_at, decided_by, decided_at, decision_comments)
  values
    (v_s, v_m, null, 'product_type', 0, true, 'Chiller door wrap',
     '{"product_type_name":"Chiller door wrap","suggested_spec_type":"2d","rationale":"Highly visible at the point of choice in convenience stores.","client_history_match":true}',
     'demo-rules', 'campaign-ideation/v1', true, now() - interval '5 days',
     'approved', public._demo_person('arjun.agent@adm-indicia.com'), now() - interval '4 days', public._demo_person('hana.head@adm-indicia.com'), now() - interval '3 days', 'Go ahead for GB and NL.'),
    (v_s, v_m, null, 'product_type', 1, false, 'Bar runner and coaster kit',
     '{"product_type_name":"Bar runner and coaster kit","suggested_spec_type":"promo_merch","rationale":"Cheap, high-frequency on-trade visibility.","client_history_match":false}',
     'demo-rules', 'campaign-ideation/v1', true, now() - interval '5 days',
     'submitted_for_approval', public._demo_person('arjun.agent@adm-indicia.com'), now() - interval '1 day', null, null, null);
  insert into public.concept_approvals (concept_id, stage, action, comments, actor, at)
  select c.id, 'internal', 'submitted', null, c.submitted_by, c.submitted_at from public.ideation_concepts c where c.session_id = v_s
  union all
  select c.id, 'internal', 'approved', c.decision_comments, c.decided_by, c.decided_at from public.ideation_concepts c where c.session_id = v_s and c.status = 'approved';
end $$;

-- Fill in people when the demo users are created (fresh demo database).
create or replace function public._demo_concept_claim() returns trigger
language plpgsql security definer set search_path = public as $$
declare e text := lower(new.email);
begin
  update public.ideation_concepts c set submitted_by = new.id from public._demo_concept_people p
   where p.concept_name = c.name and lower(p.submitted_email) = e and c.submitted_by is null and c.submitted_at is not null;
  update public.ideation_concepts c set decided_by = new.id from public._demo_concept_people p
   where p.concept_name = c.name and lower(p.decided_email) = e and c.decided_by is null and c.decided_at is not null;
  update public.ideation_concepts c set created_by = new.id from public._demo_concept_people p
   where p.concept_name = c.name and lower(p.author_email) = e and c.created_by is null;
  update public.ideation_sessions s set created_by = new.id from public.ideation_concepts c, public._demo_concept_people p
   where c.session_id = s.id and p.concept_name = c.name and lower(p.author_email) = e and s.created_by is null;
  -- concept_approvals is append-only (no updates), so its demo rows keep a blank actor on a fresh demo database.
  update public.brief_events v set actor = new.id from public._demo_concept_people p
   where v.event in ('concept_submitted','concept_approved') and v.note = p.concept_name and v.actor is null
     and ((v.event = 'concept_submitted' and lower(p.submitted_email) = e) or (v.event = 'concept_approved' and lower(p.decided_email) = e));
  return new;
end $$;
drop trigger if exists demo_concept_claim on public.profiles;
create trigger demo_concept_claim after insert on public.profiles for each row execute function public._demo_concept_claim();
