-- DUMMY DATA: unit weights for demo specs that have none, so the conscious ordering dashboard can show material
-- (kg) alongside cost and CO2e. Made-up, plausible weights by product type; real specs carry their own.
select set_config('sourcing.system_write', 'on', false);

update public.job_specs s
   set unit_weight_grams = case s.spec_type
         when '2d' then 20 + abs(hashtext(s.id::text)) % 280              -- print: 20 to 300 g
         when '3d' then 1500 + abs(hashtext(s.id::text)) % 16500          -- displays: 1.5 to 18 kg
         when 'promo_merch' then 40 + abs(hashtext(s.id::text)) % 560     -- merchandise: 40 to 600 g
         when 'custom_goods_services' then 100 + abs(hashtext(s.id::text)) % 1900
       end,
       weight_basis = 'estimated'
 where s.unit_weight_grams is null and s.spec_type <> 'design'
   and exists (select 1 from public.estimate_lines el where el.spec_id = s.id);

select set_config('sourcing.system_write', 'off', false);
