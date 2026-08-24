-- Queensland Smoke Alarm online quote view tracking.
-- Safe to run repeatedly in the Goldsure Supabase SQL Editor.

ALTER TABLE public.quote_emails
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.quote_emails
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_smoke_quote_view(p_token text)
RETURNS TABLE(view_count integer, last_viewed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.quote_emails
     SET view_count = public.quote_emails.view_count + 1,
         last_viewed_at = now()
   WHERE quote_token = p_token
   RETURNING public.quote_emails.view_count, public.quote_emails.last_viewed_at;
$$;

REVOKE ALL ON FUNCTION public.record_smoke_quote_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_smoke_quote_view(text) TO anon, authenticated, service_role;
