-- Shopper IQ design effectiveness, step 1: the model as a Watchtower, built the same way as Impact Grade.
--
-- "ShopperIQ Design Effectiveness Model v1" (draft 30 Oct 2026, from RetailGrade - Design 2025 and Alexia Michel's
-- criteria) becomes governed libraries: 27 design and 11 sustainability criteria with weights and asset-type
-- applicability, the answer scale, the sustainability weight and coverage rule, the score bands, the asset types,
-- the open items and the workbook's worked example. The scoring is src/lib/design-effectiveness.ts and reads only
-- these libraries. Records are seeded from supabase/seed/m33_shopper_iq_design.sql (generated from the workbook).
--
-- Link to sustainability: criterion S11 "Measured footprint" is scored from the Impact Grade (0-100 ÷ 100), which
-- the Impact Grade Watchtower builds from the PEF score. Saving scorecards against assets and specs is step 2.

insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('siq_de_criteria', 'shopper-iq', 'Design effectiveness criteria', 'The 38 criteria (design: Attract, Engage, Sell; sustainability) with weights and which asset types each applies to. S11 is scored from the Impact Grade.', true, 10),
  ('siq_de_parameters', 'shopper-iq', 'Design effectiveness parameters', 'Sustainability weight (w) in the overall score, the minimum coverage for a valid score, and the visual elements threshold.', true, 11),
  ('siq_de_answers', 'shopper-iq', 'Answer scale', 'What each answer is worth (Yes, Partial, No) and which answers leave the denominator (N/A, Unknown).', true, 12),
  ('siq_de_bands', 'shopper-iq', 'Effectiveness bands', 'Overall effectiveness to band (Needs work, Fair, Good, Excellent) by lower bound. Proposed, not yet confirmed.', true, 13),
  ('siq_de_asset_types', 'shopper-iq', 'Design asset types', 'The asset types the scorecard covers (Key Visual, POSM, GWP & Premiums).', true, 14),
  ('siq_de_open_items', 'shopper-iq', 'Design model open items', 'Decisions and gaps to close before the model is calibrated and approved.', false, 15),
  ('siq_de_examples', 'shopper-iq', 'Design worked examples', 'The worked example from the workbook with the results Excel gives. The Watchtower recalculates it to prove the system matches.', true, 16)
on conflict (key) do nothing;

-- Watchtower health for the design model.
create or replace view public.watchtower_health_shopper_iq with (security_invoker = true) as
  with open_items as (select count(*)::numeric n from public.library_records
                       where library_key = 'siq_de_open_items' and status = 'active' and coalesce(data->>'status', 'open') not in ('decided', 'resolved', 'closed')),
  bands as (select count(*)::numeric n from public.library_records
             where library_key = 'siq_de_bands' and status = 'active' and coalesce((data->>'confirmed')::boolean, false) = false),
  uncal as (select count(*)::numeric n from public.library_records
             where library_key = 'siq_de_criteria' and status = 'active' and coalesce((data->>'calibrated')::boolean, false) = false),
  pend as (select count(*)::numeric n from public.library_records r join public.library_definitions d on d.key = r.library_key
            where d.module = 'shopper-iq' and r.status = 'pending_approval')
  select * from (
  select 'shopper-iq'::text as module, 'de_open_items'::text as metric, 'Design model open items'::text as label, open_items.n as value, 0::numeric as target,
         case when open_items.n = 0 then 'ok' when open_items.n <= 3 then 'warn' else 'bad' end as status from open_items
  union all select 'shopper-iq', 'de_weights_uncalibrated', 'Criteria weights not yet calibrated', uncal.n, 0, case when uncal.n = 0 then 'ok' else 'warn' end from uncal
  union all select 'shopper-iq', 'de_bands_unconfirmed', 'Effectiveness bands not yet confirmed', bands.n, 0, case when bands.n = 0 then 'ok' else 'warn' end from bands
  union all select 'shopper-iq', 'de_changes_awaiting_approval', 'Model changes awaiting approval', pend.n, 0, case when pend.n = 0 then 'ok' else 'warn' end from pend
  ) h where public.is_internal();
grant select on public.watchtower_health_shopper_iq to authenticated;
