-- In-home assessor bookings. DRAFT for review: nothing here touches existing tables.
-- Run in the Supabase SQL editor. Access is server-side only (service_role), same as the battery quote tables.

create extension if not exists btree_gist;
create sequence if not exists public.assessor_booking_ref_seq;

-- 1. Assessors -------------------------------------------------------------
create table if not exists public.assessors (
 id uuid primary key default gen_random_uuid(),
 full_name text not null,
 phone text,
 email text,
 colour text not null default '#b8860b',            -- diary colour
 base_address text,                                 -- where the day starts (for travel estimates)
 base_lat numeric(9,6),
 base_lng numeric(9,6),
 service_postcodes text[] not null default '{}',    -- empty = anywhere
 active boolean not null default true,
 created_at timestamptz not null default now()
);

-- 2. Weekly working hours (one row per block, several blocks per day allowed) ----
create table if not exists public.assessor_availability (
 id uuid primary key default gen_random_uuid(),
 assessor_id uuid not null references public.assessors(id) on delete cascade,
 weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
 start_time time not null,
 end_time time not null,
 check (end_time > start_time)
);
create index if not exists assessor_availability_idx on public.assessor_availability(assessor_id, weekday);

-- 3. Leave, sick days, blocked time ----------------------------------------------
create table if not exists public.assessor_time_off (
 id uuid primary key default gen_random_uuid(),
 assessor_id uuid not null references public.assessors(id) on delete cascade,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 reason text,
 check (ends_at > starts_at)
);
create index if not exists assessor_time_off_idx on public.assessor_time_off(assessor_id, starts_at);

-- 4. What is being assessed, and how long it takes --------------------------------
create table if not exists public.assessment_types (
 id text primary key,                                -- e.g. 'smoke-alarm'
 label text not null,
 duration_minutes integer not null check (duration_minutes > 0),
 buffer_minutes integer not null default 30 check (buffer_minutes >= 0),  -- travel/notes after the visit
 active boolean not null default true
);
insert into public.assessment_types (id, label, duration_minutes) values
 ('smoke-alarm', 'Smoke alarm assessment', 45),
 ('hot-water',   'Hot water assessment',   60),
 ('battery',     'Battery assessment',     75),
 ('aircon',      'Air conditioning assessment', 60)
on conflict (id) do nothing;

-- 5. Customers (address comes from Google Places autocomplete) -----------------------
create table if not exists public.assessor_customers (
 id uuid primary key default gen_random_uuid(),
 full_name text not null,
 phone text not null,
 email text,
 -- Google Places "Place Details" fields
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
 ghl_contact_id text,                                -- link to GoHighLevel contact, if synced
 created_at timestamptz not null default now()
);
create index if not exists assessor_customers_phone_idx on public.assessor_customers(phone);
create index if not exists assessor_customers_place_idx on public.assessor_customers(place_id);

-- 6. Bookings ---------------------------------------------------------------------------
create table if not exists public.assessor_bookings (
 id uuid primary key default gen_random_uuid(),
 reference text unique not null default ('AS-' || to_char(now() at time zone 'Australia/Sydney','YYYY') || '-' || lpad(nextval('public.assessor_booking_ref_seq')::text, 5, '0')),
 customer_id uuid not null references public.assessor_customers(id),
 assessor_id uuid not null references public.assessors(id),
 type_id text not null references public.assessment_types(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'scheduled'
   check (status in ('scheduled','confirmed','en_route','completed','cancelled','no_show')),
 access_notes text not null default '',              -- gate code, dogs, parking
 internal_notes text not null default '',
 source text not null default 'staff' check (source in ('staff','web','phone','ghl')),
 reminder_sent_at timestamptz,
 cancelled_reason text,
 created_by text not null default 'staff',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (ends_at > starts_at),
 -- an assessor cannot be double booked
 constraint assessor_no_overlap exclude using gist (
   assessor_id with =,
   tstzrange(starts_at, ends_at) with &&
 ) where (status in ('scheduled','confirmed','en_route'))
);
create index if not exists assessor_bookings_day_idx on public.assessor_bookings(assessor_id, starts_at);
create index if not exists assessor_bookings_customer_idx on public.assessor_bookings(customer_id);

create or replace function public.touch_assessor_booking() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists assessor_bookings_touch on public.assessor_bookings;
create trigger assessor_bookings_touch before update on public.assessor_bookings
 for each row execute function public.touch_assessor_booking();

-- 7. Audit trail -----------------------------------------------------------------------------
create table if not exists public.assessor_booking_events (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.assessor_bookings(id) on delete cascade,
 event_type text not null,                           -- created, rescheduled, confirmed, sms_sent, cancelled ...
 details jsonb not null default '{}',
 created_by text,
 created_at timestamptz not null default now()
);
create index if not exists assessor_booking_events_idx on public.assessor_booking_events(booking_id, created_at desc);

-- 8. Free slots for one assessor on one day (Sydney time) -------------------------------------
create or replace function public.assessor_free_slots(p_assessor uuid, p_day date, p_type text, p_step_minutes integer default 30)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql stable as $$
 with t as (select duration_minutes + buffer_minutes as span, duration_minutes as dur from public.assessment_types where id = p_type),
 hours as (
   select (p_day + a.start_time) at time zone 'Australia/Sydney' as s,
          (p_day + a.end_time)   at time zone 'Australia/Sydney' as e
   from public.assessor_availability a
   where a.assessor_id = p_assessor and a.weekday = extract(dow from p_day)
 ),
 cand as (
   select g as s, g + make_interval(mins => t.dur) as e, g + make_interval(mins => t.span) as e_buf
   from hours h, t, generate_series(h.s, h.e - make_interval(mins => t.dur), make_interval(mins => p_step_minutes)) g
 )
 select c.s, c.e from cand c
 where not exists (select 1 from public.assessor_bookings b
                   where b.assessor_id = p_assessor and b.status in ('scheduled','confirmed','en_route')
                     and tstzrange(b.starts_at, b.ends_at) && tstzrange(c.s, c.e_buf))
   and not exists (select 1 from public.assessor_time_off o
                   where o.assessor_id = p_assessor and tstzrange(o.starts_at, o.ends_at) && tstzrange(c.s, c.e))
   and c.s > now()
 order by c.s;
$$;

-- 9. Lock it down: server-side access only ------------------------------------------------------
alter table public.assessors enable row level security;
alter table public.assessor_availability enable row level security;
alter table public.assessor_time_off enable row level security;
alter table public.assessment_types enable row level security;
alter table public.assessor_customers enable row level security;
alter table public.assessor_bookings enable row level security;
alter table public.assessor_booking_events enable row level security;
revoke all on public.assessors, public.assessor_availability, public.assessor_time_off, public.assessment_types,
 public.assessor_customers, public.assessor_bookings, public.assessor_booking_events from anon, authenticated;
grant all on public.assessors, public.assessor_availability, public.assessor_time_off, public.assessment_types,
 public.assessor_customers, public.assessor_bookings, public.assessor_booking_events to service_role;
grant usage, select on public.assessor_booking_ref_seq to service_role;
revoke all on function public.assessor_free_slots(uuid, date, text, integer) from public, anon, authenticated;
grant execute on function public.assessor_free_slots(uuid, date, text, integer) to service_role;
