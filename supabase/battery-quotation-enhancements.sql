-- Additive migration. Initial production apply authorized on 21 October 2026.
-- Run docs/BATTERY_QUOTE_ENHANCEMENTS.md preflight before this additive migration.
begin;
alter table public.battery_quotes add column if not exists first_sent_at timestamptz;
alter table public.battery_quotes add column if not exists expires_at timestamptz;
alter table public.battery_quotes add column if not exists energy_snapshot jsonb;
-- Resends in the original code overwrote sent_at. Require a complete send history
-- or operator-reviewed correction before assigning historic validity.
do $$ begin
 if exists(select 1 from public.battery_quotes where sent_at is not null and send_count>1 and first_sent_at is null) and coalesce(current_setting('goldsure.battery_history_reviewed',true),'')<>'yes' then
 raise exception 'Review original send-event timestamps and explicitly set goldsure.battery_history_reviewed=yes before backfilling resend history';end if;
 if exists(select 1 from public.battery_quotes q where q.sent_at is not null and q.first_sent_at is null and q.send_count>1 and (select count(*) from public.battery_quote_events e where e.quote_id=q.id and e.event_type='sent')<q.send_count) then
  raise exception 'Review historical resend timestamps before migrating battery quote expiry';
 end if;
end $$;
update public.battery_quotes q set first_sent_at=case when send_count>1 then
 least(sent_at,(select min(coalesce(nullif(e.details->>'first_sent_at','')::timestamptz,e.created_at)) from public.battery_quote_events e where e.quote_id=q.id and e.event_type='sent')) else sent_at end
 where first_sent_at is null and sent_at is not null;
insert into public.battery_quote_events(id,quote_id,event_type,details) select gen_random_uuid(),id,'expiry_backfill',jsonb_build_object('previous_sent_at',sent_at,'first_sent_at',first_sent_at,'source',case when send_count>1 then 'reviewed send history' else 'original sent_at' end) from public.battery_quotes where first_sent_at is not null and expires_at is null;
update public.battery_quotes set sent_at=first_sent_at where first_sent_at is not null and sent_at is distinct from first_sent_at;
update public.battery_quotes set expires_at=((first_sent_at at time zone 'Australia/Sydney')+interval '21 days') at time zone 'Australia/Sydney' where first_sent_at is not null and expires_at is null;
create table if not exists public.battery_quote_acceptances(
 quote_id uuid primary key references public.battery_quotes(id),
 quote_reference text not null,signer_name text not null check(length(trim(signer_name)) between 2 and 150),
 accepted_at timestamptz not null default now(),consent_version text not null,consent_text text not null
);
alter table public.battery_quote_acceptances enable row level security;
revoke all on public.battery_quote_acceptances from public,anon,authenticated;
grant select,insert on public.battery_quote_acceptances to service_role;
create or replace function public.keep_battery_quote_snapshot() returns trigger language plpgsql as $$
begin
 if new.customer is distinct from old.customer or new.package_snapshot is distinct from old.package_snapshot or new.customer_notes is distinct from old.customer_notes or new.internal_notes is distinct from old.internal_notes or new.reference is distinct from old.reference or new.public_token is distinct from old.public_token or new.energy_snapshot is distinct from old.energy_snapshot then
  raise exception 'Saved quotation details are immutable; create a new draft to revise.';
 end if;
 if old.first_sent_at is not null and (new.first_sent_at is distinct from old.first_sent_at or new.sent_at is distinct from old.sent_at or new.expires_at is distinct from old.expires_at) then
  raise exception 'First send and validity timestamps are immutable.';
 end if;
 if new.first_sent_at is not null and (new.expires_at is null or new.expires_at<>((new.first_sent_at at time zone 'Australia/Sydney')+interval '21 days') at time zone 'Australia/Sydney') then
  raise exception 'Quote expiry must be 21 days from its first successful send.';
 end if;return new;
end $$;
create or replace function public.accept_battery_quotation(p_token uuid,p_signer_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare q public.battery_quotes; a public.battery_quote_acceptances; t timestamptz; v text:='battery-acceptance-v1';
begin
 if length(trim(p_signer_name)) not between 2 and 150 or p_signer_name~'[[:cntrl:]]' then raise exception 'INVALID_SIGNER';end if;
 select * into q from public.battery_quotes where public_token=p_token for update;
 if not found then raise exception 'QUOTE_NOT_FOUND';end if;
 select * into a from public.battery_quote_acceptances where quote_id=q.id;
 if found then return jsonb_build_object('acceptance',jsonb_build_object('signer_name',a.signer_name,'accepted_at',a.accepted_at,'consent_version',a.consent_version),'already_accepted',true);end if;
 if q.status<>'sent' or q.sent_at is null then raise exception 'QUOTE_NOT_SENT';end if;
 t:=clock_timestamp();
 if q.expires_at is null or t>=q.expires_at then raise exception 'QUOTE_EXPIRED';end if;
 insert into public.battery_quote_acceptances(quote_id,quote_reference,signer_name,accepted_at,consent_version,consent_text)
 values(q.id,q.reference,trim(p_signer_name),t,v,'I accept this quotation, including the selected battery and inverter configuration and the stated customer out-of-pocket total.') returning * into a;
 insert into public.battery_quote_events(id,quote_id,event_type,details,created_at) values(gen_random_uuid(),q.id,'accepted',jsonb_build_object('signer_name',a.signer_name,'consent_version',v,'accepted_at',t,'quote_reference',q.reference),t);
 return jsonb_build_object('acceptance',jsonb_build_object('signer_name',a.signer_name,'accepted_at',a.accepted_at,'consent_version',v),'already_accepted',false);
end $$;
revoke all on function public.accept_battery_quotation(uuid,text) from public,anon,authenticated;
grant execute on function public.accept_battery_quotation(uuid,text) to service_role;
commit;
