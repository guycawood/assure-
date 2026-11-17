-- HS code rules (master Watchtower libraries): an HS code attached to a combination of product, sub-product and the material used.
-- Until now a product type carried one default HS code, whatever the spec was made of. A rule can now say, for example,
-- "window graphics in vinyl are 3919.90; in paper 4911.91". Same scoping idea as the AAC rules: the most specific active
-- rule that fits the spec wins. A spec's own HS code is never overwritten; this only suggests one.
--
-- Scope (all optional, blank = any): form type, category (product), subcategory (sub-product), product type, and material:
-- a material type (paper, board, vinyl...) or a specific substrate code. A rule with a material matches when the spec uses
-- that material in any non-packaging component (or as its single substrate).
-- Specificity: product type 4, subcategory 3, category 2, form type 1, then a specific substrate +2 or a material type +1.

insert into public.library_definitions (key, module, label, description, requires_approval, sort) values
  ('hs_code_rules', 'watchtower', 'HS code rules',
   'The customs HS code for a combination of product, sub-product and material used in the spec. The most specific active rule that fits the spec is suggested; the spec''s own HS code always wins. A product type''s default HS code is the fallback.',
   true, 26)
on conflict (key) do nothing;

create or replace function public._hs_specificity(d jsonb) returns int language sql immutable as $$
  select (case when nullif(trim(d->>'scope_product_type_code'), '') is not null then 4
               when nullif(trim(d->>'scope_subcategory_code'), '') is not null then 3
               when nullif(trim(d->>'scope_category_code'), '') is not null then 2
               when nullif(trim(d->>'scope_form_type'), '') is not null then 1 else 0 end) * 10
       + case when nullif(trim(d->>'material_code'), '') is not null then 2
              when nullif(trim(d->>'material_type'), '') is not null then 1 else 0 end;
$$;

-- The HS code for a spec: the best rule, else the product type's default, else nothing. For the spec page and the recompute.
create or replace function public.hs_code_resolve(p_spec uuid, p_date date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.library_records; v_default text; v_default_name text;
begin
  if not public.is_internal() then raise exception 'Only staff can see HS code rules' using errcode = '42501'; end if;
  select r2.* into r
    from public.library_records r2
    join public.job_specs sp on sp.id = p_spec
    left join public.tax_categories c on c.id = sp.tax_category_id
    left join public.tax_subcategories sc on sc.id = sp.tax_subcategory_id
    left join public.tax_product_types pt on pt.id = sp.tax_product_type_id
   where r2.library_key = 'hs_code_rules' and r2.status = 'active'
     and r2.effective_from <= p_date and (r2.effective_to is null or r2.effective_to >= p_date)
     and nullif(trim(r2.data->>'hs_code'), '') is not null
     and (nullif(trim(r2.data->>'scope_form_type'), '') is null or r2.data->>'scope_form_type' = sp.tax_form_type)
     and (nullif(trim(r2.data->>'scope_category_code'), '') is null or upper(trim(r2.data->>'scope_category_code')) = upper(c.code))
     and (nullif(trim(r2.data->>'scope_subcategory_code'), '') is null or upper(trim(r2.data->>'scope_subcategory_code')) = upper(sc.code))
     and (nullif(trim(r2.data->>'scope_product_type_code'), '') is null or upper(trim(r2.data->>'scope_product_type_code')) = upper(pt.code))
     and (
       (nullif(trim(r2.data->>'material_code'), '') is null and nullif(trim(r2.data->>'material_type'), '') is null)
       or exists (
         select 1
           from (select substrate_id from public.spec_components where spec_id = p_spec and not coalesce(is_packaging, false) and substrate_id is not null
                 union select substrate_id from public.job_specs where id = p_spec and substrate_id is not null) m
           join public.library_records s on s.id = m.substrate_id
          where (nullif(trim(r2.data->>'material_code'), '') is null or upper(s.code) = upper(trim(r2.data->>'material_code')))
            and (nullif(trim(r2.data->>'material_type'), '') is null or lower(s.data->>'substrate_type') = lower(trim(r2.data->>'material_type')))
       ))
   order by public._hs_specificity(r2.data) desc, coalesce(nullif(r2.data->>'priority', '')::int, 100), r2.effective_from desc, r2.version desc
   limit 1;
  if r.id is not null then
    return jsonb_build_object('hs_code', trim(r.data->>'hs_code'), 'basis', 'rule', 'rule_id', r.id, 'rule_code', r.code, 'rule_name', r.name);
  end if;
  select pt.default_hs_code, pt.name into v_default, v_default_name
    from public.job_specs sp join public.tax_product_types pt on pt.id = sp.tax_product_type_id where sp.id = p_spec;
  if v_default is not null then
    return jsonb_build_object('hs_code', v_default, 'basis', 'product_default', 'rule_name', v_default_name);
  end if;
  return jsonb_build_object('hs_code', null, 'basis', null);
end $$;

revoke execute on function public._hs_specificity(jsonb), public.hs_code_resolve(uuid, date) from public, anon;
grant execute on function public._hs_specificity(jsonb), public.hs_code_resolve(uuid, date) to authenticated;

-- Illustrative starting rules (generic; confirm with customs before relying on them).
insert into public.library_records (library_key, code, name, data, status, effective_from, effective_to, notes) values
  ('hs_code_rules', 'HS-BANNER-TEXTILE', 'Banners and flags in textile',
   jsonb_build_object('scope_form_type', 'Print', 'scope_category_code', 'LGF', 'scope_subcategory_code', 'BANNER', 'material_type', 'textile', 'hs_code', '6307.90', 'priority', 100,
     'note', 'Illustrative: textile banners are made-up textile articles.'), 'active', '2026-01-01', null, 'Seeded example'),
  ('hs_code_rules', 'HS-BANNER-VINYL', 'Banners and flags in vinyl',
   jsonb_build_object('scope_form_type', 'Print', 'scope_category_code', 'LGF', 'scope_subcategory_code', 'BANNER', 'material_type', 'vinyl', 'hs_code', '3926.90', 'priority', 100,
     'note', 'Illustrative: vinyl banners are articles of plastics.'), 'active', '2026-01-01', null, 'Seeded example'),
  ('hs_code_rules', 'HS-WINWALL-VINYL', 'Window and wall graphics in vinyl',
   jsonb_build_object('scope_form_type', 'Print', 'scope_category_code', 'LGF', 'scope_subcategory_code', 'WINWALL', 'material_type', 'vinyl', 'hs_code', '3919.90', 'priority', 100,
     'note', 'Illustrative: self-adhesive plastic sheet.'), 'active', '2026-01-01', null, 'Seeded example'),
  ('hs_code_rules', 'HS-WINWALL-PAPER', 'Window and wall graphics in paper',
   jsonb_build_object('scope_form_type', 'Print', 'scope_category_code', 'LGF', 'scope_subcategory_code', 'WINWALL', 'material_type', 'paper', 'hs_code', '4911.91', 'priority', 100,
     'note', 'Illustrative: printed pictures and designs on paper.'), 'active', '2026-01-01', null, 'Seeded example');
