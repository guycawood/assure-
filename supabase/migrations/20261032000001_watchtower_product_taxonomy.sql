-- Product taxonomy master (master Watchtower → Taxonomy), phase 1. Spec: docs/PRODUCT_TAXONOMY_SPEC.md.
--   1. tax_categories (under a fixed form type) → tax_subcategories → tax_product_types (leaf, default HS code).
--      Codes are unique within their parent; the full path is enforced with composite foreign keys.
--   2. tax_aliases (historic / local / misspelled terms, exactly one target node), tax_mappings (cross-system review
--      queue, admins only), tax_audit (append-only, shared by the taxonomy domains Product / Client / Finance /
--      Geography / DOA, plain-language descriptions).
--   3. Reads: every signed-in user (mappings: admins only). Writes: admin security-definer functions that audit in the
--      same transaction. Direct writes are revoked.
--   4. Reference tree (production needs it): a generic starter tree for adm Indicia's world. The Base44 prototype has the
--      entity shapes but no seed data; its Custom Goods & Services product list and spec-type → form-type map are used.
--   5. job_specs gains tax_form_type / tax_category_id / tax_subcategory_id / tax_product_type_id plus display names.
--      A trigger keeps the path consistent, refreshes names, classifies new or unclassified specs from their free text
--      (alias → name → code, then whole-phrase containment) and seeds the spec HS code from the product type default
--      when a person (or an admin) picks the product type and the spec has none. The spec's own HS code always wins.
--      Existing specs are backfilled the same way; unresolved rows stay null and are listed in the admin UI.
--   6. v_spec_taxonomy: spec → taxonomy path, for joining onto rpt_spec_lines (spec_id) in reporting.
-- Safe on existing data: new columns are nullable; existing columns are untouched.

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.tax_form_types() returns text[] language sql immutable as $$
  select array['Print','Packaging','POS & Display','Creative & Design','Logistics','Merchandise','Digital',
               'Custom Goods & Services','2D/3D','Stocktool only']::text[];
$$;

create or replace function public.tax_source_systems() returns text[] language sql immutable as $$
  select array['ADM','Indicia','Stocktool','Airtable','Sourcing Hub']::text[];
$$;

-- Normalised matching key: lower case, punctuation as spaces, simple singular ("displays" = "display", "boxes" = "box").
create or replace function public._tax_norm(p text) returns text language sql immutable parallel safe as $$
  select nullif(string_agg(case
      when w ~ '[^aeiou]ies$' and length(w) > 4 then left(w, -3) || 'y'
      when w ~ '(x|ch|sh|ss|zz)es$' then left(w, -2)
      when w ~ '[^su]s$' and length(w) > 3 then left(w, -1)
      else w end, ' ' order by n), '')
  from regexp_split_to_table(trim(regexp_replace(lower(coalesce(p, '')), '[[:space:][:punct:]]+', ' ', 'g')), ' ') with ordinality as x(w, n)
  where w <> '';
$$;

-- Sourcing Hub spec type → form type (from the prototype's SPEC_TYPE_TO_FORM_TYPE).
create or replace function public._tax_spec_form_type(p_spec_type text) returns text language sql immutable as $$
  select case p_spec_type when '2d' then 'Print' when '3d' then 'POS & Display' when 'promo_merch' then 'Merchandise'
    when 'design' then 'Creative & Design' when 'custom_goods_services' then 'Custom Goods & Services' end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.tax_categories (
  id uuid primary key default gen_random_uuid(),
  form_type text not null check (form_type = any (public.tax_form_types())),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'),
  name text not null check (length(trim(name)) > 0),
  name_norm text generated always as (public._tax_norm(name)) stored,
  description text,
  active boolean not null default true,
  display_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (form_type, code),
  unique (id, form_type)
);
create unique index tax_categories_name_uq on public.tax_categories (form_type, lower(name));

create table public.tax_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.tax_categories(id),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'),
  name text not null check (length(trim(name)) > 0),
  name_norm text generated always as (public._tax_norm(name)) stored,
  description text,
  active boolean not null default true,
  display_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (category_id, code),
  unique (id, category_id)
);
create unique index tax_subcategories_name_uq on public.tax_subcategories (category_id, lower(name));

create table public.tax_product_types (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null,
  subcategory_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'),
  name text not null check (length(trim(name)) > 0),
  name_norm text generated always as (public._tax_norm(name)) stored,
  -- A starting value only: specs inherit it and override it where the material differs. Customs documents read the
  -- spec's HS code, never this one.
  default_hs_code text check (default_hs_code ~ '^[0-9]{4}([.]?[0-9]{2}){0,3}$'),
  description text,
  active boolean not null default true,
  display_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (subcategory_id, code),
  unique (id, subcategory_id),
  -- The product type's category is always its subcategory's category (moves cascade).
  foreign key (subcategory_id, category_id) references public.tax_subcategories (id, category_id) on update cascade
);
create unique index tax_product_types_name_uq on public.tax_product_types (subcategory_id, lower(name));
create index tax_product_types_cat_idx on public.tax_product_types (category_id);

create table public.tax_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null check (length(trim(alias)) > 0),
  alias_norm text generated always as (public._tax_norm(alias)) stored,
  category_id uuid references public.tax_categories(id) on delete cascade,
  subcategory_id uuid references public.tax_subcategories(id) on delete cascade,
  product_type_id uuid references public.tax_product_types(id) on delete cascade,
  source_system text check (source_system is null or source_system = any (public.tax_source_systems())),
  source_reference text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (num_nonnulls(category_id, subcategory_id, product_type_id) = 1)
);
-- One active meaning per term, so resolution is deterministic.
create unique index tax_aliases_norm_uq on public.tax_aliases (alias_norm) where active;

create table public.tax_mappings (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system = any (public.tax_source_systems())),
  source_form_type text,
  source_category text,
  source_subcategory text,
  source_product_type text,
  source_key text generated always as (lower(coalesce(source_form_type, '') || '|' || coalesce(source_category, '') || '|'
    || coalesce(source_subcategory, '') || '|' || coalesce(source_product_type, ''))) stored,
  category_id uuid references public.tax_categories(id),
  subcategory_id uuid references public.tax_subcategories(id),
  product_type_id uuid references public.tax_product_types(id),
  status text not null default 'Unmapped' check (status in ('Unmapped','Suggested','Pending review','Approved','Rejected','Archived')),
  confidence numeric(4,3) check (confidence between 0 and 1),
  match_basis text,
  occurrences int not null default 0,
  source_reference text,
  alias_id uuid references public.tax_aliases(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_key),
  check (num_nonnulls(source_form_type, source_category, source_subcategory, source_product_type) >= 1)
);
create index tax_mappings_status_idx on public.tax_mappings (status, source_system);

create table public.tax_audit (
  id bigint generated always as identity primary key,
  domain text not null default 'Product' check (domain in ('Product','Client','Finance','Geography','DOA')),
  record_type text not null,
  record_id uuid,
  record_name text,
  record_code text,
  action text not null check (action in ('create','update','delete','toggle','reorder','approve','reject','archive','classify','import')),
  description text not null check (length(trim(description)) > 0),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_by_name text,
  at timestamptz not null default now()
);
create index tax_audit_at_idx on public.tax_audit (domain, at desc);

create or replace function public.trg_tax_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'The taxonomy audit trail is append-only';
end $$;
create trigger tax_audit_append_only before update or delete on public.tax_audit
  for each row execute function public.trg_tax_audit_append_only();

-- ---------------------------------------------------------------------------
-- 2. Shared internals: admin check, audit, path validation, labels
-- ---------------------------------------------------------------------------
create or replace function public._tax_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can change the product taxonomy' using errcode = '42501';
  end if;
end $$;

create or replace function public._tax_audit(p_domain text, p_type text, p_id uuid, p_name text, p_code text, p_action text, p_description text)
returns void language sql security definer set search_path = public as $$
  insert into public.tax_audit (domain, record_type, record_id, record_name, record_code, action, description, changed_by, changed_by_name)
  values (p_domain, p_type, p_id, p_name, p_code, p_action, p_description, auth.uid(),
          (select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = auth.uid()));
$$;

-- Other taxonomy domains (Client, Finance, Geography, DOA) record their changes here too. Admins only.
create or replace function public.tax_audit_log(p_domain text, p_record_type text, p_record_id uuid, p_name text, p_code text, p_action text, p_description text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._tax_admin();
  perform public._tax_audit(p_domain, p_record_type, p_record_id, p_name, p_code, p_action, p_description);
end $$;

-- Validates and completes a path: the product type gives its subcategory and category, the subcategory its category.
create or replace function public._tax_path(p_cat uuid, p_sub uuid, p_pt uuid)
returns table (category_id uuid, subcategory_id uuid, product_type_id uuid, form_type text)
language plpgsql stable security definer set search_path = public as $$
declare v_cat uuid := p_cat; v_sub uuid := p_sub; v_c uuid; v_s uuid; v_ft text; v_name text;
begin
  if p_pt is not null then
    select p.subcategory_id, p.category_id, p.name into v_s, v_c, v_name from public.tax_product_types p where p.id = p_pt;
    if v_s is null then raise exception 'Unknown product type'; end if;
    if v_sub is not null and v_sub <> v_s then raise exception 'The product type "%" is not under the chosen subcategory', v_name; end if;
    if v_cat is not null and v_cat <> v_c then raise exception 'The product type "%" is not under the chosen category', v_name; end if;
    v_sub := v_s; v_cat := v_c;
  end if;
  if v_sub is not null then
    select s.category_id, s.name into v_c, v_name from public.tax_subcategories s where s.id = v_sub;
    if v_c is null then raise exception 'Unknown subcategory'; end if;
    if v_cat is not null and v_cat <> v_c then raise exception 'The subcategory "%" is not under the chosen category', v_name; end if;
    v_cat := v_c;
  end if;
  if v_cat is not null then
    select c.form_type into v_ft from public.tax_categories c where c.id = v_cat;
    if v_ft is null then raise exception 'Unknown category'; end if;
  end if;
  return query select v_cat, v_sub, p_pt, v_ft;
end $$;

-- "POS & Display › Floor displays › FSDU › Corrugated FSDU"
create or replace function public.tax_path_label(p_cat uuid, p_sub uuid, p_pt uuid) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' › ', c.form_type, c.name, s.name, p.name)
    from public.tax_categories c
    left join public.tax_subcategories s on s.id = coalesce(p_sub, (select subcategory_id from public.tax_product_types where id = p_pt))
    left join public.tax_product_types p on p.id = p_pt
   where c.id = coalesce(p_cat, (select category_id from public.tax_subcategories where id = coalesce(p_sub, (select subcategory_id from public.tax_product_types where id = p_pt))));
$$;

-- ---------------------------------------------------------------------------
-- 3. Terms and resolution
-- ---------------------------------------------------------------------------
-- Every active searchable term: node names, aliases and codes (codes carry a "code:" prefix so they only match codes).
create view public.v_tax_terms with (security_invoker = true) as
  select 'category'::text as level, c.id as node_id, c.id as category_id, null::uuid as subcategory_id, null::uuid as product_type_id,
         c.form_type, c.name as term, c.name_norm as norm, 'name'::text as kind, 1 as depth
    from public.tax_categories c where c.active
  union all
  select 'subcategory', s.id, c.id, s.id, null, c.form_type, s.name, s.name_norm, 'name', 2
    from public.tax_subcategories s join public.tax_categories c on c.id = s.category_id where s.active and c.active
  union all
  select 'product_type', p.id, c.id, s.id, p.id, c.form_type, p.name, p.name_norm, 'name', 3
    from public.tax_product_types p join public.tax_subcategories s on s.id = p.subcategory_id join public.tax_categories c on c.id = p.category_id
   where p.active and s.active and c.active
  union all
  select case when a.product_type_id is not null then 'product_type' when a.subcategory_id is not null then 'subcategory' else 'category' end,
         coalesce(a.product_type_id, a.subcategory_id, a.category_id), c.id, s.id, p.id, c.form_type, a.alias, a.alias_norm, 'alias',
         case when p.id is not null then 3 when s.id is not null then 2 else 1 end
    from public.tax_aliases a
    left join public.tax_product_types p on p.id = a.product_type_id
    left join public.tax_subcategories s on s.id = coalesce(a.subcategory_id, p.subcategory_id)
    join public.tax_categories c on c.id = coalesce(a.category_id, s.category_id)
   where a.active and c.active and (s.id is null or s.active) and (p.id is null or p.active)
  union all
  select 'category', c.id, c.id, null, null, c.form_type, c.code, 'code:' || lower(c.code), 'code', 1 from public.tax_categories c where c.active
  union all
  select 'subcategory', s.id, c.id, s.id, null, c.form_type, s.code, 'code:' || lower(s.code), 'code', 2
    from public.tax_subcategories s join public.tax_categories c on c.id = s.category_id where s.active and c.active
  union all
  select 'product_type', p.id, c.id, s.id, p.id, c.form_type, p.code, 'code:' || lower(p.code), 'code', 3
    from public.tax_product_types p join public.tax_subcategories s on s.id = p.subcategory_id join public.tax_categories c on c.id = p.category_id
   where p.active and s.active and c.active;

