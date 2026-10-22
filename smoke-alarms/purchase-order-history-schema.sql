-- Electrician purchase order history.
-- Safe to run repeatedly in the Goldsure Supabase SQL Editor.
-- Written and read only by the portal API (service role); RLS is on with no
-- public policies so the anon key cannot see pay rates or job addresses.

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  po_number           text PRIMARY KEY,
  fieldworker_id      integer,
  electrician_name    text NOT NULL,
  company_name        text,
  period              text,
  week_ending         date,
  payable_date        text,
  jobs_count          integer NOT NULL DEFAULT 0,
  subtotal_ex_gst     numeric(12,2) NOT NULL DEFAULT 0,
  gst                 numeric(12,2) NOT NULL DEFAULT 0,
  cash_offset         numeric(12,2) NOT NULL DEFAULT 0,
  total_inc_gst       numeric(12,2) NOT NULL DEFAULT 0,
  additional_lines    jsonb NOT NULL DEFAULT '[]'::jsonb,
  exported_at         timestamptz,
  emailed_at          timestamptz,
  summary_emailed_at  timestamptz,
  xero_bill_at        timestamptz,
  xero_bill_ref       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_jobs (
  po_number        text NOT NULL REFERENCES public.purchase_orders(po_number) ON DELETE CASCADE,
  job_id           text NOT NULL,
  installed_date   date,
  address          text,
  booking          integer NOT NULL DEFAULT 0,
  hardwired        integer NOT NULL DEFAULT 0,
  battery          integer NOT NULL DEFAULT 0,
  remote           integer NOT NULL DEFAULT 0,
  subtotal_ex_gst  numeric(12,2) NOT NULL DEFAULT 0,
  gross_inc_gst    numeric(12,2) NOT NULL DEFAULT 0,
  cash_offset      numeric(12,2) NOT NULL DEFAULT 0,
  payable_inc_gst  numeric(12,2) NOT NULL DEFAULT 0,
  payment_flag     text,
  items            jsonb NOT NULL DEFAULT '[]'::jsonb,
  exported_at         timestamptz,
  emailed_at          timestamptz,
  summary_emailed_at  timestamptz,
  xero_bill_at        timestamptz,
  xero_bill_ref       text,
  PRIMARY KEY (po_number, job_id)
);

-- Sent dates live on each job so a later PO for the same week cannot rewrite
-- when an earlier job went out. (Safe on tables created before this existed.)
ALTER TABLE public.purchase_order_jobs ADD COLUMN IF NOT EXISTS exported_at timestamptz;
ALTER TABLE public.purchase_order_jobs ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
ALTER TABLE public.purchase_order_jobs ADD COLUMN IF NOT EXISTS summary_emailed_at timestamptz;
ALTER TABLE public.purchase_order_jobs ADD COLUMN IF NOT EXISTS xero_bill_at timestamptz;
ALTER TABLE public.purchase_order_jobs ADD COLUMN IF NOT EXISTS xero_bill_ref text;

CREATE INDEX IF NOT EXISTS purchase_order_jobs_installed_date_idx ON public.purchase_order_jobs (installed_date DESC);
CREATE INDEX IF NOT EXISTS purchase_order_jobs_job_id_idx ON public.purchase_order_jobs (job_id);
CREATE INDEX IF NOT EXISTS purchase_orders_week_ending_idx ON public.purchase_orders (week_ending DESC);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_jobs ENABLE ROW LEVEL SECURITY;

-- One-off copy of sent dates recorded on the PO before they moved to each job.
-- Only fills blanks, so it is safe to run repeatedly.
UPDATE public.purchase_order_jobs j
   SET exported_at        = COALESCE(j.exported_at, p.exported_at),
       emailed_at         = COALESCE(j.emailed_at, p.emailed_at),
       summary_emailed_at = COALESCE(j.summary_emailed_at, p.summary_emailed_at),
       xero_bill_at       = COALESCE(j.xero_bill_at, p.xero_bill_at),
       xero_bill_ref      = COALESCE(j.xero_bill_ref, p.xero_bill_ref)
  FROM public.purchase_orders p
 WHERE p.po_number = j.po_number;
