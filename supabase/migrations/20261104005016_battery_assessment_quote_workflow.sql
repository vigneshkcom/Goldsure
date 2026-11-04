-- Preserve every alternative proposal; the old booking pointer remains the latest quote.
alter table public.battery_quotes add column if not exists assessment_booking_id uuid;
-- The reverse foreign key is added after the API deploy to avoid ambiguous joins in the old API.
alter table public.battery_quotes add column if not exists assessment_snapshot jsonb;
create index if not exists battery_quotes_assessment_idx on public.battery_quotes(assessment_booking_id);
update public.battery_quotes q set assessment_booking_id=b.id
 from public.battery_iha_bookings b where b.battery_quote_id=q.id and q.assessment_booking_id is null;

-- Retry-safe creation and linkage in one transaction. A new request UUID deliberately creates an alternative.
create or replace function public.create_battery_assessment_quote(p_quote jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare b public.battery_iha_bookings; q public.battery_quotes;
begin
 select * into b from public.battery_iha_bookings where id=(p_quote->>'assessment_booking_id')::uuid for update;
 if not found then raise exception 'Assessment booking not found'; end if;
 select * into q from public.battery_quotes where id=(p_quote->>'id')::uuid;
 if found then
   if q.assessment_booking_id is distinct from b.id then raise exception 'Quote request belongs to another booking'; end if;
   return jsonb_build_object('quote',to_jsonb(q),'reused',true);
 end if;
 if b.status in ('cancelled','no_show') then raise exception 'This visit is cancelled or no-show'; end if;
 insert into public.battery_quotes(id,public_token,customer,package_snapshot,customer_notes,internal_notes,
  created_by,status,assessment_booking_id,assessment_snapshot,energy_snapshot,ghl_contact_id)
 values ((p_quote->>'id')::uuid,(p_quote->>'public_token')::uuid,p_quote->'customer',p_quote->'package_snapshot',
  coalesce(p_quote->>'customer_notes',''),coalesce(p_quote->>'internal_notes',''),p_quote->>'created_by','draft',b.id,
  p_quote->'assessment_snapshot',coalesce(p_quote->'energy_snapshot','{}'::jsonb),p_quote->>'ghl_contact_id') returning * into q;
 update public.battery_iha_bookings set battery_quote_id=q.id where id=b.id;
 insert into public.battery_quote_events(id,quote_id,event_type,details) values(gen_random_uuid(),q.id,'created',jsonb_build_object('booking',b.reference));
 insert into public.battery_iha_events(booking_id,event_type,details,created_by)
 values(b.id,'quote_linked',jsonb_build_object('quote_id',q.id,'reference',q.reference),p_quote->>'created_by');
 return jsonb_build_object('quote',to_jsonb(q),'reused',false);
end $$;
revoke all on function public.create_battery_assessment_quote(jsonb) from public,anon,authenticated;
grant execute on function public.create_battery_assessment_quote(jsonb) to service_role;

-- Saving the final assessment and finishing the visit either both succeed or neither does.
create or replace function public.save_battery_assessment(p_row jsonb,p_complete boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare a public.battery_iha_assessments; b public.battery_iha_bookings;
begin
 select * into b from public.battery_iha_bookings where id=(p_row->>'booking_id')::uuid for update;
 if not found then raise exception 'Assessment booking not found'; end if;
 if b.status in ('cancelled','no_show') then raise exception 'Reopen the visit before editing its assessment'; end if;
 if p_complete and ((p_row->>'supply_phase') is null or (p_row->>'outcome') is null
  or ((p_row->>'outcome') in ('suitable_with_work','not_suitable') and length(trim(coalesce(p_row->>'notes','')))<3))
 then raise exception 'Complete the supply, outcome and required notes first'; end if;
 insert into public.battery_iha_assessments(booking_id,supply_phase,switchboard_has_space,existing_solar_kw,
  existing_inverter_brand,install_location,install_distance_to_switchboard_m,outcome,notes,submitted_at)
 values(b.id,p_row->>'supply_phase',(p_row->>'switchboard_has_space')::boolean,(p_row->>'existing_solar_kw')::numeric,
  p_row->>'existing_inverter_brand',p_row->>'install_location',(p_row->>'install_distance_to_switchboard_m')::numeric,
  p_row->>'outcome',coalesce(p_row->>'notes',''),case when p_complete then now() else null end)
 on conflict(booking_id) do update set supply_phase=excluded.supply_phase,switchboard_has_space=excluded.switchboard_has_space,
  existing_solar_kw=excluded.existing_solar_kw,existing_inverter_brand=excluded.existing_inverter_brand,
  install_location=excluded.install_location,install_distance_to_switchboard_m=excluded.install_distance_to_switchboard_m,
  outcome=excluded.outcome,notes=excluded.notes,submitted_at=case when p_complete then now() else battery_iha_assessments.submitted_at end
 returning * into a;
 if p_complete then update public.battery_iha_bookings set status='completed',completed_at=coalesce(completed_at,now()) where id=b.id; end if;
 return to_jsonb(a);
end $$;
revoke all on function public.save_battery_assessment(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_battery_assessment(jsonb,boolean) to service_role;
notify pgrst,'reload schema';
