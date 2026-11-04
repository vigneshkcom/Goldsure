-- Battery in-home assessment (IHA) bookings. DRAFT for review: new tables only, nothing existing is changed.
-- Run in the Supabase SQL editor. Same access model as battery_quotes: server-side (service_role) only.
-- Every table is prefixed battery_iha_ so it sits beside the battery_quote_* tables.

create extension if not exists btree_gist;
create sequence if not exists public.battery_iha_job_seq start 1001 minvalue 1001;   -- job numbers J1001, J1002, ...

-- 1. Assessors (the IHA guys) -------------------------------------------------------------
create table if not exists public.battery_iha_assessors (
 id uuid primary key default gen_random_uuid(),
 full_name text not null,
 phone text,
 email text,
 colour text not null default '#c99b2e',
 access_token uuid unique not null default gen_random_uuid(),   -- private link for their mobile day view
 base_address text,                                             -- where the day starts and ends
 base_lat numeric(9,6),
 base_lng numeric(9,6),
 service_postcodes text[] not null default '{}',                -- empty = anywhere
 active boolean not null default true,
 created_at timestamptz not null default now()
);

-- 2. Settings (single row) -------------------------------------------------------------------
create table if not exists public.battery_iha_settings (
 id text primary key check (id = 'default'),
 visit_minutes integer not null default 60 check (visit_minutes > 0),
 buffer_minutes integer not null default 0 check (buffer_minutes >= 0),   -- notes/slack after each visit
 slot_step_minutes integer not null default 60 check (slot_step_minutes > 0),
 max_days_ahead integer not null default 21,
 ghl_pipeline_id text,
 ghl_booked_stage_id text,                                      -- move opportunity here when booked
 ghl_assessed_stage_id text                                     -- ...and here when assessment is completed
);
insert into public.battery_iha_settings (id, visit_minutes, buffer_minutes, slot_step_minutes) values ('default', 60, 0, 60)
 on conflict (id) do update set visit_minutes = 60, buffer_minutes = 0, slot_step_minutes = 60;   -- one-hour visits

-- 3. Weekly hours and time off ------------------------------------------------------------------
create table if not exists public.battery_iha_availability (
 id uuid primary key default gen_random_uuid(),
 assessor_id uuid not null references public.battery_iha_assessors(id) on delete cascade,
 weekday smallint not null check (weekday between 0 and 6),     -- 0 = Sunday
 start_time time not null,
 end_time time not null,
 check (end_time > start_time)
);
create index if not exists battery_iha_availability_idx on public.battery_iha_availability(assessor_id, weekday);

create table if not exists public.battery_iha_time_off (
 id uuid primary key default gen_random_uuid(),
 assessor_id uuid not null references public.battery_iha_assessors(id) on delete cascade,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 reason text,
 check (ends_at > starts_at)
);
create index if not exists battery_iha_time_off_idx on public.battery_iha_time_off(assessor_id, starts_at);

-- 4. Customers (address filled from Google Places) ------------------------------------------------
create table if not exists public.battery_iha_customers (
 id uuid primary key default gen_random_uuid(),
 full_name text not null,
 phone text not null,
 email text,
 place_id text,
 formatted_address text not null,
 unit_number text,
 street_number text,
 street_name text,
 suburb text not null,
 state text not null,
 postcode text not null check (postcode ~ '^[0-9]{4}$'),
 lat numeric(9,6),
 lng numeric(9,6),
 ghl_contact_id text,
 created_at timestamptz not null default now()
);
create index if not exists battery_iha_customers_phone_idx on public.battery_iha_customers(phone);

-- 5. Bookings -----------------------------------------------------------------------------------------
create table if not exists public.battery_iha_bookings (
 id uuid primary key default gen_random_uuid(),
 job_number integer unique not null default nextval('public.battery_iha_job_seq'),
 reference text generated always as ('J' || job_number::text) stored,   -- shown as J1001
 customer_id uuid not null references public.battery_iha_customers(id),
 assessor_id uuid not null references public.battery_iha_assessors(id),
 battery_quote_id uuid references public.battery_quotes(id),    -- the quote this visit is for (optional)
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'scheduled'
   check (status in ('scheduled','confirmed','en_route','arrived','completed','cancelled','no_show')),
 -- route planning (filled by the route planner, editable by the assessor)
 route_order integer,                                           -- stop number within the assessor's day
 travel_minutes_from_prev integer,
 travel_km_from_prev numeric(6,1),
 -- progress stamps from the mobile view
 en_route_at timestamptz,
 arrived_at timestamptz,
 completed_at timestamptz,
 access_notes text not null default '',
 internal_notes text not null default '',
 source text not null default 'staff' check (source in ('staff','web','phone','ghl')),
 ghl_opportunity_id text,
 ghl_status text not null default 'not_sent',
 ghl_error text,
 reminder_sent_at timestamptz,
 cancelled_reason text,
 created_by text not null default 'staff',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (ends_at > starts_at),
 constraint battery_iha_no_overlap exclude using gist (
   assessor_id with =,
   tstzrange(starts_at, ends_at) with &&
 ) where (status in ('scheduled','confirmed','en_route','arrived'))
);
create index if not exists battery_iha_bookings_day_idx on public.battery_iha_bookings(assessor_id, starts_at);
create index if not exists battery_iha_bookings_quote_idx on public.battery_iha_bookings(battery_quote_id);

