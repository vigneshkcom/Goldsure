-- Apply after reviewing the local preview. No existing quote tables are changed.
create sequence if not exists public.battery_quote_reference_seq;
create table if not exists public.battery_quote_packages (
 id text primary key, battery_name text not null, battery_manufacturer text, battery_model text,
 battery_quantity integer check(battery_quantity>0), capacity_kwh numeric not null check(capacity_kwh>0),
 inverter_brand text not null, inverter_manufacturer text, inverter_model text, inverter_kw numeric not null check(inverter_kw>0),
 phase text not null check(phase in ('Single Phase','Three Phase')), battery_chemistry text,
 depth_of_discharge numeric(5,2) check(depth_of_discharge>0 and depth_of_discharge<=100), ip_rating text,
 oop numeric(12,2) not null check(oop>=0), stcs integer not null check(stcs>=0), active boolean not null default true,
 document_ids uuid[] not null default '{}', version integer not null default 1, updated_at timestamptz not null default now()
);
alter table public.battery_quote_packages
 add column if not exists battery_manufacturer text,
 add column if not exists battery_model text,
 add column if not exists battery_quantity integer check(battery_quantity>0),
 add column if not exists inverter_manufacturer text,
 add column if not exists inverter_model text,
 add column if not exists battery_chemistry text,
 add column if not exists depth_of_discharge numeric(5,2) check(depth_of_discharge>0 and depth_of_discharge<=100),
 add column if not exists ip_rating text;
create table if not exists public.battery_quote_settings (
 id text primary key check(id='default'),tax_treatment text not null default 'unspecified' check(tax_treatment in ('unspecified','inclusive','exclusive')),
 pipeline_id text not null, pipeline_name text not null, stage_id text not null, stage_name text not null
);
create table if not exists public.battery_quote_documents (
 id uuid primary key,name text not null,kind text not null check(kind in ('battery','inverter','general')),object_path text unique not null,
 sha256 text not null,bytes integer not null check(bytes>0 and bytes<=3145728),created_at timestamptz not null default now()
);
create table if not exists public.battery_quotes (
 id uuid primary key,reference text unique not null default ('BAT-'||to_char(now() at time zone 'Australia/Sydney','YYYY')||'-'||lpad(nextval('public.battery_quote_reference_seq')::text,6,'0')),
 public_token uuid unique not null,customer jsonb not null,package_snapshot jsonb not null,customer_notes text not null default '',internal_notes text not null default '',
 created_at timestamptz not null default now(),created_by text not null,status text not null default 'draft' check(status in ('draft','sending','sent','send_failed','delivery_uncertain')),
 send_attempt uuid,sent_at timestamptz,send_count integer not null default 0,last_error text,
 ghl_status text not null default 'not_sent',ghl_contact_id text,ghl_opportunity_id text,ghl_error text,
 view_count integer not null default 0,last_viewed_at timestamptz
);
create table if not exists public.battery_quote_events (
 id uuid primary key,quote_id uuid not null references public.battery_quotes(id),event_type text not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);
create index if not exists battery_quotes_created_idx on public.battery_quotes(created_at desc);
create index if not exists battery_quote_events_quote_idx on public.battery_quote_events(quote_id,created_at desc);
alter table public.battery_quote_packages enable row level security;
alter table public.battery_quote_settings enable row level security;
alter table public.battery_quote_documents enable row level security;
alter table public.battery_quotes enable row level security;
alter table public.battery_quote_events enable row level security;
-- No public/anon policies: all staff and bearer-link access is mediated server-side.
revoke all on public.battery_quote_packages,public.battery_quote_settings,public.battery_quote_documents,public.battery_quotes,public.battery_quote_events from anon,authenticated;
grant all on public.battery_quote_packages,public.battery_quote_settings,public.battery_quote_documents,public.battery_quotes,public.battery_quote_events to service_role;
grant usage, select on public.battery_quote_reference_seq to service_role;
create or replace function public.keep_battery_quote_snapshot() returns trigger language plpgsql as $$
begin
 if new.customer is distinct from old.customer or new.package_snapshot is distinct from old.package_snapshot or new.customer_notes is distinct from old.customer_notes or new.internal_notes is distinct from old.internal_notes or new.reference is distinct from old.reference or new.public_token is distinct from old.public_token then
 raise exception 'Saved quotation details are immutable; create a new draft to revise.';
 end if;return new;