-- Best-effort resolver for free text: aliases, then names, then codes (case-insensitive, punctuation and simple plurals
-- ignored). With p_partial, a term contained as a whole phrase in the text also counts ("Opening day poster A1" → Posters),
-- longest term first. p_form_type prefers nodes in that form type. One row, or none.
create or replace function public.tax_resolve(p_text text, p_form_type text default null, p_partial boolean default false)
returns table (level text, category_id uuid, subcategory_id uuid, product_type_id uuid, form_type text, term text, match_kind text, confidence numeric)
language sql stable security definer set search_path = public as $$
  with q as (select public._tax_norm(p_text) as n, 'code:' || lower(trim(coalesce(p_text, ''))) as c),
  cand as (
    select t.*, case t.kind when 'alias' then 1 else 2 end as tier, case t.kind when 'alias' then 0.95 else 1.0 end as conf
      from public.v_tax_terms t, q where q.n is not null and t.kind <> 'code' and t.norm = q.n
    union all
    select t.*, 3, 0.9 from public.v_tax_terms t, q where t.kind = 'code' and t.norm = q.c
    union all
    select t.*, 4, 0.7 from public.v_tax_terms t, q
     where p_partial and q.n is not null and t.kind <> 'code' and length(t.norm) >= 3 and t.norm <> q.n
       and (' ' || q.n || ' ') like ('% ' || t.norm || ' %')
  )
  select cand.level, cand.category_id, cand.subcategory_id, cand.product_type_id, cand.form_type, cand.term,
         case when cand.tier = 4 then 'contains' else cand.kind end, cand.conf
    from cand
   order by cand.tier, (p_form_type is not null and cand.form_type = p_form_type) desc, length(cand.norm) desc, cand.depth desc
   limit 1;
$$;

-- Word-overlap similarity (Jaccard on normalised words) for mapping suggestions; capped below the contains score.
create or replace function public._tax_fuzzy(p_text text, p_form_type text default null)
returns table (level text, category_id uuid, subcategory_id uuid, product_type_id uuid, form_type text, term text, match_kind text, confidence numeric)
language sql stable security definer set search_path = public as $$
  with q as (select array(select distinct w from unnest(string_to_array(public._tax_norm(p_text), ' ')) w where w <> '') as a)
  select t.level, t.category_id, t.subcategory_id, t.product_type_id, t.form_type, t.term, 'similar words'::text, round(least(sc.s, 0.69), 3)
    from public.v_tax_terms t cross join q
    cross join lateral (
      select (select count(*) from (select unnest(q.a) intersect select unnest(string_to_array(t.norm, ' '))) i)::numeric
             / nullif((select count(*) from (select unnest(q.a) union select unnest(string_to_array(t.norm, ' '))) u), 0) as s) sc
   where t.kind <> 'code' and cardinality(q.a) > 0 and sc.s > 0
   order by sc.s desc, (p_form_type is not null and t.form_type = p_form_type) desc, t.depth desc
   limit 1;
$$;

-- What a spec's free text says it is. Order: product sub-type, title, (then partial matches of both), product category.
create or replace function public._tax_spec_guess(p_title text, p_category text, p_sub_type text, p_form_type text)
returns table (category_id uuid, subcategory_id uuid, product_type_id uuid, note text)
language plpgsql stable security definer set search_path = public as $$
declare r record; x record;
begin
  for x in select * from (values (1, 'product sub-type', p_sub_type, false), (2, 'title', p_title, false), (3, 'product sub-type', p_sub_type, true),
                                 (4, 'title', p_title, true), (5, 'product category', p_category, false), (6, 'product category', p_category, true)) v(n, field, txt, partial)
           where coalesce(trim(txt), '') <> '' order by n loop
    select * into r from public.tax_resolve(x.txt, p_form_type, x.partial);
    if r.category_id is not null then
      return query select r.category_id, r.subcategory_id, r.product_type_id,
        format('Automatic: %s "%s" matched %s "%s"', x.field, trim(x.txt), case r.match_kind when 'contains' then 'the term' else r.match_kind end, r.term);
      return;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Reference tree (generic product terms; default HS codes are starting values for customs review)
-- ---------------------------------------------------------------------------
create temp table _tax_cat_seed (n serial, ft text, code text, name text, description text);
insert into _tax_cat_seed (ft, code, name, description) values
  ('Print', 'LIT', 'Literature & publications', 'Posters, leaflets, brochures, cards and inserts.'),
  ('Print', 'LBL', 'Labels & stickers', 'Labels, tags, stickers and decals.'),
  ('Print', 'LGF', 'Large format', 'Banners, flags, window and wall graphics, rigid boards.'),
  ('Print', 'COM', 'Commercial print', 'Business stationery and direct mail.'),
  ('Packaging', 'PRIM', 'Primary packaging', 'The pack the product sits in.'),
  ('Packaging', 'SEC', 'Secondary & transit packaging', 'Shipping cartons, trays and protective packaging.'),
  ('Packaging', 'GIFT', 'Gift & presentation packaging', 'Gift boxes, wraps, trims and carrier bags.'),
  ('POS & Display', 'FLOOR', 'Floor displays', 'FSDUs, dumpbins, pallet displays, gondola ends, stands and totems.'),
  ('POS & Display', 'COUNTER', 'Counter & shelf', 'Counter units, shelf media, header cards and toppers.'),
  ('POS & Display', 'PERM', 'Permanent fixtures & furniture', 'Retail fixtures, chiller branding and illuminated signage.'),
  ('POS & Display', 'WINDOW', 'Window & in-store theatre', 'Window displays, hangers, islands and archways.'),
  ('Creative & Design', 'DESIGN', 'Design', 'Concept, structural and graphic design.'),
  ('Creative & Design', 'ART', 'Artwork & pre-press', 'Artwork, adaptation, repro and proofing.'),
  ('Creative & Design', 'CONTENT', 'Photography & content', 'Photography, retouching, video and animation.'),
  ('Creative & Design', 'COPY', 'Copy & translation', 'Copywriting, translation and proofreading.'),
  ('Logistics', 'FREIGHT', 'Freight', 'Moving goods by road, sea or air.'),
  ('Logistics', 'WH', 'Warehousing & fulfilment', 'Storage, kitting, pick and pack, distribution.'),
  ('Logistics', 'POST', 'Postage & mailing', 'Postage for print, POSM and general items.'),
  ('Logistics', 'FIELD', 'Installation & field services', 'Installation, removal, maintenance and store visits.'),
  ('Merchandise', 'APP', 'Apparel', 'Clothing, headwear and apparel accessories.'),
  ('Merchandise', 'DRINK', 'Drinkware & barware', 'Mugs, glasses, bottles and bar accessories.'),
  ('Merchandise', 'BAGS', 'Bags', 'Tote bags, backpacks and cooler bags.'),
  ('Merchandise', 'TECH', 'Tech accessories', 'Power banks, chargers, speakers and similar.'),
  ('Merchandise', 'OFFICE', 'Office & stationery', 'Pens, notebooks and desk items.'),
  ('Merchandise', 'LEISURE', 'Leisure & lifestyle', 'Umbrellas, lanyards, games and toys.'),
  ('Merchandise', 'GIFTING', 'Gifting & premiums', 'Gift with purchase, hampers, gift sets and premiums.'),
  ('Digital', 'INSTORE', 'Digital in-store', 'Screen content and interactive experiences in store.'),
  ('Digital', 'WEB', 'Web & social', 'Social, e-commerce and email content.'),
  ('Digital', 'BUILD', 'Digital build & hosting', 'Microsites, QR campaigns and hosting.'),
  ('Custom Goods & Services', 'SERV', 'Services', 'Ad hoc services charged on a job.'),
  ('Custom Goods & Services', 'GOODS', 'Custom goods', 'Paper and bespoke goods that are not POS or merchandise.'),
  ('2D/3D', 'KIT', 'Campaign kits', 'Mixed 2D and 3D kits bought as one line.'),
  ('Stocktool only', 'STOCK', 'Stock items', 'Lines that exist only in Stocktool (stock and consumables).');

insert into public.tax_categories (form_type, code, name, description, display_order)
select ft, code, name, description, n * 10 from _tax_cat_seed order by n;

