-- An award can only be approved when every awarded vendor is in SRM. A vendor that is not in SRM cannot be notified, cannot accept,
-- cannot be bound by a contract and cannot receive an order. Found in the demo, where an imported bid from a supplier name that is not
-- in SRM was awarded and approved.

create or replace function public.trg_rcp_award_vendors() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_names text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select string_agg(distinct a.supplier_label, ', ') into v_names
      from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id
     where i.programme_id = new.id and a.supplier_id is null;
    if v_names is not null then
      raise exception 'These awarded suppliers are not in SRM yet: %. Onboard them, or award the item to a vendor that is in SRM', v_names;
    end if;
    if exists (select 1 from public.rate_card_awards a join public.rate_card_items i on i.id = a.item_id join public.suppliers s on s.id = a.supplier_id
                where i.programme_id = new.id and (not s.active or s.purchasing_blocked)) then
      raise exception 'An awarded vendor is no longer eligible in SRM (inactive or blocked for purchasing)';
    end if;
  end if;
  return new;
end $$;
create trigger rcp_award_vendors before update of status on public.rate_card_programmes for each row execute function public.trg_rcp_award_vendors();
