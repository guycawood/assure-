-- Innovation engagement has no data source yet. Until innovation sessions are recorded in System Guy, the scorecard
-- shows a fixed placeholder figure, clearly labelled, instead of "not yet measured". calc = 'placeholder' returns the
-- KPI's placeholder_value whenever the filtered data has any lines at all.

create or replace function public._sc_kpi_value(k jsonb, b jsonb) returns numeric language sql immutable as $$
  select case
    when b is null or k is null or not coalesce((k->>'measured')::boolean, true) then null
    when k->>'calc' = 'placeholder' then nullif(k->>'placeholder_value', '')::numeric
    when k->>'calc' = 'ratio' then case when coalesce(nullif(b->>(k->>'denominator'), '')::numeric, 0) = 0 then null
         else round(100 * coalesce(nullif(b->>(k->>'numerator'), '')::numeric, 0) / (b->>(k->>'denominator'))::numeric, 1) end
    when k->>'calc' = 'value' then case when coalesce(nullif(b->>(k->>'count_key'), '')::numeric, 0) = 0 then null
         else nullif(b->>(k->>'value_key'), '')::numeric end
    end;
$$;

do $$
begin
  perform set_config('assure.system_write', 'on', true);
  update public.library_records
     set name = 'Innovation engagement (placeholder)',
         data = data || jsonb_build_object(
           'measured', true, 'calc', 'placeholder', 'placeholder_value', 85,
           'formula', 'Placeholder figure',
           'measurement', 'Placeholder: a fixed figure until innovation sessions and proposals are recorded in System Guy.',
           'source', 'Placeholder')
   where library_key = 'scorecard_kpis' and code = 'INNOVATION_PCT' and status = 'active';
end $$;
