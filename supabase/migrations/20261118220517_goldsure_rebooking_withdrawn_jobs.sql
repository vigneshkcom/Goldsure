alter table public.goldsure_rebooking_jobs add column if not exists withdrawn_at timestamptz;

CREATE OR REPLACE FUNCTION public.goldsure_rebooking_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  lim int;
  existing_count int;
  slot_count int;
  booked boolean;
  capacity_changed boolean := true;
begin
  booked := coalesce(new.customer_response = 'Customer agreed', false)
    or new.dataforce_updated is true or new.is_existing is true;

  if tg_op = 'UPDATE' then
    if old.is_existing and not (
      new.withdrawn_at is distinct from old.withdrawn_at
      and (to_jsonb(new) - array['withdrawn_at','updated_by']) = (to_jsonb(old) - array['withdrawn_at','updated_by'])
    ) then raise exception 'Existing Mason booking is protected'; end if;
    if row(new.job_id,new.app_id,new.customer_name,new.mobile,new.email,new.street_address,new.suburb,new.postcode,new.original_date,new.original_time,new.original_electrician,new.is_existing)
      is distinct from row(old.job_id,old.app_id,old.customer_name,old.mobile,old.email,old.street_address,old.suburb,old.postcode,old.original_date,old.original_time,old.original_electrician,old.is_existing)
    then raise exception 'Original booking identity cannot change'; end if;
    if old.dataforce_updated and row(new.assignment_date,new.assignment_slot,new.assigned_electrician)
      is distinct from row(old.assignment_date,old.assignment_slot,old.assigned_electrician)
    then raise exception 'Already synced to Dataforce; schedule is locked'; end if;

    capacity_changed := old.withdrawn_at is not null or not (coalesce(old.customer_response = 'Customer agreed', false)
        or old.dataforce_updated is true or old.is_existing is true)
      or row(new.assignment_date,new.assignment_slot,new.assigned_electrician)
        is distinct from row(old.assignment_date,old.assignment_slot,old.assigned_electrician);
    new.version := old.version + 1;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  if new.assignment_date is null then
    if new.assigned_electrician is not null then raise exception 'Unallocated job cannot have electrician'; end if;
  elsif new.assignment_date = date '2026-11-26' and new.assigned_electrician = 'Alex Symonds' then
    lim := 10;
  elsif new.assignment_date in (date '2026-12-14',date '2026-12-15',date '2026-12-16') and new.assigned_electrician = 'Mason Adams' then
    lim := 8;
  else
    raise exception 'Date and electrician outside approved plan';
  end if;

  if new.withdrawn_at is null and new.assignment_date is not null and booked and capacity_changed then
    perform pg_advisory_xact_lock(hashtextextended(new.assigned_electrician || new.assignment_date::text, 0));
    select count(*), count(*) filter (where j.assignment_slot = new.assignment_slot)
      into existing_count, slot_count
      from public.goldsure_rebooking_jobs j
      where j.assignment_date = new.assignment_date
        and j.assigned_electrician = new.assigned_electrician
        and j.withdrawn_at is null
        and j.job_id is distinct from new.job_id
        and (j.customer_response = 'Customer agreed' or j.dataforce_updated is true or j.is_existing is true);
    if existing_count >= lim then raise exception 'Daily capacity exceeded'; end if;
    if slot_count >= 5 then raise exception 'AM or PM capacity exceeded'; end if;
  end if;
  return new;
end
$function$;
