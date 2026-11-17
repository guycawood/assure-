-- Sustainability is one section with Impact Grade (the PEF model) and conscious ordering inside it. Impact Grade keeps
-- its own module key as an area of the section (like RFQs inside Sourcing), so its libraries and health keep working.
-- The wheel themes library belongs to Impact Grade. Earlier migrations moved it back and forth depending on the order
-- they ran in, so this fixes it for every database, new or old.
update public.library_definitions set module = 'impact-grade' where key = 'impact_grade_dimensions';
