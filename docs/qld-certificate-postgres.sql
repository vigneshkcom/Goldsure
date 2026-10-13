-- Apply to the existing goldsure-calendar project before publishing.
-- New, isolated tables only. No existing customer/campaign tables are changed.
-- JSONB preserves exact payloads; generated columns expose fields in Table Editor.
begin;
create table if not exists public.qld_certificate_requests (
  id uuid primary key,
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at),
  request_data jsonb not null check (jsonb_typeof(request_data) = 'object'),
  job_number text generated always as (request_data->>'jobNumber') stored,
  customer_name text generated always as (request_data->>'customerName') stored,
  customer_email text generated always as (request_data->>'customerEmail') stored,
  customer_address text generated always as (request_data->>'customerAddress') stored,
  site_address text generated always as (request_data->>'siteAddress') stored,
  commissioning_party text generated always as (request_data->>'workForName') stored,
  electrician_name text generated always as (request_data->>'electricianName') stored,
  electrician_email text generated always as (request_data->>'electricianEmail') stored,
  electrician_phone text generated always as (request_data->>'electricianPhone') stored,
  certificate_type text generated always as (request_data->>'certificateType') stored,
  delivery_method text generated always as (request_data->>'deliveryMethod') stored,
  constraint certificate_request_matches_id check ((request_data->>'id') is not null and request_data->>'id' = id::text)
);
create index if not exists qld_certificate_requests_recent on public.qld_certificate_requests(created_at desc, id desc);
create index if not exists qld_certificate_requests_job on public.qld_certificate_requests(job_number);
create table if not exists public.qld_certificate_signatures (
  certificate_id uuid primary key references public.qld_certificate_requests(id) on delete restrict,
  signed_at timestamptz not null,
  test_date date not null,
  signature_data jsonb not null check (jsonb_typeof(signature_data) = 'object'),
  signer_name text generated always as (signature_data->>'signerName') stored,
  contractor_name text generated always as (signature_data->>'contractorName') stored,
  contractor_licence text generated always as (signature_data->>'contractorLicence') stored,
  contractor_phone text generated always as (signature_data->>'contractorPhone') stored,
  smoke_outcome text generated always as (signature_data->>'smokeOutcome') stored,
  request_hash text generated always as (signature_data->>'requestHash') stored,
  pdf_storage_path text generated always as ('records/' || certificate_id::text || '/certificate.pdf') stored
);
create table if not exists public.qld_certificate_events (
  certificate_id uuid not null references public.qld_certificate_requests(id) on delete restrict,
  event_type text not null check (event_type in ('viewed','invitation-claim','invitation-result','completed-email-claim','completed-email-result','pdf-integrity')),
  created_at timestamptz not null default now(),
  event_data jsonb not null check (jsonb_typeof(event_data) = 'object'),
  status text generated always as (event_data->>'status') stored,
  pdf_sha256 text generated always as (event_data->>'sha256') stored,
  primary key (certificate_id, event_type)
);
alter table public.qld_certificate_requests enable row level security;
alter table public.qld_certificate_signatures enable row level security;
alter table public.qld_certificate_events enable row level security;
revoke all on public.qld_certificate_requests, public.qld_certificate_signatures, public.qld_certificate_events from public, anon, authenticated, service_role;
grant select, insert on public.qld_certificate_requests, public.qld_certificate_signatures, public.qld_certificate_events to service_role;
-- No browser policies. Server service_role bypasses RLS but is deliberately granted
-- only INSERT/SELECT. Unique keys make signature and email claims create-only.
comment on table public.qld_certificate_requests is 'Private QLD certificate requests and prefilled customer/job details. Immutable via application role.';
comment on table public.qld_certificate_signatures is 'Private contractor-confirmed fields, drawn signature and audit evidence. One immutable signature per certificate.';
comment on table public.qld_certificate_events is 'Private first-view, email attempt/result and PDF integrity records. A claim is not proof of delivery.';
notify pgrst, 'reload schema';
commit;
