-- Enforce the Performance lead and Compliance / ESG vendor roles in the database.
--   performance: NCR and issue responses, corrective actions, business review responses
--   compliance: certificates and compliance documents
-- Staff calling the same functions (assure_ca_set_status is shared) are not affected.

-- Someone who is not a vendor user gets the plain vendor-only message, not a role message.
create or replace function public._vendor_require_area(p_area text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_supplier_id() is null or public.is_internal() then raise exception 'Only a vendor user can do this' using errcode = '42501'; end if;
  if not public.vendor_can(p_area) then
    raise exception 'Your role in the company doesn''t cover this. Ask your company admin to add the % role to your account', case p_area
      when 'team' then 'company admin' when 'profile' then 'profile manager' when 'finance' then 'finance contact'
      when 'performance' then 'performance lead' else 'compliance / ESG' end using errcode = '42501';
  end if;
end $$;

alter function public.assure_vendor_add_certificate(uuid, text, text, date, date, text) rename to _vr2_pre_add_certificate;
alter function public.assure_ncr_vendor_respond(uuid, text, text, text) rename to _vr2_pre_ncr_respond;
alter function public.assure_ca_set_status(uuid, text, text) rename to _vr2_pre_ca_set_status;
alter function public.assure_issue_vendor_respond(uuid, text, text, text, date) rename to _vr2_pre_issue_respond;
alter function public.assure_review_vendor_respond(uuid, text, date, text) rename to _vr2_pre_review_respond;
revoke execute on function public._vr2_pre_add_certificate(uuid, text, text, date, date, text), public._vr2_pre_ncr_respond(uuid, text, text, text),
  public._vr2_pre_ca_set_status(uuid, text, text), public._vr2_pre_issue_respond(uuid, text, text, text, date), public._vr2_pre_review_respond(uuid, text, date, text)
  from public, anon, authenticated;

create function public.assure_vendor_add_certificate(p_cert_type uuid, p_cert_number text, p_issuer text, p_issue date, p_expiry date, p_document_path text)
returns uuid language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require_area('compliance'); return public._vr2_pre_add_certificate(p_cert_type, p_cert_number, p_issuer, p_issue, p_expiry, p_document_path); end $$;
create function public.assure_ncr_vendor_respond(p_id uuid, p_action text, p_response text, p_root_cause text)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require_area('performance'); perform public._vr2_pre_ncr_respond(p_id, p_action, p_response, p_root_cause); end $$;
create function public.assure_ca_set_status(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() then perform public._vendor_require_area('performance'); end if;
  perform public._vr2_pre_ca_set_status(p_id, p_status, p_note);
end $$;
create function public.assure_issue_vendor_respond(p_id uuid, p_action text, p_response text, p_corrective text, p_target date)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require_area('performance'); perform public._vr2_pre_issue_respond(p_id, p_action, p_response, p_corrective, p_target); end $$;
create function public.assure_review_vendor_respond(p_id uuid, p_response text, p_suggested date, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_require_area('performance'); perform public._vr2_pre_review_respond(p_id, p_response, p_suggested, p_notes); end $$;

revoke execute on function public.assure_vendor_add_certificate(uuid, text, text, date, date, text), public.assure_ncr_vendor_respond(uuid, text, text, text),
  public.assure_ca_set_status(uuid, text, text), public.assure_issue_vendor_respond(uuid, text, text, text, date), public.assure_review_vendor_respond(uuid, text, date, text)
  from public, anon;
grant execute on function public.assure_vendor_add_certificate(uuid, text, text, date, date, text), public.assure_ncr_vendor_respond(uuid, text, text, text),
  public.assure_ca_set_status(uuid, text, text), public.assure_issue_vendor_respond(uuid, text, text, text, date), public.assure_review_vendor_respond(uuid, text, date, text)
  to authenticated;

-- Compliance documents are inserted straight into the table by the portal, so the check is a trigger.
create or replace function public._vr2_documents_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() and public.my_supplier_id() is not null then perform public._vendor_require_area('compliance'); end if;
  return new;
end $$;
revoke execute on function public._vr2_documents_role() from public, anon, authenticated;
create trigger trg_vr2_documents_role before insert on public.supplier_documents for each row execute function public._vr2_documents_role();
