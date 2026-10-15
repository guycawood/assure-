-- Demo-only additions for the product taxonomy and AAC rules (dummy data). The reference tree, starter aliases and
-- default AAC rules are in migrations 20261032000001/2 because production needs them.
-- This file runs before the module seeds that insert specs; specs are classified by the job_specs trigger as they
-- are inserted, so the aliases below take effect for them.

-- Demo aliases with their source systems (terms seen in the demo jobs and in other systems' exports).
insert into public.tax_aliases (alias, category_id, subcategory_id, product_type_id, source_system, source_reference)
select a.alias,
       case when a.sc is null then c.id end,
       case when a.sc is not null and a.pc is null then s.id end,
       p.id, a.src, a.ref
  from (values
    ('Ribbon and tag', 'Packaging', 'GIFT', 'WRAP', 'RIBBON', 'Sourcing Hub', 'Demo spec sub-type'),
    ('Back-bar', 'POS & Display', 'PERM', 'FIXTURE', 'BACKBAR', 'Indicia', 'Demo glossary'),
    ('Thekenaufsteller', 'POS & Display', 'COUNTER', 'CDU', null, 'Indicia', 'German term (demo)'),
    ('Kệ trưng bày', 'POS & Display', 'FLOOR', 'FSDU', null, 'ADM', 'Vietnamese term (demo)'),
    ('Shelf strips', 'POS & Display', 'COUNTER', 'SHELF', 'STRIP', 'Stocktool', 'Demo stock line'),
    ('Window graphics', 'Print', 'LGF', 'WINWALL', 'WINGRAPHIC', 'Airtable', 'Demo base')
  ) a(alias, ft, cc, sc, pc, src, ref)
  join public.tax_categories c on c.form_type = a.ft and c.code = a.cc
  left join public.tax_subcategories s on s.category_id = c.id and s.code = a.sc
  left join public.tax_product_types p on p.subcategory_id = s.id and p.code = a.pc
 where not exists (select 1 from public.tax_aliases x where x.active and x.alias_norm = public._tax_norm(a.alias));

-- Demo mapping queue: values from other systems' exports, waiting for an admin.
insert into public.tax_mappings (source_system, source_form_type, source_category, source_subcategory, source_product_type,
  category_id, subcategory_id, product_type_id, status, confidence, match_basis, occurrences, source_reference)
select m.src, m.ft, m.cat, m.sub, m.pt, c.id, s.id, p.id, m.status, m.conf, m.basis, m.n, m.ref
  from (values
    ('Stocktool', null, 'POS', 'Floor', 'Corr. FSDU 4 shelf', 'POS & Display', 'FLOOR', 'FSDU', 'CORRFSDU', 'Suggested', 0.69, 'similar words: "Corrugated FSDU"', 14, 'Stocktool article group export (demo)'),
    ('Stocktool', null, 'Merch', null, 'Mug 11oz ceramic', 'Merchandise', 'DRINK', 'DRINKWARE', 'MUG', 'Suggested', 0.6, 'similar words: "Ceramic mug"', 9, 'Stocktool article group export (demo)'),
    ('Airtable', 'POS & Display', 'In-store', null, 'Ceiling dangler', 'POS & Display', 'WINDOW', 'WINDISP', 'CEILING', 'Pending review', 0.7, 'contains: "Dangler"', 5, 'Airtable POSM base (demo)'),
    ('Indicia', null, 'Print', null, 'Flyer A5 2pp', 'Print', 'LIT', 'LEAFLET', 'FLYER', 'Suggested', 0.7, 'contains: "Flyer"', 22, 'Indicia job sheet (demo)'),
    ('ADM', null, 'Promo', null, 'Mystery box', null, null, null, null, 'Unmapped', 0, null, 3, 'ADM legacy list (demo)')
  ) m(src, ft, cat, sub, pt, tft, tcc, tsc, tpc, status, conf, basis, n, ref)
  left join public.tax_categories c on c.form_type = m.tft and c.code = m.tcc
  left join public.tax_subcategories s on s.category_id = c.id and s.code = m.tsc
  left join public.tax_product_types p on p.subcategory_id = s.id and p.code = m.tpc
on conflict (source_system, source_key) do nothing;

-- A scoped AAC rule waiting for a second person (maker-checker demo): a wider band for shelf media.
insert into public.library_records (library_key, code, name, data, status, effective_from, notes)
select 'aac_classification_rules', 'AAC-ADAPT-SHELF', 'Adapt: wider band for shelf media',
  jsonb_build_object('route', 'adapt', 'priority', 100, 'tolerance_percent', 15,
    'scope_form_type', 'POS & Display', 'scope_category_code', 'COUNTER', 'scope_subcategory_code', 'SHELF',
    'definition', 'Shelf media (wobblers, strips, talkers) price reliably from the card a little further from the card size.',
    'note', 'Demo: proposed by the category team, waiting for approval.'),
  'pending_approval', current_date, 'Demo rule'
where not exists (select 1 from public.library_records where library_key = 'aac_classification_rules' and code = 'AAC-ADAPT-SHELF');

-- Existing demo databases: classify specs again now the demo aliases exist.
select public._tax_backfill_specs();
