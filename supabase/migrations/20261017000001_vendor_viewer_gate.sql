-- Vendor portal follow-up:
--   1. View-only vendor users are blocked in every vendor write function, including the ones written before the
--      portal had team permissions (Sourcing+, Assure+, Logistics+, Execution+, files, RFI, pre-assessment).
--   2. Read-only library views the portal needs for shipping (carriers, the POD checklist).
--
-- How the gate works (no old migration is edited and no function body is copied):
--   each existing function is renamed to public._core_<name> (execute revoked from everyone), and a wrapper with the
--   exact same name, parameters, defaults and return type takes its place. The wrapper calls _vendor_block_viewer()
--   and then the core function. Staff are never affected; vendors with 'standard' or 'admin' access behave exactly as before.
-- NOTE for future migrations: to change one of these functions, replace public._core_<name> (the logic), not the wrapper.

create or replace function public._vendor_block_viewer() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_supplier_id() is not null and not public.is_internal() and public.vendor_my_permission() = 'viewer' then
    raise exception 'Your account is view-only. Ask your portal admin for edit access' using errcode = '42501';
  end if;
end $$;
revoke execute on function public._vendor_block_viewer() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rename the existing functions to their core names
-- ---------------------------------------------------------------------------
alter function public.rfq_submit_quote(uuid, jsonb, int, text, boolean) rename to _core_rfq_submit_quote;
alter function public.rfq_decline(uuid, text) rename to _core_rfq_decline;
alter function public.triage_push_respond(uuid, boolean, text) rename to _core_triage_push_respond;
alter function public.po_vendor_respond(uuid, boolean, text) rename to _core_po_vendor_respond;
alter function public.assure_vendor_add_certificate(uuid, text, text, date, date, text) rename to _core_assure_vendor_add_certificate;
alter function public.assure_ncr_vendor_respond(uuid, text, text, text) rename to _core_assure_ncr_vendor_respond;
alter function public.assure_ca_set_status(uuid, text, text) rename to _core_assure_ca_set_status;
alter function public.assure_issue_vendor_respond(uuid, text, text, text, date) rename to _core_assure_issue_vendor_respond;
alter function public.assure_task_set_status(uuid, text, text) rename to _core_assure_task_set_status;
alter function public.assure_survey_submit(uuid, jsonb, boolean) rename to _core_assure_survey_submit;
alter function public.assure_review_vendor_respond(uuid, text, date, text) rename to _core_assure_review_vendor_respond;
alter function public.assure_pa_save(uuid, text, text, text, text, text, jsonb) rename to _core_assure_pa_save;
alter function public.assure_pa_submit(uuid) rename to _core_assure_pa_submit;
alter function public.submit_vendor_rfi(uuid, jsonb, jsonb) rename to _core_submit_vendor_rfi;
alter function public.file_register(text, text, text, uuid, text, text, int, text, text, text) rename to _core_file_register;
alter function public.logistics_vendor_record_shipment(uuid, text, text, text, date, int, numeric, text) rename to _core_logistics_vendor_record_shipment;
alter function public.logistics_vendor_attach_pod(uuid, uuid, date) rename to _core_logistics_vendor_attach_pod;
alter function public.execution_vendor_record_install(uuid, date, text, int, numeric, numeric, text) rename to _core_execution_vendor_record_install;
alter function public.execution_vendor_recce_save(uuid, uuid, jsonb, boolean) rename to _core_execution_vendor_recce_save;

revoke execute on function
  public._core_rfq_submit_quote(uuid, jsonb, int, text, boolean), public._core_rfq_decline(uuid, text),
  public._core_triage_push_respond(uuid, boolean, text), public._core_po_vendor_respond(uuid, boolean, text),
  public._core_assure_vendor_add_certificate(uuid, text, text, date, date, text), public._core_assure_ncr_vendor_respond(uuid, text, text, text),
  public._core_assure_ca_set_status(uuid, text, text), public._core_assure_issue_vendor_respond(uuid, text, text, text, date),
  public._core_assure_task_set_status(uuid, text, text), public._core_assure_survey_submit(uuid, jsonb, boolean),
  public._core_assure_review_vendor_respond(uuid, text, date, text), public._core_assure_pa_save(uuid, text, text, text, text, text, jsonb),
  public._core_assure_pa_submit(uuid), public._core_submit_vendor_rfi(uuid, jsonb, jsonb),
  public._core_file_register(text, text, text, uuid, text, text, int, text, text, text),
  public._core_logistics_vendor_record_shipment(uuid, text, text, text, date, int, numeric, text),
  public._core_logistics_vendor_attach_pod(uuid, uuid, date),
  public._core_execution_vendor_record_install(uuid, date, text, int, numeric, numeric, text),
  public._core_execution_vendor_recce_save(uuid, uuid, jsonb, boolean)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Wrappers (same signatures as before)