create temp table _tax_seed (n serial, ft text, cc text, sc text, sn text, pc text, pn text, hs text);
insert into _tax_seed (ft, cc, sc, sn, pc, pn, hs) values
  -- Print
  ('Print','LIT','POSTER','Posters','PAPER','Paper poster','4911.10'),
  ('Print','LIT','POSTER','Posters','BACKLIT','Backlit poster','4911.10'),
  ('Print','LIT','POSTER','Posters','RIGID','Rigid poster board','4911.10'),
  ('Print','LIT','POSTER','Posters','LENTIC','Lenticular poster','4911.10'),
  ('Print','LIT','LEAFLET','Leaflets & flyers','LEAFLET','Leaflet','4911.10'),
  ('Print','LIT','LEAFLET','Leaflets & flyers','FLYER','Flyer','4911.10'),
  ('Print','LIT','LEAFLET','Leaflets & flyers','TEAROFF','Tear-off pad','4911.10'),
  ('Print','LIT','LEAFLET','Leaflets & flyers','DOORDROP','Door drop','4911.10'),
  ('Print','LIT','BROCHURE','Brochures & booklets','BROCHURE','Brochure','4901.99'),
  ('Print','LIT','BROCHURE','Brochures & booklets','BOOKLET','Booklet','4901.99'),
  ('Print','LIT','BROCHURE','Brochures & booklets','CATALOGUE','Catalogue','4911.10'),
  ('Print','LIT','BROCHURE','Brochures & booklets','MENU','Menu','4911.99'),
  ('Print','LIT','CARD','Cards & inserts','POSTCARD','Postcard','4909.00'),
  ('Print','LIT','CARD','Cards & inserts','GREETING','Greeting card','4909.00'),
  ('Print','LIT','CARD','Cards & inserts','INSERT','Product insert','4911.10'),
  ('Print','LIT','CARD','Cards & inserts','VOUCHER','Voucher or coupon','4911.99'),
  ('Print','LBL','LABEL','Labels','SELFADH','Self-adhesive label','4821.10'),
  ('Print','LBL','LABEL','Labels','NECK','Neck collar','4821.10'),
  ('Print','LBL','LABEL','Labels','HANGTAG','Hang tag','4821.10'),
  ('Print','LBL','LABEL','Labels','SEL','Shelf-edge label','4821.10'),
  ('Print','LBL','STICKER','Stickers & decals','STICKER','Sticker','4911.99'),
  ('Print','LBL','STICKER','Stickers & decals','DECAL','Vinyl decal','3919.90'),
  ('Print','LBL','STICKER','Stickers & decals','FLOOR','Floor graphic','3919.90'),
  ('Print','LGF','BANNER','Banners & flags','VINYL','Vinyl banner','3926.90'),
  ('Print','LGF','BANNER','Banners & flags','FABRIC','Fabric banner','6307.90'),
  ('Print','LGF','BANNER','Banners & flags','MESH','Mesh banner','3926.90'),
  ('Print','LGF','BANNER','Banners & flags','FLAG','Flag','6307.90'),
  ('Print','LGF','WINWALL','Window & wall graphics','WINGRAPHIC','Window graphic','3919.90'),
  ('Print','LGF','WINWALL','Window & wall graphics','CLING','Window cling','3919.90'),
  ('Print','LGF','WINWALL','Window & wall graphics','WALL','Wall graphic','3919.90'),
  ('Print','LGF','WINWALL','Window & wall graphics','MURAL','Wallpaper mural','4814.90'),
  ('Print','LGF','BOARD','Rigid boards & signs','FOAMPVC','Foam PVC board','3921.19'),
  ('Print','LGF','BOARD','Rigid boards & signs','BOARDSIGN','Board sign','4823.90'),
  ('Print','LGF','BOARD','Rigid boards & signs','ACM','Aluminium composite panel','7606.12'),
  ('Print','LGF','BOARD','Rigid boards & signs','ABOARD','A-board','7326.90'),
  ('Print','COM','STATIONERY','Business stationery','LETTERHEAD','Letterhead','4911.99'),
  ('Print','COM','STATIONERY','Business stationery','BIZCARD','Business card','4911.99'),
  ('Print','COM','STATIONERY','Business stationery','ENVELOPE','Envelope','4817.10'),
  ('Print','COM','STATIONERY','Business stationery','NOTEPAD','Notepad','4820.10'),
  ('Print','COM','DM','Direct mail','MAILER','Direct mail piece','4911.10'),
  ('Print','COM','DM','Direct mail','DMPACK','DM pack','4911.10'),
  ('Print','COM','DM','Direct mail','LETTER','Personalised letter','4911.99'),
  -- Packaging
  ('Packaging','PRIM','CARTON','Folding cartons & sleeves','FOLDING','Folding carton','4819.20'),
  ('Packaging','PRIM','CARTON','Folding cartons & sleeves','SLEEVE','Pack sleeve','4819.20'),
  ('Packaging','PRIM','CARTON','Folding cartons & sleeves','RIGIDBOX','Rigid box','4819.20'),
  ('Packaging','PRIM','CARTON','Folding cartons & sleeves','SRP','Shelf-ready pack','4819.20'),
  ('Packaging','PRIM','FLEX','Flexible packaging','POUCH','Pouch','3923.29'),
  ('Packaging','PRIM','FLEX','Flexible packaging','FLOWWRAP','Flow wrap','3920.20'),
  ('Packaging','PRIM','FLEX','Flexible packaging','SACHET','Sachet','3923.29'),
  ('Packaging','PRIM','CONTAINER','Bottles, jars & tins','GLASSBOTTLE','Glass bottle','7010.90'),
  ('Packaging','PRIM','CONTAINER','Bottles, jars & tins','PLASTICBOTTLE','Plastic bottle','3923.30'),
  ('Packaging','PRIM','CONTAINER','Bottles, jars & tins','JAR','Jar','7010.90'),
  ('Packaging','PRIM','CONTAINER','Bottles, jars & tins','TIN','Tin','7310.29'),
  ('Packaging','SEC','CORR','Corrugated','SHIPPER','Shipping carton','4819.10'),
  ('Packaging','SEC','CORR','Corrugated','MAILERBOX','Mailer box','4819.10'),
  ('Packaging','SEC','CORR','Corrugated','TRAY','Corrugated tray','4819.10'),
  ('Packaging','SEC','CORR','Corrugated','DIVIDER','Divider or insert','4823.90'),
  ('Packaging','SEC','PROTECT','Protective packaging','VOIDFILL','Void fill','3923.90'),
  ('Packaging','SEC','PROTECT','Protective packaging','BUBBLE','Bubble wrap','3920.10'),
  ('Packaging','SEC','PROTECT','Protective packaging','STRETCH','Pallet stretch wrap','3920.10'),
  ('Packaging','SEC','PROTECT','Protective packaging','EDGE','Edge protector','4823.90'),
  ('Packaging','GIFT','GIFTBOX','Gift boxes','GIFTBOX','Gift box','4819.20'),
  ('Packaging','GIFT','GIFTBOX','Gift boxes','HAMPERBOX','Hamper box','4819.20'),
  ('Packaging','GIFT','GIFTBOX','Gift boxes','CASE','Presentation case','4202.99'),
  ('Packaging','GIFT','WRAP','Gift wrap & trims','RIBBON','Ribbon','5806.32'),
  ('Packaging','GIFT','WRAP','Gift wrap & trims','GIFTTAG','Gift tag','4821.10'),
  ('Packaging','GIFT','WRAP','Gift wrap & trims','WRAPPAPER','Gift wrap','4823.90'),
  ('Packaging','GIFT','WRAP','Gift wrap & trims','TISSUE','Tissue paper','4823.90'),
  ('Packaging','GIFT','CARRIER','Carrier bags','PAPERBAG','Paper carrier bag','4819.40'),
  ('Packaging','GIFT','CARRIER','Carrier bags','PLASTICBAG','Plastic carrier bag','3923.21'),
  ('Packaging','GIFT','CARRIER','Carrier bags','FABRICBAG','Fabric gift bag','4202.92'),
  -- POS & Display
  ('POS & Display','FLOOR','FSDU','Free-standing display units','CORRFSDU','Corrugated FSDU','4823.90'),
  ('POS & Display','FLOOR','FSDU','Free-standing display units','METALFSDU','Metal FSDU','9403.20'),
  ('POS & Display','FLOOR','FSDU','Free-standing display units','WOODFSDU','Wooden FSDU','9403.60'),
  ('POS & Display','FLOOR','DUMPBIN','Dumpbins','CORRBIN','Corrugated dumpbin','4823.90'),
  ('POS & Display','FLOOR','DUMPBIN','Dumpbins','WIREBIN','Wire dumpbin','7326.20'),
  ('POS & Display','FLOOR','DUMPBIN','Dumpbins','PLASTICBIN','Plastic dumpbin','3926.90'),
  ('POS & Display','FLOOR','PALLET','Pallet displays','PALLETDISP','Pallet display','4823.90'),
  ('POS & Display','FLOOR','PALLET','Pallet displays','HALFPALLET','Half-pallet display','4823.90'),
  ('POS & Display','FLOOR','PALLET','Pallet displays','QUARTER','Quarter-pallet display','4823.90'),
  ('POS & Display','FLOOR','PALLET','Pallet displays','SKIRT','Pallet skirt','4823.90'),
  ('POS & Display','FLOOR','GONDOLA','Gondola ends','GONDDISP','Gondola end display','4823.90'),
  ('POS & Display','FLOOR','GONDOLA','Gondola ends','GONDHEADER','Gondola end header','4911.10'),
  ('POS & Display','FLOOR','GONDOLA','Gondola ends','BAYKIT','Gondola end bay kit','4823.90'),
  ('POS & Display','FLOOR','STAND','Stands & totems','FREESTAND','Freestanding stand','9403.60'),
  ('POS & Display','FLOOR','STAND','Stands & totems','TOTEM','Totem','4823.90'),
  ('POS & Display','FLOOR','STAND','Stands & totems','ROLLER','Roller banner stand','7616.99'),
  ('POS & Display','FLOOR','STAND','Stands & totems','LEAFLETSTAND','Leaflet stand','3926.90'),
  ('POS & Display','FLOOR','STAND','Stands & totems','SAMPLING','Sampling unit','9403.60'),
  ('POS & Display','FLOOR','STAND','Stands & totems','CUTOUT','Cardboard cut-out','4823.90'),
  ('POS & Display','COUNTER','CDU','Counter display units','CDU','Counter display unit','4823.90'),
  ('POS & Display','COUNTER','CDU','Counter display units','ACRYLIC','Acrylic counter stand','3926.90'),
  ('POS & Display','COUNTER','CDU','Counter display units','COUNTERMAT','Counter mat','3918.90'),
  ('POS & Display','COUNTER','CDU','Counter display units','LEAFLETHOLD','Leaflet holder','3926.90'),
  ('POS & Display','COUNTER','SHELF','Shelf media','WOBBLER','Shelf wobbler','4911.10'),
  ('POS & Display','COUNTER','SHELF','Shelf media','STRIP','Shelf strip','3926.90'),
  ('POS & Display','COUNTER','SHELF','Shelf media','TALKER','Shelf talker','4911.10'),
  ('POS & Display','COUNTER','SHELF','Shelf media','BARKER','Shelf barker','4911.10'),
  ('POS & Display','COUNTER','SHELF','Shelf media','DIVIDER','Shelf divider','3926.90'),
  ('POS & Display','COUNTER','SHELF','Shelf media','SHELFTRAY','Shelf tray','4819.10'),
  ('POS & Display','COUNTER','HEADER','Header cards & toppers','HEADERCARD','Header card','4911.10'),
  ('POS & Display','COUNTER','HEADER','Header cards & toppers','HEADERBOARD','Header board','4911.10'),
  ('POS & Display','COUNTER','HEADER','Header cards & toppers','NECKHANGER','Bottle neck hanger','4911.10'),
  ('POS & Display','COUNTER','HEADER','Header cards & toppers','HANGSELL','Hang-sell','4911.10'),
  ('POS & Display','COUNTER','HEADER','Header cards & toppers','CLIPSTRIP','Clip strip','3926.90'),
  ('POS & Display','PERM','FIXTURE','Retail fixtures','BACKBAR','Back-bar unit','9403.60'),
  ('POS & Display','PERM','FIXTURE','Retail fixtures','SHOPINSHOP','Shop-in-shop fixture','9403.60'),
  ('POS & Display','PERM','FIXTURE','Retail fixtures','WALLBAY','Wall bay','9403.20'),
  ('POS & Display','PERM','FIXTURE','Retail fixtures','PLINTH','Plinth','9403.60'),
  ('POS & Display','PERM','FIXTURE','Retail fixtures','CABINET','Display cabinet','9403.60'),
  ('POS & Display','PERM','CHILLER','Fridge & chiller','CHILLERBRAND','Chiller branding','3919.90'),
  ('POS & Display','PERM','CHILLER','Fridge & chiller','FRIDGE','Branded fridge','8418.50'),
  ('POS & Display','PERM','CHILLER','Fridge & chiller','DOORGRAPHIC','Chiller door graphic','3919.90'),
  ('POS & Display','PERM','ILLUM','Illuminated signage','LIGHTBOX','Light box','9405.61'),
  ('POS & Display','PERM','ILLUM','Illuminated signage','LEDSIGN','LED sign','9405.61'),
  ('POS & Display','PERM','ILLUM','Illuminated signage','SCREEN','Digital screen unit','8528.52'),
  ('POS & Display','WINDOW','WINDISP','Window displays','WINKIT','Window display kit','4823.90'),
  ('POS & Display','WINDOW','WINDISP','Window displays','WINHANGER','Window hanger','4911.10'),
  ('POS & Display','WINDOW','WINDISP','Window displays','CEILING','Ceiling hanger','4911.10'),
  ('POS & Display','WINDOW','THEATRE','In-store theatre','ISLAND','Promotional island','9403.60'),
  ('POS & Display','WINDOW','THEATRE','In-store theatre','ARCH','Archway','4823.90'),
  ('POS & Display','WINDOW','THEATRE','In-store theatre','INFLATABLE','Inflatable','3926.90'),
  -- Creative & Design (services: no HS code)
  ('Creative & Design','DESIGN','CONCEPT','Concept & structural design','CONCEPT','Concept design',null),
  ('Creative & Design','DESIGN','CONCEPT','Concept & structural design','STRUCT','Structural design',null),
  ('Creative & Design','DESIGN','CONCEPT','Concept & structural design','VIS3D','3D visualisation',null),
  ('Creative & Design','DESIGN','CONCEPT','Concept & structural design','MOCKUP','Prototype or mock-up',null),
  ('Creative & Design','DESIGN','GRAPHIC','Graphic design','KV','Key visual',null),
  ('Creative & Design','DESIGN','GRAPHIC','Graphic design','ADAPT','Campaign adaptation',null),
  ('Creative & Design','DESIGN','GRAPHIC','Graphic design','PACKDESIGN','Packaging design',null),
  ('Creative & Design','DESIGN','GRAPHIC','Graphic design','LAYOUT','Layout design',null),
  ('Creative & Design','ART','ARTWORK','Artwork','CREATE','Artwork creation',null),
  ('Creative & Design','ART','ARTWORK','Artwork','RESIZE','Artwork adaptation',null),
  ('Creative & Design','ART','ARTWORK','Artwork','AMEND','Artwork amendment',null),
  ('Creative & Design','ART','ARTWORK','Artwork','REPRO','Repro and pre-press',null),
  ('Creative & Design','ART','PROOF','Proofing','DIGITAL','Digital proof',null),
  ('Creative & Design','ART','PROOF','Proofing','HARDCOPY','Hard-copy proof',null),
  ('Creative & Design','ART','PROOF','Proofing','WET','Wet proof',null),
  ('Creative & Design','ART','PROOF','Proofing','COLOUR','Colour match',null),
  ('Creative & Design','CONTENT','PHOTO','Photography','PRODUCT','Product photography',null),
  ('Creative & Design','CONTENT','PHOTO','Photography','LIFESTYLE','Lifestyle photography',null),
  ('Creative & Design','CONTENT','PHOTO','Photography','RETOUCH','Retouching',null),
  ('Creative & Design','CONTENT','VIDEO','Video & animation','VIDEO','Video production',null),
  ('Creative & Design','CONTENT','VIDEO','Video & animation','MOTION','Motion graphics',null),
  ('Creative & Design','CONTENT','VIDEO','Video & animation','ANIM','Animation',null),
  ('Creative & Design','COPY','COPYWRITING','Copywriting','COPY','Copywriting',null),
  ('Creative & Design','COPY','COPYWRITING','Copywriting','COPYADAPT','Copy adaptation',null),
  ('Creative & Design','COPY','TRANSLATE','Translation','TRANS','Translation',null),
  ('Creative & Design','COPY','TRANSLATE','Translation','PROOFREAD','Proofreading',null),
  -- Logistics
  ('Logistics','FREIGHT','GENERAL','Freight by item','GENERAL','Freight (general)',null),
  ('Logistics','FREIGHT','GENERAL','Freight by item','POSM','Freight (POSM)',null),
  ('Logistics','FREIGHT','GENERAL','Freight by item','PRINT','Freight (print)',null),
  ('Logistics','FREIGHT','ROAD','Road freight','PALLET','Pallet delivery',null),
  ('Logistics','FREIGHT','ROAD','Road freight','FTL','Full truck load',null),
  ('Logistics','FREIGHT','ROAD','Road freight','COURIER','Courier parcel',null),
  ('Logistics','FREIGHT','SEA','Sea freight','FCL','Full container load',null),
  ('Logistics','FREIGHT','SEA','Sea freight','LCL','Less than container load',null),
  ('Logistics','FREIGHT','AIR','Air freight','AIR','Air cargo',null),
  ('Logistics','FREIGHT','AIR','Air freight','EXPRESS','Express air',null),
  ('Logistics','WH','STORAGE','Storage','PALLETSTORE','Pallet storage',null),
  ('Logistics','WH','STORAGE','Storage','SHELFSTORE','Shelf storage',null),
  ('Logistics','WH','KFD','Kitting, fulfilment & distribution','KITTING','Kitting',null),
  ('Logistics','WH','KFD','Kitting, fulfilment & distribution','PICKPACK','Pick and pack',null),
  ('Logistics','WH','KFD','Kitting, fulfilment & distribution','DISTRIB','Store distribution',null),
  ('Logistics','WH','KFD','Kitting, fulfilment & distribution','RETURNS','Returns handling',null),
  ('Logistics','POST','POSTAGE','Postage','GENERAL','Postage (general)',null),
  ('Logistics','POST','POSTAGE','Postage','POSM','Postage (POSM)',null),
  ('Logistics','POST','POSTAGE','Postage','PRINT','Postage (print)',null),
  ('Logistics','FIELD','INSTALL','Installation','INSTALL','Store installation',null),
  ('Logistics','FIELD','INSTALL','Installation','REMOVAL','Removal and disposal',null),
  ('Logistics','FIELD','INSTALL','Installation','MAINT','Maintenance visit',null),
  ('Logistics','FIELD','SURVEY','Surveys & recces','RECCE','Store recce',null),
  ('Logistics','FIELD','SURVEY','Surveys & recces','AUDIT','Compliance audit',null),
  -- Merchandise
  ('Merchandise','APP','TOP','Tops','TSHIRT','T-shirt','6109.10'),
  ('Merchandise','APP','TOP','Tops','POLO','Polo shirt','6105.10'),
  ('Merchandise','APP','TOP','Tops','HOODIE','Hoodie','6110.20'),
  ('Merchandise','APP','TOP','Tops','JACKET','Jacket','6201.40'),
  ('Merchandise','APP','TOP','Tops','UNIFORM','Staff uniform','6211.33'),
  ('Merchandise','APP','HEAD','Headwear','CAP','Cap','6505.00'),
  ('Merchandise','APP','HEAD','Headwear','BEANIE','Beanie','6505.00'),
  ('Merchandise','APP','HEAD','Headwear','BUCKET','Bucket hat','6505.00'),
  ('Merchandise','APP','APACC','Apparel accessories','SCARF','Scarf','6117.10'),
  ('Merchandise','APP','APACC','Apparel accessories','SOCKS','Socks','6115.95'),
  ('Merchandise','APP','APACC','Apparel accessories','APRON','Apron','6211.42'),
  ('Merchandise','APP','APACC','Apparel accessories','WRISTBAND','Wristband','6117.80'),
  ('Merchandise','DRINK','DRINKWARE','Drinkware','MUG','Ceramic mug','6912.00'),
  ('Merchandise','DRINK','DRINKWARE','Drinkware','TUMBLER','Glass tumbler','7013.37'),
  ('Merchandise','DRINK','DRINKWARE','Drinkware','CUP','Reusable cup','3924.10'),
  ('Merchandise','DRINK','DRINKWARE','Drinkware','BOTTLE','Metal water bottle','7323.93'),
  ('Merchandise','DRINK','DRINKWARE','Drinkware','TRAVEL','Travel mug','9617.00'),
  ('Merchandise','DRINK','BAR','Bar accessories','RUNNER','Bar runner','4016.91'),
  ('Merchandise','DRINK','BAR','Bar accessories','COASTER','Coaster','4823.90'),
  ('Merchandise','DRINK','BAR','Bar accessories','ICEBUCKET','Ice bucket','7323.93'),
  ('Merchandise','DRINK','BAR','Bar accessories','OPENER','Bottle opener','8205.51'),
  ('Merchandise','DRINK','BAR','Bar accessories','GLASS','Branded glass','7013.37'),
  ('Merchandise','DRINK','BAR','Bar accessories','TRAY','Serving tray','3924.10'),
  ('Merchandise','BAGS','BAG','Bags','TOTE','Tote bag','4202.92'),
  ('Merchandise','BAGS','BAG','Bags','BACKPACK','Backpack','4202.92'),
  ('Merchandise','BAGS','BAG','Bags','DRAWSTRING','Drawstring bag','4202.92'),
  ('Merchandise','BAGS','BAG','Bags','COOLER','Cooler bag','4202.92'),
  ('Merchandise','TECH','TECHACC','Tech accessories','POWERBANK','Power bank','8507.60'),
  ('Merchandise','TECH','TECHACC','Tech accessories','USB','USB flash drive','8523.51'),
  ('Merchandise','TECH','TECHACC','Tech accessories','CHARGER','Wireless charger','8504.40'),
  ('Merchandise','TECH','TECHACC','Tech accessories','SPEAKER','Bluetooth speaker','8518.22'),
  ('Merchandise','TECH','TECHACC','Tech accessories','EARBUDS','Earbuds','8518.30'),
  ('Merchandise','TECH','TECHACC','Tech accessories','PHONESTAND','Phone stand','3926.90'),
  ('Merchandise','TECH','TECHACC','Tech accessories','CABLE','Charging cable','8544.42'),
  ('Merchandise','OFFICE','WRITING','Writing instruments','PEN','Ballpoint pen','9608.10'),
  ('Merchandise','OFFICE','WRITING','Writing instruments','PENCIL','Pencil','9609.10'),
  ('Merchandise','OFFICE','WRITING','Writing instruments','HIGHLIGHTER','Highlighter','9608.20'),
  ('Merchandise','OFFICE','DESK','Notebooks & desk','NOTEBOOK','Notebook','4820.10'),
  ('Merchandise','OFFICE','DESK','Notebooks & desk','CALENDAR','Desk calendar','4910.00'),
  ('Merchandise','OFFICE','DESK','Notebooks & desk','MOUSEMAT','Mouse mat','4016.99'),
  ('Merchandise','OFFICE','DESK','Notebooks & desk','STICKYNOTES','Sticky notes','4820.10'),
  ('Merchandise','LEISURE','LIFESTYLE','Lifestyle','UMBRELLA','Umbrella','6601.91'),
  ('Merchandise','LEISURE','LIFESTYLE','Lifestyle','LANYARD','Lanyard','6307.90'),
  ('Merchandise','LEISURE','LIFESTYLE','Lifestyle','KEYRING','Keyring','7326.90'),
  ('Merchandise','LEISURE','LIFESTYLE','Lifestyle','TOWEL','Towel','6302.60'),
  ('Merchandise','LEISURE','LIFESTYLE','Lifestyle','SUNGLASSES','Sunglasses','9004.10'),
  ('Merchandise','LEISURE','GAMES','Games & toys','PLUSH','Plush toy','9503.00'),
  ('Merchandise','LEISURE','GAMES','Games & toys','PUZZLE','Puzzle','9503.00'),
  ('Merchandise','LEISURE','GAMES','Games & toys','CARDS','Playing cards','9504.40'),
  ('Merchandise','LEISURE','GAMES','Games & toys','BALL','Sports ball','9506.62'),
  ('Merchandise','GIFTING','GWP','Gift with purchase','GWPITEM','Gift-with-purchase item',null),
  ('Merchandise','GIFTING','GWP','Gift with purchase','GWPPACK','Gift-with-purchase pack',null),
  ('Merchandise','GIFTING','HAMPER','Hampers & gift sets','HAMPER','Gift hamper','4602.19'),
  ('Merchandise','GIFTING','HAMPER','Hampers & gift sets','GIFTSET','Gift set',null),
  ('Merchandise','GIFTING','PREMIUM','Premiums','PREMIUM','Premium item',null),
  ('Merchandise','GIFTING','PREMIUM','Premiums','SAMPLEPACK','Sample pack',null),
  -- Digital
  ('Digital','INSTORE','SIGNAGE','Digital signage content','LOOP','Screen content loop',null),
  ('Digital','INSTORE','SIGNAGE','Digital signage content','MENUBOARD','Digital menu board content',null),
  ('Digital','INSTORE','INTERACTIVE','Interactive','KIOSK','Interactive kiosk content',null),
  ('Digital','INSTORE','INTERACTIVE','Interactive','AR','Augmented reality experience',null),
  ('Digital','WEB','SOCIAL','Social media','SOCIALASSET','Social media asset',null),
  ('Digital','WEB','SOCIAL','Social media','PAIDSOCIAL','Paid social campaign',null),
  ('Digital','WEB','ECOM','E-commerce content','PDP','Product page content',null),
  ('Digital','WEB','ECOM','E-commerce content','WEBBANNER','Web banner',null),
  ('Digital','WEB','ECOM','E-commerce content','EMAIL','Email campaign',null),
  ('Digital','BUILD','DEV','Development & hosting','MICROSITE','Microsite',null),
  ('Digital','BUILD','DEV','Development & hosting','QR','QR code campaign',null),
  ('Digital','BUILD','DEV','Development & hosting','HOSTING','Hosting',null),
  -- Custom Goods & Services (from the prototype's service product types)
  ('Custom Goods & Services','SERV','PRODUCTION','Production services','PROOF','Proof',null),
  ('Custom Goods & Services','SERV','PRODUCTION','Production services','SAMPLE','Sample',null),
  ('Custom Goods & Services','SERV','PRODUCTION','Production services','INSPECTION','Quality inspection',null),
  ('Custom Goods & Services','SERV','SITE','Site & compliance','SITE','Site-specific requirement',null),
  ('Custom Goods & Services','SERV','SITE','Site & compliance','ENVTAX','Environmental tax',null),
  ('Custom Goods & Services','SERV','SITE','Site & compliance','OTHER','Other service',null),
  ('Custom Goods & Services','GOODS','PAPER','Paper','SHEETS','Paper sheets','4802.56'),
  ('Custom Goods & Services','GOODS','PAPER','Paper','REELS','Paper reels','4802.55'),
  ('Custom Goods & Services','GOODS','BESPOKE','Bespoke items','BESPOKE','Bespoke item',null),
  -- 2D/3D
  ('2D/3D','KIT','MIXED','Mixed POS kits','POSKIT','POS kit',null),
  ('2D/3D','KIT','MIXED','Mixed POS kits','STOREPACK','Store pack',null),
  ('2D/3D','KIT','MIXED','Mixed POS kits','LAUNCHKIT','Launch kit',null),
  -- Stocktool only
  ('Stocktool only','STOCK','STOCKLINE','Stock lines','REPLEN','Stock replenishment',null),
  ('Stocktool only','STOCK','STOCKLINE','Stock lines','CONSUMABLE','Consumables',null),
  ('Stocktool only','STOCK','STOCKLINE','Stock lines','PKGSTOCK','Packaging stock',null);

insert into public.tax_subcategories (category_id, code, name, display_order)
select c.id, t.sc, min(t.sn), min(t.n) * 10
  from _tax_seed t join public.tax_categories c on c.form_type = t.ft and c.code = t.cc
 group by c.id, t.sc;

insert into public.tax_product_types (category_id, subcategory_id, code, name, default_hs_code, display_order)
select c.id, s.id, t.pc, t.pn, t.hs, t.n * 10
  from _tax_seed t join public.tax_categories c on c.form_type = t.ft and c.code = t.cc
  join public.tax_subcategories s on s.category_id = c.id and s.code = t.sc
 where t.pc is not null;

-- Common alternative trade terms (generic, no brands).
insert into public.tax_aliases (alias, category_id, subcategory_id, product_type_id, source_reference)
select a.alias,
       case when a.sc is null then c.id end,
       case when a.sc is not null and a.pc is null then s.id end,
       p.id, 'Starter alias'
  from (values
    ('FSU', 'POS & Display', 'FLOOR', 'FSDU', null),
    ('Floor-standing unit', 'POS & Display', 'FLOOR', 'FSDU', null),
    ('Floor standing display', 'POS & Display', 'FLOOR', 'FSDU', null),
    ('Freestanding display', 'POS & Display', 'FLOOR', 'FSDU', null),
    ('Dump bin', 'POS & Display', 'FLOOR', 'DUMPBIN', null),
    ('Gondola end', 'POS & Display', 'FLOOR', 'GONDOLA', null),
    ('Standee', 'POS & Display', 'FLOOR', 'STAND', 'CUTOUT'),
    ('Counter unit', 'POS & Display', 'COUNTER', 'CDU', null),
    ('Wobbler', 'POS & Display', 'COUNTER', 'SHELF', 'WOBBLER'),
    ('Shelf edge strip', 'POS & Display', 'COUNTER', 'SHELF', 'STRIP'),
    ('Barker', 'POS & Display', 'COUNTER', 'SHELF', 'BARKER'),
    ('Shelf tray', 'POS & Display', 'COUNTER', 'SHELF', 'SHELFTRAY'),
    ('Header', 'POS & Display', 'COUNTER', 'HEADER', 'HEADERCARD'),
    ('Neck hanger', 'POS & Display', 'COUNTER', 'HEADER', 'NECKHANGER'),
    ('Dangler', 'POS & Display', 'WINDOW', 'WINDISP', 'CEILING'),
    ('Mobile', 'POS & Display', 'WINDOW', 'WINDISP', 'CEILING'),
    ('Fixture', 'POS & Display', 'PERM', 'FIXTURE', null),
    ('Bar mat', 'Merchandise', 'DRINK', 'BAR', 'RUNNER'),
    ('Beer mat', 'Merchandise', 'DRINK', 'BAR', 'COASTER'),
    ('Tote', 'Merchandise', 'BAGS', 'BAG', 'TOTE'),
    ('Hamper', 'Merchandise', 'GIFTING', 'HAMPER', 'HAMPER'),
    ('Gifting', 'Merchandise', 'GIFTING', null, null),
    ('Kitting and fulfilment', 'Logistics', 'WH', 'KFD', null),
    ('Roll-up banner', 'POS & Display', 'FLOOR', 'STAND', 'ROLLER')
  ) a(alias, ft, cc, sc, pc)
  join public.tax_categories c on c.form_type = a.ft and c.code = a.cc
  left join public.tax_subcategories s on s.category_id = c.id and s.code = a.sc
  left join public.tax_product_types p on p.subcategory_id = s.id and p.code = a.pc;

insert into public.tax_audit (domain, record_type, record_name, action, description, changed_by_name)
select 'Product', 'Taxonomy', 'Starter product taxonomy', 'import',
  format('Loaded the starter product taxonomy: %s categories, %s subcategories, %s product types and %s aliases across %s form types.',
    (select count(*) from public.tax_categories), (select count(*) from public.tax_subcategories), (select count(*) from public.tax_product_types),
    (select count(*) from public.tax_aliases), cardinality(public.tax_form_types())), 'System';

drop table _tax_seed;
drop table _tax_cat_seed;

-- ---------------------------------------------------------------------------
-- 5. Specs carry the full path
-- ---------------------------------------------------------------------------
alter table public.job_specs
  add column if not exists tax_form_type text check (tax_form_type is null or tax_form_type = any (public.tax_form_types())),
  add column if not exists tax_category_id uuid,
  add column if not exists tax_subcategory_id uuid,
  add column if not exists tax_product_type_id uuid,
  add column if not exists tax_category_name text,
  add column if not exists tax_subcategory_name text,
  add column if not exists tax_product_type_name text,
  add column if not exists tax_match text;
alter table public.job_specs
  add constraint job_specs_tax_category_fk foreign key (tax_category_id, tax_form_type) references public.tax_categories (id, form_type),
  add constraint job_specs_tax_subcategory_fk foreign key (tax_subcategory_id, tax_category_id) references public.tax_subcategories (id, category_id),
  add constraint job_specs_tax_product_type_fk foreign key (tax_product_type_id, tax_subcategory_id) references public.tax_product_types (id, subcategory_id);
create index job_specs_tax_category_idx on public.job_specs (tax_category_id);
create index job_specs_tax_subcategory_idx on public.job_specs (tax_subcategory_id);
create index job_specs_tax_product_type_idx on public.job_specs (tax_product_type_id);

create or replace function public.trg_job_specs_taxonomy() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ft text := public._tax_spec_form_type(new.spec_type); v_explicit boolean; r record; g record;
begin
  if tg_op = 'INSERT' then
    v_explicit := num_nonnulls(new.tax_category_id, new.tax_subcategory_id, new.tax_product_type_id) > 0;
  else
    v_explicit := (new.tax_category_id, new.tax_subcategory_id, new.tax_product_type_id)
                  is distinct from (old.tax_category_id, old.tax_subcategory_id, old.tax_product_type_id);
  end if;

  if v_explicit then
    if num_nonnulls(new.tax_category_id, new.tax_subcategory_id, new.tax_product_type_id) > 0 then
      select * into r from public._tax_path(new.tax_category_id, new.tax_subcategory_id, new.tax_product_type_id);
      new.tax_category_id := r.category_id; new.tax_subcategory_id := r.subcategory_id; new.tax_product_type_id := r.product_type_id;
      if tg_op = 'INSERT' then new.tax_match := coalesce(new.tax_match, 'Chosen by a person');
      elsif new.tax_match is not distinct from old.tax_match then new.tax_match := 'Chosen by a person'; end if;
      -- HS code: seeded from the product type default when a person picks it and the spec has none. Never overwritten.
      if new.tax_product_type_id is not null and coalesce(trim(new.hs_code), '') = ''
         and (tg_op = 'INSERT' or new.tax_product_type_id is distinct from old.tax_product_type_id)
         and new.tax_match not like 'Automatic:%' then
        new.hs_code := (select default_hs_code from public.tax_product_types where id = new.tax_product_type_id);
      end if;
    else
      new.tax_match := null;
    end if;
  elsif new.tax_category_id is null and (tg_op = 'INSERT'
        or (new.title, new.product_category, new.product_sub_type, new.spec_type) is distinct from (old.title, old.product_category, old.product_sub_type, old.spec_type)) then
    -- Free text resolves at the time it is saved (never at read time). Guesses never seed customs data.
    select * into g from public._tax_spec_guess(new.title, new.product_category, new.product_sub_type, v_ft);
    if g.category_id is not null then
      new.tax_category_id := g.category_id; new.tax_subcategory_id := g.subcategory_id; new.tax_product_type_id := g.product_type_id;
      new.tax_match := g.note;
    end if;
  end if;

  -- Names and form type always come from the master.
  if new.tax_category_id is not null then
    select form_type, name into new.tax_form_type, new.tax_category_name from public.tax_categories where id = new.tax_category_id;
  else
    new.tax_category_name := null;
    new.tax_form_type := case when tg_op = 'UPDATE' and new.spec_type is distinct from old.spec_type then v_ft else coalesce(new.tax_form_type, v_ft) end;
  end if;
  new.tax_subcategory_name := (select name from public.tax_subcategories where id = new.tax_subcategory_id);
  new.tax_product_type_name := (select name from public.tax_product_types where id = new.tax_product_type_id);
  return new;
end $$;
create trigger job_specs_taxonomy before insert or update on public.job_specs
  for each row execute function public.trg_job_specs_taxonomy();

-- Classify every unclassified spec from its free text (aliases and names as they are now). Returns counts.
create or replace function public._tax_backfill_specs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; g record; n int := 0; v_prev text := current_setting('sourcing.system_write', true);
begin
  perform set_config('sourcing.system_write', 'on', true); -- specs on live RFQs are locked to users, not to classification
  for s in select id, title, product_category, product_sub_type, spec_type from public.job_specs where tax_category_id is null loop
    select * into g from public._tax_spec_guess(s.title, s.product_category, s.product_sub_type, public._tax_spec_form_type(s.spec_type));
    if g.category_id is not null then
      update public.job_specs set tax_category_id = g.category_id, tax_subcategory_id = g.subcategory_id,
        tax_product_type_id = g.product_type_id, tax_match = g.note where id = s.id;
      n := n + 1;
    end if;
  end loop;
  update public.job_specs set tax_form_type = public._tax_spec_form_type(spec_type) where tax_category_id is null and tax_form_type is null;
  perform set_config('sourcing.system_write', coalesce(v_prev, ''), true);
  return jsonb_build_object('classified', n, 'unclassified', (select count(*) from public.job_specs where tax_category_id is null),
    'total', (select count(*) from public.job_specs));
end $$;

-- Refresh stored display names after a rename (the trigger re-reads them from the master).
create or replace function public._tax_refresh_spec_names() returns void
language plpgsql security definer set search_path = public as $$
declare v_prev text := current_setting('sourcing.system_write', true);
begin
  perform set_config('sourcing.system_write', 'on', true);
  update public.job_specs s set tax_match = s.tax_match
   where s.tax_category_id is not null
     and (s.tax_category_name is distinct from (select name from public.tax_categories where id = s.tax_category_id)
       or s.tax_subcategory_name is distinct from (select name from public.tax_subcategories where id = s.tax_subcategory_id)
       or s.tax_product_type_name is distinct from (select name from public.tax_product_types where id = s.tax_product_type_id));
  perform set_config('sourcing.system_write', coalesce(v_prev, ''), true);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Admin writes (all audited)
-- ---------------------------------------------------------------------------
create or replace function public._tax_code(p text) returns text language plpgsql immutable as $$
declare v text := upper(trim(coalesce(p, '')));
begin
  if v !~ '^[A-Z0-9][A-Z0-9_-]{0,23}$' then raise exception 'Give a code of up to 24 letters, digits, - or _ (no spaces)'; end if;
  return v;
end $$;

create or replace function public.tax_category_save(p_id uuid, p_form_type text, p_code text, p_name text, p_description text default null, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare o public.tax_categories; v_code text; v_name text := trim(coalesce(p_name, '')); v_desc text := nullif(trim(coalesce(p_description, '')), '');
  v_id uuid; v_ch text[] := '{}'; v_other text;
begin
  perform public._tax_admin();
  if p_form_type is null or not (p_form_type = any (public.tax_form_types())) then raise exception 'Choose a form type from the list'; end if;
  v_code := public._tax_code(p_code);
  if v_name = '' then raise exception 'Give the category a name'; end if;
  select name into v_other from public.tax_categories where form_type = p_form_type and code = v_code and id is distinct from p_id;
  if v_other is not null then raise exception 'Code % is already used by "%" in %', v_code, v_other, p_form_type; end if;
  select name into v_other from public.tax_categories where form_type = p_form_type and lower(name) = lower(v_name) and id is distinct from p_id;
  if v_other is not null then raise exception 'There is already a category called "%" in %', v_other, p_form_type; end if;
  if p_id is null then
    insert into public.tax_categories (form_type, code, name, description, active, display_order, created_by, updated_by)
    values (p_form_type, v_code, v_name, v_desc, coalesce(p_active, true),
            coalesce((select max(display_order) + 10 from public.tax_categories where form_type = p_form_type), 10), auth.uid(), auth.uid())
    returning id into v_id;
    perform public._tax_audit('Product', 'Category', v_id, v_name, v_code, 'create', format('Added category "%s" (%s) to %s.', v_name, v_code, p_form_type));
    return v_id;
  end if;
  select * into o from public.tax_categories where id = p_id for update;
  if o.id is null then raise exception 'Category not found'; end if;
  if o.form_type <> p_form_type then
    if exists (select 1 from public.job_specs where tax_category_id = p_id) then
      raise exception 'Specs use this category, so it can''t move to another form type. Add a new category instead.';
    end if;
    v_ch := v_ch || format('form type %s to %s', o.form_type, p_form_type);
  end if;
  if o.code <> v_code then v_ch := v_ch || format('code %s to %s', o.code, v_code); end if;
  if o.name <> v_name then v_ch := v_ch || format('name "%s" to "%s"', o.name, v_name); end if;
  if o.description is distinct from v_desc then v_ch := v_ch || 'description'::text; end if;
  if o.active <> coalesce(p_active, o.active) then v_ch := v_ch || (case when p_active then 'reactivated' else 'deactivated' end)::text; end if;
  if cardinality(v_ch) = 0 then return p_id; end if;
  update public.tax_categories set form_type = p_form_type, code = v_code, name = v_name, description = v_desc, active = coalesce(p_active, active),
    updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._tax_audit('Product', 'Category', p_id, v_name, v_code, 'update', format('Updated category "%s" (%s): %s.', v_name, v_code, array_to_string(v_ch, '; ')));
  if o.name <> v_name then perform public._tax_refresh_spec_names(); end if;
  return p_id;
end $$;

create or replace function public.tax_subcategory_save(p_id uuid, p_category uuid, p_code text, p_name text, p_description text default null, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare o public.tax_subcategories; c public.tax_categories; v_code text; v_name text := trim(coalesce(p_name, ''));
  v_desc text := nullif(trim(coalesce(p_description, '')), ''); v_id uuid; v_ch text[] := '{}'; v_other text;
begin
  perform public._tax_admin();
  select * into c from public.tax_categories where id = p_category;
  if c.id is null then raise exception 'Choose the category this subcategory belongs to'; end if;
  v_code := public._tax_code(p_code);
  if v_name = '' then raise exception 'Give the subcategory a name'; end if;
  select name into v_other from public.tax_subcategories where category_id = p_category and code = v_code and id is distinct from p_id;
  if v_other is not null then raise exception 'Code % is already used by "%" in %', v_code, v_other, c.name; end if;
  select name into v_other from public.tax_subcategories where category_id = p_category and lower(name) = lower(v_name) and id is distinct from p_id;
  if v_other is not null then raise exception 'There is already a subcategory called "%" in %', v_other, c.name; end if;
  if p_id is null then
    insert into public.tax_subcategories (category_id, code, name, description, active, display_order, created_by, updated_by)
    values (p_category, v_code, v_name, v_desc, coalesce(p_active, true),
            coalesce((select max(display_order) + 10 from public.tax_subcategories where category_id = p_category), 10), auth.uid(), auth.uid())
    returning id into v_id;
    perform public._tax_audit('Product', 'Subcategory', v_id, v_name, v_code, 'create',
      format('Added subcategory "%s" (%s) under %s.', v_name, v_code, public.tax_path_label(p_category, null, null)));
    return v_id;
  end if;
  select * into o from public.tax_subcategories where id = p_id for update;
  if o.id is null then raise exception 'Subcategory not found'; end if;
  if o.category_id <> p_category then
    if exists (select 1 from public.job_specs where tax_subcategory_id = p_id) then
      raise exception 'Specs use this subcategory, so it can''t move to another category. Add a new subcategory instead.';
    end if;
    v_ch := v_ch || format('moved from %s to %s', public.tax_path_label(o.category_id, null, null), public.tax_path_label(p_category, null, null));
  end if;
  if o.code <> v_code then v_ch := v_ch || format('code %s to %s', o.code, v_code); end if;
  if o.name <> v_name then v_ch := v_ch || format('name "%s" to "%s"', o.name, v_name); end if;
  if o.description is distinct from v_desc then v_ch := v_ch || 'description'::text; end if;
  if o.active <> coalesce(p_active, o.active) then v_ch := v_ch || (case when p_active then 'reactivated' else 'deactivated' end)::text; end if;
  if cardinality(v_ch) = 0 then return p_id; end if;
  update public.tax_subcategories set category_id = p_category, code = v_code, name = v_name, description = v_desc,
    active = coalesce(p_active, active), updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._tax_audit('Product', 'Subcategory', p_id, v_name, v_code, 'update', format('Updated subcategory "%s" (%s): %s.', v_name, v_code, array_to_string(v_ch, '; ')));
  if o.name <> v_name then perform public._tax_refresh_spec_names(); end if;
  return p_id;
end $$;

create or replace function public.tax_product_type_save(p_id uuid, p_subcategory uuid, p_code text, p_name text, p_default_hs_code text default null,
  p_description text default null, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare o public.tax_product_types; s public.tax_subcategories; v_code text; v_name text := trim(coalesce(p_name, ''));
  v_desc text := nullif(trim(coalesce(p_description, '')), ''); v_hs text := nullif(replace(trim(coalesce(p_default_hs_code, '')), ' ', ''), '');
  v_id uuid; v_ch text[] := '{}'; v_other text;
begin
  perform public._tax_admin();
  select * into s from public.tax_subcategories where id = p_subcategory;
  if s.id is null then raise exception 'Choose the subcategory this product type belongs to'; end if;
  v_code := public._tax_code(p_code);
  if v_name = '' then raise exception 'Give the product type a name'; end if;
  if v_hs is not null and v_hs !~ '^[0-9]{4}([.]?[0-9]{2}){0,3}$' then raise exception 'An HS code is 4 to 10 digits, e.g. 4911.10'; end if;
  select name into v_other from public.tax_product_types where subcategory_id = p_subcategory and code = v_code and id is distinct from p_id;
  if v_other is not null then raise exception 'Code % is already used by "%" in %', v_code, v_other, s.name; end if;
  select name into v_other from public.tax_product_types where subcategory_id = p_subcategory and lower(name) = lower(v_name) and id is distinct from p_id;
  if v_other is not null then raise exception 'There is already a product type called "%" in %', v_other, s.name; end if;
  if p_id is null then
    insert into public.tax_product_types (category_id, subcategory_id, code, name, default_hs_code, description, active, display_order, created_by, updated_by)
    values (s.category_id, p_subcategory, v_code, v_name, v_hs, v_desc, coalesce(p_active, true),
            coalesce((select max(display_order) + 10 from public.tax_product_types where subcategory_id = p_subcategory), 10), auth.uid(), auth.uid())
    returning id into v_id;
    perform public._tax_audit('Product', 'Product type', v_id, v_name, v_code, 'create',
      format('Added product type "%s" (%s) under %s%s.', v_name, v_code, public.tax_path_label(null, p_subcategory, null),
             coalesce(', default HS code ' || v_hs, '')));
    return v_id;
  end if;
  select * into o from public.tax_product_types where id = p_id for update;
  if o.id is null then raise exception 'Product type not found'; end if;
  if o.subcategory_id <> p_subcategory then
    if exists (select 1 from public.job_specs where tax_product_type_id = p_id) then
      raise exception 'Specs use this product type, so it can''t move to another subcategory. Add a new product type instead.';
    end if;
    v_ch := v_ch || format('moved from %s to %s', public.tax_path_label(null, o.subcategory_id, null), public.tax_path_label(null, p_subcategory, null));
  end if;
  if o.code <> v_code then v_ch := v_ch || format('code %s to %s', o.code, v_code); end if;
  if o.name <> v_name then v_ch := v_ch || format('name "%s" to "%s"', o.name, v_name); end if;
  if o.default_hs_code is distinct from v_hs then v_ch := v_ch || format('default HS code %s to %s', coalesce(o.default_hs_code, 'none'), coalesce(v_hs, 'none')); end if;
  if o.description is distinct from v_desc then v_ch := v_ch || 'description'::text; end if;
  if o.active <> coalesce(p_active, o.active) then v_ch := v_ch || (case when p_active then 'reactivated' else 'deactivated' end)::text; end if;
  if cardinality(v_ch) = 0 then return p_id; end if;
  update public.tax_product_types set category_id = s.category_id, subcategory_id = p_subcategory, code = v_code, name = v_name,
    default_hs_code = v_hs, description = v_desc, active = coalesce(p_active, active), updated_by = auth.uid(), updated_at = now() where id = p_id;
  perform public._tax_audit('Product', 'Product type', p_id, v_name, v_code, 'update', format('Updated product type "%s" (%s): %s.', v_name, v_code, array_to_string(v_ch, '; ')));
  if o.name <> v_name then perform public._tax_refresh_spec_names(); end if;
  return p_id;
end $$;

-- What uses a node: children, specs, aliases, mappings (the deactivation warning and the delete guard).
create or replace function public.tax_usage(p_level text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only adm Indicia staff can see taxonomy usage' using errcode = '42501'; end if;
  return case p_level
    when 'category' then jsonb_build_object(
      'children', (select count(*) from public.tax_subcategories where category_id = p_id),
      'active_children', (select count(*) from public.tax_subcategories where category_id = p_id and active),
      'product_types', (select count(*) from public.tax_product_types where category_id = p_id),
      'specs', (select count(*) from public.job_specs where tax_category_id = p_id),
      'aliases', (select count(*) from public.tax_aliases where category_id = p_id),
      'mappings', (select count(*) from public.tax_mappings where category_id = p_id and status <> 'Archived'))
    when 'subcategory' then jsonb_build_object(
      'children', (select count(*) from public.tax_product_types where subcategory_id = p_id),
      'active_children', (select count(*) from public.tax_product_types where subcategory_id = p_id and active),
      'product_types', (select count(*) from public.tax_product_types where subcategory_id = p_id),
      'specs', (select count(*) from public.job_specs where tax_subcategory_id = p_id),
      'aliases', (select count(*) from public.tax_aliases where subcategory_id = p_id),
      'mappings', (select count(*) from public.tax_mappings where subcategory_id = p_id and status <> 'Archived'))
    when 'product_type' then jsonb_build_object('children', 0, 'active_children', 0, 'product_types', 0,
      'specs', (select count(*) from public.job_specs where tax_product_type_id = p_id),
      'aliases', (select count(*) from public.tax_aliases where product_type_id = p_id),
      'mappings', (select count(*) from public.tax_mappings where product_type_id = p_id and status <> 'Archived'))
    else null end;
end $$;

create or replace function public._tax_node(p_level text, p_id uuid, out name text, out code text, out label text, out kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_level = 'category' then select c.name, c.code into name, code from public.tax_categories c where c.id = p_id; label := public.tax_path_label(p_id, null, null); kind := 'Category';
  elsif p_level = 'subcategory' then select s.name, s.code into name, code from public.tax_subcategories s where s.id = p_id; label := public.tax_path_label(null, p_id, null); kind := 'Subcategory';
  elsif p_level = 'product_type' then select p.name, p.code into name, code from public.tax_product_types p where p.id = p_id; label := public.tax_path_label(null, null, p_id); kind := 'Product type';
  else raise exception 'Unknown taxonomy level %', p_level; end if;
  if name is null then raise exception '% not found', kind; end if;
end $$;

-- Deactivate or reactivate. Deactivating is always allowed: records that use the node keep it; it leaves the picker.
create or replace function public.tax_toggle(p_level text, p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare n record; u jsonb; v_was boolean;
begin
  perform public._tax_admin();
  select * into n from public._tax_node(p_level, p_id);
  u := public.tax_usage(p_level, p_id);
  if p_level = 'category' then select active into v_was from public.tax_categories where id = p_id; update public.tax_categories set active = p_active, updated_by = auth.uid(), updated_at = now() where id = p_id;
  elsif p_level = 'subcategory' then select active into v_was from public.tax_subcategories where id = p_id; update public.tax_subcategories set active = p_active, updated_by = auth.uid(), updated_at = now() where id = p_id;
  else select active into v_was from public.tax_product_types where id = p_id; update public.tax_product_types set active = p_active, updated_by = auth.uid(), updated_at = now() where id = p_id; end if;
  if v_was = p_active then return; end if;
  perform public._tax_audit('Product', n.kind, p_id, n.name, n.code, 'toggle',
    case when p_active then format('Reactivated %s "%s" (%s): it is back in the picker.', lower(n.kind), n.name, n.code)
    else format('Deactivated %s "%s" (%s). It leaves the picker; %s specs, %s active children and %s aliases still point to it and keep working.',
      lower(n.kind), n.name, n.code, u->>'specs', u->>'active_children', u->>'aliases') end);
end $$;

-- Reorder siblings: p_ids in the new order (all must share one parent).
create or replace function public.tax_reorder(p_level text, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_parents int; v_n int; v_parent text;
begin
  perform public._tax_admin();
  if coalesce(cardinality(p_ids), 0) = 0 then return; end if;
  if p_level = 'category' then
    select count(distinct form_type), count(*), min(form_type) into v_parents, v_n, v_parent from public.tax_categories where id = any (p_ids);
  elsif p_level = 'subcategory' then
    select count(distinct category_id), count(*), min((select name from public.tax_categories where id = category_id)) into v_parents, v_n, v_parent from public.tax_subcategories where id = any (p_ids);
  elsif p_level = 'product_type' then
    select count(distinct subcategory_id), count(*), min((select name from public.tax_subcategories where id = subcategory_id)) into v_parents, v_n, v_parent from public.tax_product_types where id = any (p_ids);
  else raise exception 'Unknown taxonomy level %', p_level; end if;
  if v_parents <> 1 or v_n <> cardinality(p_ids) then raise exception 'Reorder items that share one parent'; end if;
  if p_level = 'category' then
    update public.tax_categories t set display_order = x.n * 10, updated_by = auth.uid(), updated_at = now() from unnest(p_ids) with ordinality x(id, n) where t.id = x.id;
  elsif p_level = 'subcategory' then
    update public.tax_subcategories t set display_order = x.n * 10, updated_by = auth.uid(), updated_at = now() from unnest(p_ids) with ordinality x(id, n) where t.id = x.id;
  else
    update public.tax_product_types t set display_order = x.n * 10, updated_by = auth.uid(), updated_at = now() from unnest(p_ids) with ordinality x(id, n) where t.id = x.id;
  end if;
  perform public._tax_audit('Product', initcap(replace(p_level, '_', ' ')), null, v_parent, null, 'reorder',
    format('Reordered %s %s in %s.', v_n, case p_level when 'category' then 'categories' when 'subcategory' then 'subcategories' else 'product types' end, v_parent));
end $$;

-- Delete only when nothing uses the node (no children, specs or mappings). Its aliases go with it.
create or replace function public.tax_delete(p_level text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n record; u jsonb;
begin
  perform public._tax_admin();
  select * into n from public._tax_node(p_level, p_id);
  u := public.tax_usage(p_level, p_id);
  if (u->>'children')::int > 0 then raise exception '"%" still has % %: remove or move them first, or deactivate it', n.name, u->>'children',
    case p_level when 'category' then 'subcategories' else 'product types' end; end if;
  if (u->>'specs')::int > 0 then raise exception '% specs use "%": deactivate it instead', u->>'specs', n.name; end if;
  if (u->>'mappings')::int > 0 then raise exception '% cross-system mappings point to "%": deactivate it instead', u->>'mappings', n.name; end if;
  if exists (select 1 from public.tax_mappings where (p_level = 'category' and category_id = p_id) or (p_level = 'subcategory' and subcategory_id = p_id)
             or (p_level = 'product_type' and product_type_id = p_id)) then
    raise exception 'Archived mappings still point to "%": deactivate it instead', n.name;
  end if;
  perform public._tax_audit('Product', n.kind, p_id, n.name, n.code, 'delete',
    format('Deleted %s "%s" (%s) from %s%s.', lower(n.kind), n.name, n.code, n.label,
      case when (u->>'aliases')::int > 0 then format(' and its %s aliases', u->>'aliases') else '' end));
  if p_level = 'category' then delete from public.tax_categories where id = p_id;
  elsif p_level = 'subcategory' then delete from public.tax_subcategories where id = p_id;
  else delete from public.tax_product_types where id = p_id; end if;
end $$;

-- Aliases: exactly one target. Given a full path (from the picker), the deepest chosen node is the target.
create or replace function public.tax_alias_save(p_id uuid, p_alias text, p_category uuid, p_subcategory uuid, p_product_type uuid,
  p_source_system text default null, p_source_reference text default null, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_alias text := trim(coalesce(p_alias, '')); r record; v_other record; v_id uuid; v_label text; v_src text := nullif(trim(coalesce(p_source_system, '')), '');
begin
  perform public._tax_admin();
  if v_alias = '' then raise exception 'Type the alternative term'; end if;
  if v_src is not null and not (v_src = any (public.tax_source_systems())) then raise exception 'Choose a source system from the list'; end if;
  select * into r from public._tax_path(p_category, p_subcategory, p_product_type);
  if r.category_id is null then raise exception 'Choose what the term means (at least a category)'; end if;
  if coalesce(p_active, true) then
    select a.id, public.tax_path_label(a.category_id, a.subcategory_id, a.product_type_id) as label into v_other
      from public.tax_aliases a where a.active and a.alias_norm = public._tax_norm(v_alias) and a.id is distinct from p_id;
    if v_other.id is not null then raise exception 'The term "%" already points to %', v_alias, v_other.label; end if;
  end if;
  v_label := public.tax_path_label(r.category_id, r.subcategory_id, r.product_type_id);
  if p_id is null then
    insert into public.tax_aliases (alias, category_id, subcategory_id, product_type_id, source_system, source_reference, active, created_by, updated_by)
    values (v_alias, case when r.subcategory_id is null then r.category_id end,
            case when r.product_type_id is null then r.subcategory_id end, r.product_type_id,
            v_src, nullif(trim(coalesce(p_source_reference, '')), ''), coalesce(p_active, true), auth.uid(), auth.uid())
    returning id into v_id;
    perform public._tax_audit('Product', 'Alias', v_id, v_alias, null, 'create', format('Added alias "%s" for %s%s.', v_alias, v_label, coalesce(' (from ' || v_src || ')', '')));
    return v_id;
  end if;
  update public.tax_aliases set alias = v_alias, category_id = case when r.subcategory_id is null then r.category_id end,
    subcategory_id = case when r.product_type_id is null then r.subcategory_id end, product_type_id = r.product_type_id,
    source_system = v_src, source_reference = nullif(trim(coalesce(p_source_reference, '')), ''), active = coalesce(p_active, true),
    updated_by = auth.uid(), updated_at = now() where id = p_id;
  if not found then raise exception 'Alias not found'; end if;
  perform public._tax_audit('Product', 'Alias', p_id, v_alias, null, 'update',
    format('Updated alias "%s": now points to %s%s.', v_alias, v_label, case when coalesce(p_active, true) then '' else ' (inactive)' end));
  return p_id;
end $$;

create or replace function public.tax_alias_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.tax_aliases;
begin
  perform public._tax_admin();
  select * into a from public.tax_aliases where id = p_id;
  if a.id is null then raise exception 'Alias not found'; end if;
  perform public._tax_audit('Product', 'Alias', p_id, a.alias, null, 'delete',
    format('Deleted alias "%s" (it pointed to %s).', a.alias, public.tax_path_label(a.category_id, a.subcategory_id, a.product_type_id)));
  update public.tax_mappings set alias_id = null where alias_id = p_id;
  delete from public.tax_aliases where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Specs: admin classification, re-run, unclassified list
-- ---------------------------------------------------------------------------
create or replace function public.tax_classify_spec(p_spec uuid, p_category uuid, p_subcategory uuid, p_product_type uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.job_specs; r record; v_prev text := current_setting('sourcing.system_write', true); v_label text;
begin
  perform public._tax_admin();
  select * into s from public.job_specs where id = p_spec;
  if s.id is null then raise exception 'Spec not found'; end if;
  select * into r from public._tax_path(p_category, p_subcategory, p_product_type);
  if r.category_id is null then raise exception 'Choose at least a category'; end if;
  perform set_config('sourcing.system_write', 'on', true);
  update public.job_specs set tax_category_id = r.category_id, tax_subcategory_id = r.subcategory_id, tax_product_type_id = r.product_type_id,
    tax_match = 'Classified by an admin' where id = p_spec;
  perform set_config('sourcing.system_write', coalesce(v_prev, ''), true);
  v_label := public.tax_path_label(r.category_id, r.subcategory_id, r.product_type_id);
  perform public._tax_audit('Product', 'Spec classification', p_spec, s.title, null, 'classify',
    format('Classified spec "%s" (%s) as %s%s.', s.title, (select job_number from public.jobs where id = s.job_id) || '-' || s.spec_no, v_label,
      case when s.tax_category_id is not null then format(' (was %s)', public.tax_path_label(s.tax_category_id, s.tax_subcategory_id, s.tax_product_type_id)) else '' end));
end $$;

create or replace function public.tax_backfill_run() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public._tax_admin();
  r := public._tax_backfill_specs();
  perform public._tax_audit('Product', 'Spec classification', null, 'Automatic classification', null, 'classify',
    format('Re-ran automatic classification: %s specs classified, %s still unclassified.', r->>'classified', r->>'unclassified'));
  return r;
end $$;

create or replace function public.tax_unclassified_specs(p_q text default null, p_limit int default 200) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', s.id, 'spec_no', s.spec_no, 'title', s.title, 'spec_type', s.spec_type, 'form_type', s.tax_form_type,
      'product_category', s.product_category, 'product_sub_type', s.product_sub_type, 'job_id', j.id, 'job_number', j.job_number,
      'client_name', c.name, 'created_at', s.created_at) as x
      from public.job_specs s join public.jobs j on j.id = s.job_id left join public.sourcing_clients c on c.id = j.client_id
     where public.is_internal() and s.tax_category_id is null
       and (coalesce(trim(p_q), '') = '' or (s.title || ' ' || coalesce(s.product_category, '') || ' ' || coalesce(s.product_sub_type, '') || ' ' || j.job_number) ilike '%' || trim(p_q) || '%')
     order by s.created_at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))) q;
$$;

create or replace function public.tax_classification_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', count(*), 'classified', count(*) filter (where tax_category_id is not null),
    'unclassified', count(*) filter (where tax_category_id is null),
    'with_product_type', count(*) filter (where tax_product_type_id is not null),
    'automatic', count(*) filter (where tax_match like 'Automatic:%'),
    'by_person', count(*) filter (where tax_match = 'Chosen by a person'),
    'by_admin', count(*) filter (where tax_match = 'Classified by an admin'))
  from public.job_specs where public.is_internal();
$$;

-- ---------------------------------------------------------------------------
-- 8. Cross-system mappings (admins only)
-- ---------------------------------------------------------------------------
-- Queue one external value. Confidence: exact name 1.0, alias 0.95, code 0.9, contained term 0.7, similar words < 0.7.
-- p_skip_exact: values that already resolve exactly through a name or alias are not "unmapped" and are skipped.
create or replace function public._tax_mapping_add(p_src text, p_ft text, p_cat text, p_sub text, p_pt text, p_n int, p_ref text, p_skip_exact boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ft text := nullif(trim(coalesce(p_ft, '')), ''); v_cat text := nullif(trim(coalesce(p_cat, '')), ''); v_sub text := nullif(trim(coalesce(p_sub, '')), '');
  v_pt text := nullif(trim(coalesce(p_pt, '')), ''); v_text text; v_key text; r record; v_basis text; v_pref text;
begin
  v_text := coalesce(v_pt, v_sub, v_cat);
  if v_text is null then return false; end if;
  v_key := lower(coalesce(v_ft, '') || '|' || coalesce(v_cat, '') || '|' || coalesce(v_sub, '') || '|' || coalesce(v_pt, ''));
  if exists (select 1 from public.tax_mappings where source_system = p_src and source_key = v_key) then
    update public.tax_mappings set occurrences = greatest(occurrences, coalesce(p_n, 0)), updated_at = now() where source_system = p_src and source_key = v_key;
    return false;
  end if;
  v_pref := case when v_ft = any (public.tax_form_types()) then v_ft end;
  select * into r from public.tax_resolve(v_text, v_pref, false);
  if r.category_id is not null and p_skip_exact then return false; end if;
  if r.category_id is not null then v_basis := r.match_kind;
  else
    select * into r from public.tax_resolve(v_text, v_pref, true);
    if r.category_id is not null then v_basis := 'contains';
    else select * into r from public._tax_fuzzy(v_text, v_pref); v_basis := r.match_kind; end if;
  end if;
  insert into public.tax_mappings (source_system, source_form_type, source_category, source_subcategory, source_product_type,
    category_id, subcategory_id, product_type_id, status, confidence, match_basis, occurrences, source_reference, created_by)
  values (p_src, v_ft, v_cat, v_sub, v_pt,
    case when r.confidence >= 0.5 then r.category_id end, case when r.confidence >= 0.5 then r.subcategory_id end,
    case when r.confidence >= 0.5 then r.product_type_id end,
    case when r.category_id is not null and r.confidence >= 0.5 then 'Suggested' else 'Unmapped' end,
    coalesce(r.confidence, 0), case when r.category_id is not null then format('%s: "%s"', v_basis, r.term) end,
    coalesce(p_n, 0), nullif(trim(coalesce(p_ref, '')), ''), auth.uid());
  return true;
end $$;

-- Find distinct external values in existing data that don't resolve yet and queue them.
--   Sourcing Hub: spec product category / sub-type (per spec form type) and job categories.
--   ADM: Shopper IQ touchpoint types (the POSM touchpoint library).
create or replace function public.tax_mapping_propose() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record; n int := 0;
begin
  perform public._tax_admin();
  for v in
    select 'Sourcing Hub' as src, public._tax_spec_form_type(s.spec_type) as ft, nullif(trim(s.product_category), '') as cat, null::text as sub,
           nullif(trim(s.product_sub_type), '') as pt, count(*)::int as n, 'job_specs.product_category / product_sub_type' as ref
      from public.job_specs s where coalesce(trim(s.product_category), '') <> '' or coalesce(trim(s.product_sub_type), '') <> ''
     group by 2, 3, 5
    union all
    select 'Sourcing Hub', null, trim(j.category), null, null, count(*)::int, 'jobs.category'
      from public.jobs j where coalesce(trim(j.category), '') <> '' group by trim(j.category)
    union all
    select 'ADM', null, null, null, r.name, 1, 'Shopper IQ touchpoint ' || r.code
      from public.library_records r where r.library_key = 'touchpoint_types' and r.status = 'active'
  loop
    if public._tax_mapping_add(v.src, v.ft, v.cat, v.sub, v.pt, v.n, v.ref, true) then n := n + 1; end if;
  end loop;
  perform public._tax_audit('Product', 'Mapping', null, 'Unmapped values', null, 'import',
    format('Looked for unmapped values in existing data: %s new mapping rows queued.', n));
  return jsonb_build_object('queued', n);
end $$;

-- Queue values from another system (e.g. a Stocktool or Airtable export). p_rows: [{form_type, category, subcategory,
-- product_type, reference}]. Values that already resolve are queued as Suggested so an admin confirms them.
create or replace function public.tax_mapping_import(p_source text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0; m int := 0;
begin
  perform public._tax_admin();
  if p_source is null or not (p_source = any (public.tax_source_systems())) then raise exception 'Choose a source system from the list'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Nothing to import'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    m := m + 1;
    if public._tax_mapping_add(p_source, x->>'form_type', x->>'category', x->>'subcategory', x->>'product_type', 1, x->>'reference', false) then n := n + 1; end if;
  end loop;
  perform public._tax_audit('Product', 'Mapping', null, p_source, null, 'import', format('Imported %s values from %s: %s new mapping rows queued.', m, p_source, n));
  return jsonb_build_object('rows', m, 'queued', n);
end $$;

-- Review: approve (creates the alias that makes the external value resolve), reject, archive or mark for review.
create or replace function public.tax_mapping_review(p_id uuid, p_decision text, p_category uuid default null, p_subcategory uuid default null,
  p_product_type uuid default null, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.tax_mappings; r record; v_text text; v_alias uuid; v_other record; v_label text; v_name text; b jsonb;
begin
  perform public._tax_admin();
  select * into m from public.tax_mappings where id = p_id for update;
  if m.id is null then raise exception 'Mapping not found'; end if;
  v_name := concat_ws(' / ', m.source_form_type, m.source_category, m.source_subcategory, m.source_product_type);
  if p_decision = 'approve' then
    if m.status = 'Approved' then raise exception 'This mapping is already approved'; end if;
    if num_nonnulls(p_category, p_subcategory, p_product_type) > 0 then
      select * into r from public._tax_path(p_category, p_subcategory, p_product_type);
    else
      select * into r from public._tax_path(m.category_id, m.subcategory_id, m.product_type_id);
    end if;
    if r.category_id is null then raise exception 'Choose what the external value maps to before approving'; end if;
    v_text := coalesce(m.source_product_type, m.source_subcategory, m.source_category, m.source_form_type);
    select a.id, a.category_id, a.subcategory_id, a.product_type_id into v_other from public.tax_aliases a
     where a.active and a.alias_norm = public._tax_norm(v_text);
    v_label := public.tax_path_label(r.category_id, r.subcategory_id, r.product_type_id);
    if v_other.id is not null then
      if coalesce(v_other.product_type_id, v_other.subcategory_id, v_other.category_id) is distinct from coalesce(r.product_type_id, r.subcategory_id, r.category_id) then
        raise exception 'The term "%" already points to %: change that alias first', v_text, public.tax_path_label(v_other.category_id, v_other.subcategory_id, v_other.product_type_id);
      end if;
      v_alias := v_other.id;
    elsif exists (select 1 from public.v_tax_terms t where t.kind = 'name' and t.norm = public._tax_norm(v_text)
                   and t.node_id = coalesce(r.product_type_id, r.subcategory_id, r.category_id)) then
      v_alias := null; -- the value is already the node's own name: nothing to add
    else
      insert into public.tax_aliases (alias, category_id, subcategory_id, product_type_id, source_system, source_reference, created_by, updated_by)
      values (v_text, case when r.subcategory_id is null then r.category_id end, case when r.product_type_id is null then r.subcategory_id end,
              r.product_type_id, m.source_system, coalesce(m.source_reference, 'Mapping ' || m.id), auth.uid(), auth.uid())
      returning id into v_alias;
      perform public._tax_audit('Product', 'Alias', v_alias, v_text, null, 'create',
        format('Added alias "%s" for %s from an approved %s mapping.', v_text, v_label, m.source_system));
    end if;
    update public.tax_mappings set status = 'Approved', category_id = r.category_id, subcategory_id = r.subcategory_id, product_type_id = r.product_type_id,
      alias_id = v_alias, reviewed_by = auth.uid(), reviewed_at = now(), notes = coalesce(nullif(trim(p_notes), ''), notes), updated_at = now() where id = p_id;
    perform public._tax_audit('Product', 'Mapping', p_id, v_name, null, 'approve', format('Approved the %s value "%s" as %s.', m.source_system, v_name, v_label));
    b := public._tax_backfill_specs();
    return jsonb_build_object('alias_id', v_alias, 'classified', b->'classified');
  elsif p_decision in ('reject', 'archive', 'pending') then
    if p_decision = 'reject' and coalesce(trim(p_notes), '') = '' then raise exception 'Say why the mapping is rejected'; end if;
    update public.tax_mappings set status = case p_decision when 'reject' then 'Rejected' when 'archive' then 'Archived' else 'Pending review' end,
      reviewed_by = case when p_decision = 'pending' then reviewed_by else auth.uid() end,
      reviewed_at = case when p_decision = 'pending' then reviewed_at else now() end,
      notes = coalesce(nullif(trim(p_notes), ''), notes), updated_at = now() where id = p_id;
    perform public._tax_audit('Product', 'Mapping', p_id, v_name, null, case p_decision when 'reject' then 'reject' when 'archive' then 'archive' else 'update' end,
      format('%s the %s value "%s"%s.', case p_decision when 'reject' then 'Rejected' when 'archive' then 'Archived' else 'Marked for review' end,
        m.source_system, v_name, coalesce(': ' || nullif(trim(p_notes), ''), '')));
    return jsonb_build_object('status', p_decision);
  end if;
  raise exception 'Choose approve, reject, archive or pending';
end $$;

-- ---------------------------------------------------------------------------
-- 9. Reporting: spec → taxonomy path (join to rpt_spec_lines on spec_id). rpt_spec_lines itself is unchanged.
-- ---------------------------------------------------------------------------
create view public.v_spec_taxonomy with (security_invoker = true) as
  select s.id as spec_id, s.job_id, s.spec_no, s.spec_type, s.tax_form_type as form_type,
         s.tax_category_id as category_id, c.code as category_code, coalesce(c.name, s.tax_category_name) as category_name,
         s.tax_subcategory_id as subcategory_id, sc.code as subcategory_code, coalesce(sc.name, s.tax_subcategory_name) as subcategory_name,
         s.tax_product_type_id as product_type_id, p.code as product_type_code, coalesce(p.name, s.tax_product_type_name) as product_type_name,
         p.default_hs_code, s.hs_code, s.tax_match as classified_by, (s.tax_category_id is not null) as classified
    from public.job_specs s
    left join public.tax_categories c on c.id = s.tax_category_id
    left join public.tax_subcategories sc on sc.id = s.tax_subcategory_id
    left join public.tax_product_types p on p.id = s.tax_product_type_id;

-- ---------------------------------------------------------------------------
-- 10. Row-level security and privileges
-- ---------------------------------------------------------------------------
alter table public.tax_categories enable row level security;
alter table public.tax_subcategories enable row level security;
alter table public.tax_product_types enable row level security;
alter table public.tax_aliases enable row level security;
alter table public.tax_mappings enable row level security;
alter table public.tax_audit enable row level security;
create policy tax_categories_read on public.tax_categories for select to authenticated using (true);
create policy tax_subcategories_read on public.tax_subcategories for select to authenticated using (true);
create policy tax_product_types_read on public.tax_product_types for select to authenticated using (true);
create policy tax_aliases_read on public.tax_aliases for select to authenticated using (true);
create policy tax_mappings_read on public.tax_mappings for select to authenticated using (public.is_admin());
create policy tax_audit_read on public.tax_audit for select to authenticated using (public.is_internal());

revoke insert, update, delete on public.tax_categories, public.tax_subcategories, public.tax_product_types, public.tax_aliases,
  public.tax_mappings, public.tax_audit from authenticated, anon;
revoke all on public.tax_categories, public.tax_subcategories, public.tax_product_types, public.tax_aliases,
  public.tax_mappings, public.tax_audit, public.v_tax_terms, public.v_spec_taxonomy from anon;
revoke insert, update, delete on public.v_tax_terms, public.v_spec_taxonomy from authenticated;

revoke execute on function public.trg_tax_audit_append_only(), public._tax_admin(), public._tax_audit(text, text, uuid, text, text, text, text),
  public._tax_path(uuid, uuid, uuid), public.trg_job_specs_taxonomy(), public._tax_backfill_specs(), public._tax_refresh_spec_names(),
  public._tax_node(text, uuid), public._tax_mapping_add(text, text, text, text, text, int, text, boolean), public._tax_spec_guess(text, text, text, text),
  public._tax_fuzzy(text, text)
  from public, anon, authenticated;
revoke execute on function public.tax_resolve(text, text, boolean), public.tax_path_label(uuid, uuid, uuid), public.tax_audit_log(text, text, uuid, text, text, text, text),
  public.tax_category_save(uuid, text, text, text, text, boolean), public.tax_subcategory_save(uuid, uuid, text, text, text, boolean),
  public.tax_product_type_save(uuid, uuid, text, text, text, text, boolean), public.tax_usage(text, uuid), public.tax_toggle(text, uuid, boolean),
  public.tax_reorder(text, uuid[]), public.tax_delete(text, uuid),
  public.tax_alias_save(uuid, text, uuid, uuid, uuid, text, text, boolean), public.tax_alias_delete(uuid),
  public.tax_classify_spec(uuid, uuid, uuid, uuid), public.tax_backfill_run(), public.tax_unclassified_specs(text, int), public.tax_classification_summary(),
  public.tax_mapping_propose(), public.tax_mapping_import(text, jsonb), public.tax_mapping_review(uuid, text, uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.tax_resolve(text, text, boolean), public.tax_path_label(uuid, uuid, uuid), public.tax_audit_log(text, text, uuid, text, text, text, text),
  public.tax_category_save(uuid, text, text, text, text, boolean), public.tax_subcategory_save(uuid, uuid, text, text, text, boolean),
  public.tax_product_type_save(uuid, uuid, text, text, text, text, boolean), public.tax_usage(text, uuid), public.tax_toggle(text, uuid, boolean),
  public.tax_reorder(text, uuid[]), public.tax_delete(text, uuid),
  public.tax_alias_save(uuid, text, uuid, uuid, uuid, text, text, boolean), public.tax_alias_delete(uuid),
  public.tax_classify_spec(uuid, uuid, uuid, uuid), public.tax_backfill_run(), public.tax_unclassified_specs(text, int), public.tax_classification_summary(),
  public.tax_mapping_propose(), public.tax_mapping_import(text, jsonb), public.tax_mapping_review(uuid, text, uuid, uuid, uuid, text),
  public.tax_form_types(), public.tax_source_systems(), public._tax_norm(text), public._tax_spec_form_type(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Backfill existing specs (unresolved rows stay null and are listed in Watchtower → Product taxonomy)
-- ---------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  r := public._tax_backfill_specs();
  if (r->>'total')::int > 0 then
    insert into public.tax_audit (domain, record_type, record_name, action, description, changed_by_name)
    values ('Product', 'Spec classification', 'Automatic classification', 'classify',
      format('Classified existing specs from their free text: %s of %s classified, %s left for review.', r->>'classified', r->>'total', r->>'unclassified'), 'System');
  end if;
end $$;