end $$;
drop trigger if exists battery_quote_snapshot_guard on public.battery_quotes;
create trigger battery_quote_snapshot_guard before update on public.battery_quotes for each row execute function public.keep_battery_quote_snapshot();
create or replace function public.record_battery_quote_view(p_quote_id uuid) returns void language sql security definer set search_path=public as $$
 update public.battery_quotes set view_count=view_count+1,last_viewed_at=now() where id=p_quote_id and sent_at is not null;
$$;
revoke all on function public.record_battery_quote_view(uuid) from public,anon,authenticated;
grant execute on function public.record_battery_quote_view(uuid) to service_role;
insert into public.battery_quote_settings(id,tax_treatment,pipeline_id,pipeline_name,stage_id,stage_name) values
 ('default','unspecified','vNOSzOo0pXEnGS38xuNw','Battery Customers','5ecf91e1-3067-4a4e-be2a-641cd0027923','New Lead') on conflict(id) do nothing;
insert into public.battery_quote_packages(id,battery_name,capacity_kwh,inverter_brand,inverter_kw,phase,oop,stcs) values
 ('BAT-001','Dyness Battery',20,'Solinteg',5,'Single Phase',6100,115),
 ('BAT-002','Dyness Battery',20,'Solinteg',8,'Single Phase',6700,115),
 ('BAT-003','Dyness Battery',30,'Solinteg',8,'Single Phase',7500,154),
 ('BAT-004','Dyness Battery',30,'Solis',10,'Three Phase',7900,154),
 ('BAT-005','Dyness Battery',40,'Solis',10,'Three Phase',9999,160) on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('battery-quote-documents','battery-quote-documents',false,3145728,array['application/pdf']) on conflict(id) do nothing;
-- Existing bucket visibility is deliberately not silently altered by rerunning this migration.
-- Alpha ESS SMILE-M10-S-INV + 2x SMILE-M-BAT-13.9P (II, 27.98 kWh). Price is set per quote by staff (package OOP 0 is a placeholder); STCs are an estimate to confirm.
insert into public.battery_quote_packages(id,battery_name,capacity_kwh,inverter_brand,inverter_kw,phase,oop,stcs) values
 ('BAT-006','Alpha ESS SMILE-M-BAT-13.9P II Battery',27.98,'Alpha ESS SMILE-M10-S-INV',10,'Single Phase',0,146) on conflict(id) do nothing;
-- FoxESS quotation options supplied by Goldsure. Package prices are entered per quote (OOP 0 placeholders).
-- For 1 May-31 December 2026, the 6.8 STC factor with statutory capacity tapering
-- and whole-number round-down gives 114 STCs at 18.64 kWh and 151 STCs at 27.84 kWh.
insert into public.battery_quote_packages(
 id,battery_name,battery_manufacturer,battery_model,battery_quantity,capacity_kwh,
 inverter_brand,inverter_manufacturer,inverter_model,inverter_kw,phase,battery_chemistry,depth_of_discharge,ip_rating,oop,stcs
) values
 ('BAT-007','FoxESS EQ4800 Battery','FoxESS','EQ4800',4,18.64,'FoxESS','FoxESS','H1-5.0-E-G2',5,'Single Phase','LiFePO4',100,'IP65',0,114),
 ('BAT-008','FoxESS EQ4800 Battery','FoxESS','EQ4800',4,18.64,'FoxESS','FoxESS','KH10',10,'Single Phase','LiFePO4',100,'IP65',0,114),
 ('BAT-009','FoxESS CQ7 Battery','FoxESS','CQ7',4,27.84,'FoxESS','FoxESS','KH10',10,'Single Phase','LiFePO4',100,'IP65',0,151),
 ('BAT-010','FoxESS CQ7 Battery','FoxESS','CQ7',4,27.84,'FoxESS','FoxESS','H3-9.9-Smart',9.9,'Three Phase','LiFePO4',100,'IP65',0,151)
on conflict(id) do nothing;
