-- Ideation concept visuals: the rendered illustration (sanitised SVG made by the render step) is stored on the concept.
-- Concepts are otherwise read-only to everyone, so this one function writes it, for staff only.
create or replace function public.ideation_concept_set_render(p_concept uuid, p_svg text, p_model text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Only staff can render a concept' using errcode = '42501'; end if;
  if p_svg is null or length(p_svg) > 60000 or p_svg !~* '^\s*<svg' then raise exception 'The render must be an SVG under 60 KB'; end if;
  update public.ideation_concepts
     set data = data || jsonb_build_object('render_svg', p_svg, 'render_model', coalesce(p_model, 'demo-offline'), 'rendered_at', now())
   where id = p_concept;
  if not found then raise exception 'Concept not found'; end if;
end $$;
grant execute on function public.ideation_concept_set_render(uuid, text, text) to authenticated;
