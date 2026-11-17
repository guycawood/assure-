-- Client sustainability targets (CRM) for two demo clients. Dummy data only. Briefs for these clients pre-fill from
-- these targets and ideation applies them (stricter of client and brief wins; excluded materials never suggested).
insert into public.crm_client_sustainability (client_id, statement, min_recycled_pct, require_fsc, excluded_materials, recyclable_required,
  reuse_expected, impact_grade_floor, reporting_obligations, updated_at) values
  ('c5000000-0000-4000-8000-000000000002', 'No single-use plastics in store; permanent displays reused for at least two seasons.', 50, true,
   array['PVC', 'Acrylic'], true, true, 60, 'Quarterly CO2e by campaign for the client''s Scope 3 report.', now()),
  ('c5000000-0000-4000-8000-000000000001', 'Paper and board first; anything plastic must be mono-material and recyclable.', 30, false,
   array['PVC'], true, false, 50, null, now())
on conflict (client_id) do nothing;
