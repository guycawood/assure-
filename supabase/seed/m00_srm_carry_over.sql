-- DUMMY DATA. The demo suppliers in demo_data.sql represent the supply base as it stood before the nine-stage onboarding
-- standard. Carry them over exactly as the migration does for real data: suppliers that were approved keep working
-- ("legacy", new controls recorded as carried over); the ones still in flight move onto the standard.
select public._onb_carry_over(array(select id from public.suppliers where supplier_code like 'DEMO-%'));
