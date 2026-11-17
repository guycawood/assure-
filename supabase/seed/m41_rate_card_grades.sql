-- Demo grades for the seeded rate cards, already reviewed so they can be chosen. In a live system each card is graded
-- from Sourcing > Rate cards and reviewed by a second person.
insert into public.rate_card_grades (card_id, score, letter, coverage, confidence, range_low, range_high, supplier_score, inputs, tiers, sub_scores, warnings, review_status, reviewed_at, review_note)
select r.id, v.score, v.letter, 71.0, v.conf, v.score - 6, v.score + 6, 70, '{"basis":{"demo":true}}'::jsonb, '{}'::jsonb, '[]'::jsonb,
       '["Demo grade: recalculate from Sourcing > Rate cards"]'::jsonb, 'reviewed', now(), 'Demo data'
  from (values ('RC-NBW-A2', 68.0, 'B', 45), ('RC-A1-POSTER', 61.0, 'C', 45), ('RC-CLING-1000', 42.0, 'D', 40), ('RC-WOBBLER', 72.0, 'B', 45)) as v(code, score, letter, conf)
  join public.library_records r on r.library_key = 'rate_cards' and r.code = v.code
on conflict (card_id) do nothing;
