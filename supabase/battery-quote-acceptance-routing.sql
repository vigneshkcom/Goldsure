-- Additive routing/notification migration. Apply after battery-quotation-enhancements.sql.
begin;
alter table public.battery_quote_settings add column if not exists proposal_stage_id text;
alter table public.battery_quote_settings add column if not exists proposal_stage_name text;
alter table public.battery_quote_settings add column if not exists accepted_stage_id text;
alter table public.battery_quote_settings add column if not exists accepted_stage_name text;
-- Verified read-only in Battery Customers, 21 October 2026.
update public.battery_quote_settings set proposal_stage_id='df0161df-ca17-4d67-9dd0-6e2cb2138ff0',proposal_stage_name='Proposal Sent',accepted_stage_id='9342cec0-018f-442a-baee-54a7bc942c3a',accepted_stage_name='Quote Accepted' where id='default' and pipeline_id='vNOSzOo0pXEnGS38xuNw';
alter table public.battery_quotes add column if not exists ghl_target_stage text not null default 'proposal_sent';
alter table public.battery_quotes add column if not exists ghl_synced_target text;
alter table public.battery_quotes add column if not exists ghl_sync_token uuid;
alter table public.battery_quotes add column if not exists ghl_sync_started_at timestamptz;
alter table public.battery_quotes add column if not exists acceptance_email_status text not null default 'not_sent';
alter table public.battery_quotes add column if not exists acceptance_email_attempt uuid;
alter table public.battery_quotes add column if not exists acceptance_email_error text;
-- Accepted records stay accepted if this migration is rerun.
update public.battery_quotes q set ghl_target_stage='accepted' where exists(select 1 from public.battery_quote_acceptances a where a.quote_id=q.id) and q.ghl_target_stage<>'accepted';
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
 update public.battery_quotes set ghl_target_stage='accepted' where id=q.id;
 insert into public.battery_quote_acceptances(quote_id,quote_reference,signer_name,accepted_at,consent_version,consent_text)
 values(q.id,q.reference,trim(q.customer->>'name'),t,v,'I accept this quotation, including the selected battery and inverter configuration and the stated customer out-of-pocket total.') returning * into a;
 insert into public.battery_quote_events(id,quote_id,event_type,details,created_at) values(gen_random_uuid(),q.id,'accepted',jsonb_build_object('signer_name',a.signer_name,'consent_version',v,'accepted_at',t,'quote_reference',q.reference),t);
 return jsonb_build_object('acceptance',jsonb_build_object('signer_name',a.signer_name,'accepted_at',a.accepted_at,'consent_version',v),'already_accepted',false);
end $$;
revoke all on function public.accept_battery_quotation(uuid,text) from public,anon,authenticated;
grant execute on function public.accept_battery_quotation(uuid,text) to service_role;
commit;
