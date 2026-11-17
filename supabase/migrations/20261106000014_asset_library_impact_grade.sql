-- Impact Grade in the Shopper IQ asset library. An asset (art, render, in-store image, playbook) can be linked to the spec it shows,
-- and the library then carries that spec's grade: score, letter, confidence, range and whether it has been reviewed.

alter table public.siq_assets add column spec_id uuid references public.job_specs(id) on delete set null;
create index siq_assets_spec_idx on public.siq_assets (spec_id);

-- Link an asset to a spec, or unlink it (null). Internal staff only; the link is recorded in the CRM-style audit via the asset's own row.
create or replace function public.siq_asset_link_spec(p_asset uuid, p_spec uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_internal() then raise exception 'Only staff can link an asset to a spec' using errcode = '42501'; end if;
  if not exists (select 1 from public.siq_assets where id = p_asset) then raise exception 'Asset not found'; end if;
  if p_spec is not null and not exists (select 1 from public.job_specs where id = p_spec) then raise exception 'Spec not found'; end if;
  update public.siq_assets set spec_id = p_spec where id = p_asset;
end $$;
grant execute on function public.siq_asset_link_spec(uuid, uuid) to authenticated;

-- The library view, now with the linked spec and its Impact Grade.
drop view if exists public.siq_assets_available;
drop view if exists public.siq_assets_v;
create view public.siq_assets_v with (security_invoker = true) as
  select a.*, c.name as campaign_name, c.client, tp.name as touchpoint_name, st.name as p2p_stage_name,
    public.siq_asset_can_signoff(a.id) as can_signoff,
    sp.title as spec_title, jb.job_number as spec_job_number,
    ig.score as ig_score, ig.letter as ig_letter, ig.confidence as ig_confidence, ig.range_low as ig_range_low, ig.range_high as ig_range_high,
    ig.review_status as ig_review_status
  from public.siq_assets a
  left join public.campaigns c on c.id = a.campaign_id
  left join public.library_records tp on tp.id = a.touchpoint_id
  left join public.library_records st on st.id = a.p2p_stage_id
  left join public.job_specs sp on sp.id = a.spec_id
  left join public.jobs jb on jb.id = sp.job_id
  left join public.impact_grade_records ig on ig.subject_kind = 'spec' and ig.subject_id = a.spec_id;
-- What Briefing+ may reuse: assets with a rights/brand sign-off.
create view public.siq_assets_available with (security_invoker = true) as
  select * from public.siq_assets_v where rights_status = 'approved';
revoke insert, update, delete on public.siq_assets_v, public.siq_assets_available from authenticated, anon;