-- ---------------------------------------------------------------------------
create function public.rfq_submit_quote(p_rfq uuid, p_prices jsonb, p_lead_time_days int, p_notes text, p_submit boolean)
returns uuid language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); return public._core_rfq_submit_quote(p_rfq, p_prices, p_lead_time_days, p_notes, p_submit); end $$;

create function public.rfq_decline(p_rfq uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_rfq_decline(p_rfq, p_reason); end $$;

create function public.triage_push_respond(p_triage uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_triage_push_respond(p_triage, p_accept, p_reason); end $$;

create function public.po_vendor_respond(p_po uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_po_vendor_respond(p_po, p_accept, p_reason); end $$;

create function public.assure_vendor_add_certificate(p_cert_type uuid, p_cert_number text, p_issuer text, p_issue date, p_expiry date, p_document_path text)
returns uuid language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); return public._core_assure_vendor_add_certificate(p_cert_type, p_cert_number, p_issuer, p_issue, p_expiry, p_document_path); end $$;

create function public.assure_ncr_vendor_respond(p_id uuid, p_action text, p_response text, p_root_cause text)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_assure_ncr_vendor_respond(p_id, p_action, p_response, p_root_cause); end $$;

create function public.assure_ca_set_status(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_assure_ca_set_status(p_id, p_status, p_note); end $$;

create function public.assure_issue_vendor_respond(p_id uuid, p_action text, p_response text, p_corrective text, p_target date)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_assure_issue_vendor_respond(p_id, p_action, p_response, p_corrective, p_target); end $$;

create function public.assure_task_set_status(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_assure_task_set_status(p_id, p_status, p_note); end $$;

create function public.assure_survey_submit(p_id uuid, p_answers jsonb, p_final boolean)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_assure_survey_submit(p_id, p_answers, p_final); end $$;

create function public.assure_review_vendor_respond(p_id uuid, p_response text, p_suggested date, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_assure_review_vendor_respond(p_id, p_response, p_suggested, p_notes); end $$;

create function public.assure_pa_save(p_id uuid, p_company text, p_contact_name text, p_contact_email text, p_category text, p_country text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); return public._core_assure_pa_save(p_id, p_company, p_contact_name, p_contact_email, p_category, p_country, p_data); end $$;

create function public.assure_pa_submit(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_assure_pa_submit(p_id); end $$;

create function public.submit_vendor_rfi(p_rfi uuid, p_data jsonb, p_bank jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_submit_vendor_rfi(p_rfi, p_data, p_bank); end $$;

create function public.file_register(p_module text, p_entity_type text, p_entity_id text, p_supplier uuid,
  p_name text, p_type text, p_size int, p_base64 text, p_storage_path text, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public._vendor_block_viewer();
  return public._core_file_register(p_module, p_entity_type, p_entity_id, p_supplier, p_name, p_type, p_size, p_base64, p_storage_path, p_label);
end $$;

create function public.logistics_vendor_record_shipment(p_delivery uuid, p_carrier_code text, p_service_level text, p_tracking text,
  p_dispatch_date date, p_quantity int, p_gross_weight_kg numeric default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public._vendor_block_viewer();
  return public._core_logistics_vendor_record_shipment(p_delivery, p_carrier_code, p_service_level, p_tracking, p_dispatch_date, p_quantity, p_gross_weight_kg, p_notes);
end $$;

create function public.logistics_vendor_attach_pod(p_shipment uuid, p_file_id uuid, p_delivered_on date default null)
returns void language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); perform public._core_logistics_vendor_attach_pod(p_shipment, p_file_id, p_delivered_on); end $$;

create function public.execution_vendor_record_install(p_deployment uuid, p_installation_date date, p_installer_name text, p_quantity int,
  p_lat numeric, p_lon numeric, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._vendor_block_viewer();
  perform public._core_execution_vendor_record_install(p_deployment, p_installation_date, p_installer_name, p_quantity, p_lat, p_lon, p_notes);
end $$;

create function public.execution_vendor_recce_save(p_recce uuid, p_outlet uuid, p_data jsonb, p_confirm boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
begin perform public._vendor_block_viewer(); return public._core_execution_vendor_recce_save(p_recce, p_outlet, p_data, p_confirm); end $$;

revoke execute on function
  public.rfq_submit_quote(uuid, jsonb, int, text, boolean), public.rfq_decline(uuid, text),
  public.triage_push_respond(uuid, boolean, text), public.po_vendor_respond(uuid, boolean, text),
  public.assure_vendor_add_certificate(uuid, text, text, date, date, text), public.assure_ncr_vendor_respond(uuid, text, text, text),
  public.assure_ca_set_status(uuid, text, text), public.assure_issue_vendor_respond(uuid, text, text, text, date),
  public.assure_task_set_status(uuid, text, text), public.assure_survey_submit(uuid, jsonb, boolean),
  public.assure_review_vendor_respond(uuid, text, date, text), public.assure_pa_save(uuid, text, text, text, text, text, jsonb),
  public.assure_pa_submit(uuid), public.submit_vendor_rfi(uuid, jsonb, jsonb),
  public.file_register(text, text, text, uuid, text, text, int, text, text, text),
  public.logistics_vendor_record_shipment(uuid, text, text, text, date, int, numeric, text),
  public.logistics_vendor_attach_pod(uuid, uuid, date),
  public.execution_vendor_record_install(uuid, date, text, int, numeric, numeric, text),
  public.execution_vendor_recce_save(uuid, uuid, jsonb, boolean)
from public, anon;
grant execute on function
  public.rfq_submit_quote(uuid, jsonb, int, text, boolean), public.rfq_decline(uuid, text),
  public.triage_push_respond(uuid, boolean, text), public.po_vendor_respond(uuid, boolean, text),
  public.assure_vendor_add_certificate(uuid, text, text, date, date, text), public.assure_ncr_vendor_respond(uuid, text, text, text),
  public.assure_ca_set_status(uuid, text, text), public.assure_issue_vendor_respond(uuid, text, text, text, date),
  public.assure_task_set_status(uuid, text, text), public.assure_survey_submit(uuid, jsonb, boolean),
  public.assure_review_vendor_respond(uuid, text, date, text), public.assure_pa_save(uuid, text, text, text, text, text, jsonb),
  public.assure_pa_submit(uuid), public.submit_vendor_rfi(uuid, jsonb, jsonb),
  public.file_register(text, text, text, uuid, text, text, int, text, text, text),
  public.logistics_vendor_record_shipment(uuid, text, text, text, date, int, numeric, text),
  public.logistics_vendor_attach_pod(uuid, uuid, date),
  public.execution_vendor_record_install(uuid, date, text, int, numeric, numeric, text),
  public.execution_vendor_recce_save(uuid, uuid, jsonb, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- Libraries the vendor needs to see (read-only, active records only, signed-in vendors only)
-- ---------------------------------------------------------------------------
create view public.vendor_pod_checklist as
  select r.code, r.name, r.data->>'guidance' as guidance, coalesce((r.data->>'mandatory')::boolean, true) as mandatory
    from public.library_records r
   where r.library_key = 'pod_checklist' and r.status = 'active' and r.effective_from <= current_date
     and (r.effective_to is null or r.effective_to >= current_date) and public.my_supplier_id() is not null;
create view public.vendor_carriers as
  select r.code, r.name from public.library_records r
   where r.library_key = 'carriers' and r.status = 'active' and public.my_supplier_id() is not null;
revoke all on public.vendor_pod_checklist, public.vendor_carriers from anon;
grant select on public.vendor_pod_checklist, public.vendor_carriers to authenticated;
