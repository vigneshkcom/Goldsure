-- View tracking for the Victorian Hot Water and Aircon customer quote pages.
-- Run this once in the Goldsure Supabase SQL Editor. Safe to run repeatedly.

ALTER TABLE public.hotwater_quotes
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.hotwater_quotes
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

ALTER TABLE public.aircon_quotes
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.aircon_quotes
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_hotwater_quote_view(p_token text)
RETURNS TABLE(view_count integer, last_viewed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.hotwater_quotes
     SET view_count = public.hotwater_quotes.view_count + 1,
         last_viewed_at = now()
   WHERE quote_token = p_token
   RETURNING public.hotwater_quotes.view_count, public.hotwater_quotes.last_viewed_at;
$$;

CREATE OR REPLACE FUNCTION public.record_aircon_quote_view(p_token text)
RETURNS TABLE(view_count integer, last_viewed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.aircon_quotes
     SET view_count = public.aircon_quotes.view_count + 1,
         last_viewed_at = now()
   WHERE quote_token = p_token
   RETURNING public.aircon_quotes.view_count, public.aircon_quotes.last_viewed_at;
$$;

REVOKE ALL ON FUNCTION public.record_hotwater_quote_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_hotwater_quote_view(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_aircon_quote_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_aircon_quote_view(text) TO anon, authenticated, service_role;