-- 6. What the assessor records on site -----------------------------------------------------------------
create table if not exists public.battery_iha_assessments (
 booking_id uuid primary key references public.battery_iha_bookings(id) on delete cascade,
 supply_phase text check (supply_phase in ('single','three','unsure')),
 switchboard_location text,
 switchboard_has_space boolean,
 meter_type text,
 existing_solar_kw numeric(5,2),
 existing_inverter_brand text,
 existing_inverter_model text,
 install_location text check (install_location in ('garage','external_wall','internal_wall','other')),
 install_distance_to_switchboard_m numeric(5,1),
 roof_type text,
 backup_wanted boolean,
 outcome text check (outcome in ('suitable','suitable_with_work','not_suitable')),
 work_required text,
 photos jsonb not null default '[]',                            -- [{path, label, taken_at}] in storage
 notes text not null default '',
 submitted_at timestamptz,
 updated_at timestamptz not null default now()
);

-- 7. Audit trail ---------------------------------------------------------------------------------------
create table if not exists public.battery_iha_events (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.battery_iha_bookings(id) on delete cascade,
 event_type text not null,                                      -- created, rescheduled, sms_sent, en_route, arrived, completed, cancelled
 details jsonb not null default '{}',
 created_by text,
 created_at timestamptz not null default now()
);
create index if not exists battery_iha_events_idx on public.battery_iha_events(booking_id, created_at desc);

create or replace function public.touch_battery_iha() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists battery_iha_bookings_touch on public.battery_iha_bookings;
create trigger battery_iha_bookings_touch before update on public.battery_iha_bookings
 for each row execute function public.touch_battery_iha();
drop trigger if exists battery_iha_assessments_touch on public.battery_iha_assessments;
create trigger battery_iha_assessments_touch before update on public.battery_iha_assessments
 for each row execute function public.touch_battery_iha();

-- 8. Free slots for one assessor on one day (Sydney time) -------------------------------------------------
create or replace function public.battery_iha_free_slots(p_assessor uuid, p_day date)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql stable as $$
 with s as (select visit_minutes as dur, visit_minutes + buffer_minutes as span, slot_step_minutes as step from public.battery_iha_settings where id = 'default'),
 hours as (
   select (p_day + a.start_time) at time zone 'Australia/Sydney' as hs,
          (p_day + a.end_time)   at time zone 'Australia/Sydney' as he
   from public.battery_iha_availability a
   where a.assessor_id = p_assessor and a.weekday = extract(dow from p_day)
 ),
 cand as (
   select g as cs, g + make_interval(mins => s.dur) as ce, g + make_interval(mins => s.span) as ce_buf
   from hours h, s, generate_series(h.hs, h.he - make_interval(mins => s.dur), make_interval(mins => s.step)) g
 )
 select c.cs, c.ce from cand c
 where c.cs > now()
   and not exists (select 1 from public.battery_iha_bookings b
                   where b.assessor_id = p_assessor and b.status in ('scheduled','confirmed','en_route','arrived')
                     and tstzrange(b.starts_at, b.ends_at) && tstzrange(c.cs, c.ce_buf))
   and not exists (select 1 from public.battery_iha_time_off o
                   where o.assessor_id = p_assessor and tstzrange(o.starts_at, o.ends_at) && tstzrange(c.cs, c.ce))
 order by c.cs;
$$;

-- 9. Lock down: server-side only ---------------------------------------------------------------------------
alter table public.battery_iha_assessors enable row level security;
alter table public.battery_iha_settings enable row level security;
alter table public.battery_iha_availability enable row level security;
alter table public.battery_iha_time_off enable row level security;
alter table public.battery_iha_customers enable row level security;
alter table public.battery_iha_bookings enable row level security;
alter table public.battery_iha_assessments enable row level security;
alter table public.battery_iha_events enable row level security;
revoke all on public.battery_iha_assessors, public.battery_iha_settings, public.battery_iha_availability, public.battery_iha_time_off,
 public.battery_iha_customers, public.battery_iha_bookings, public.battery_iha_assessments, public.battery_iha_events from anon, authenticated;
grant all on public.battery_iha_assessors, public.battery_iha_settings, public.battery_iha_availability, public.battery_iha_time_off,
 public.battery_iha_customers, public.battery_iha_bookings, public.battery_iha_assessments, public.battery_iha_events to service_role;
grant usage, select on public.battery_iha_job_seq to service_role;
revoke all on function public.battery_iha_free_slots(uuid, date) from public, anon, authenticated;
grant execute on function public.battery_iha_free_slots(uuid, date) to service_role;

-- 10. Daily assessor emails (6:00 pm for tomorrow, 7:00 am for today) ----------------------------------------
-- One row per (date, kind, assessor) stops a retry from sending the same email twice.
create table if not exists public.battery_iha_digest_runs (
 digest_date date not null,
 kind text not null check (kind in ('evening','morning')),
 assessor_id uuid not null references public.battery_iha_assessors(id) on delete cascade,
 booking_count integer not null default 0,
 sent_at timestamptz not null default now(),
 primary key (digest_date, kind, assessor_id)
);
alter table public.battery_iha_digest_runs enable row level security;
revoke all on public.battery_iha_digest_runs from anon, authenticated;
grant all on public.battery_iha_digest_runs to service_role;

-- The assessor
insert into public.battery_iha_assessors (full_name, email)
select 'Amit', 'amit@goldsure.com.au'
where not exists (select 1 from public.battery_iha_assessors where email = 'amit@goldsure.com.au');

-- Amit works Monday to Friday, 8:00 am to 4:00 pm (one-hour slots from 8am; last visit starts 3pm)
insert into public.battery_iha_availability (assessor_id, weekday, start_time, end_time)
select a.id, d, '08:00', '16:00'
from public.battery_iha_assessors a, generate_series(1, 5) d
where a.email = 'amit@goldsure.com.au'
  and not exists (select 1 from public.battery_iha_availability v where v.assessor_id = a.id);

-- Make the API see the new tables straight away
notify pgrst, 'reload schema';
