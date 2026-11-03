-- Beachcomber report references. Only the server's service role can access
-- this table or allocate numbers. WorkDrive remains the report/file store.
BEGIN;
CREATE TABLE IF NOT EXISTS public.beachcomber_reports (
  session_id uuid PRIMARY KEY,
  unit text NOT NULL CHECK (unit ~ '^[0-9]{1,4}(/[0-9]{1,4})?$'),
  report_number integer NOT NULL CHECK (report_number > 0),
  reference text GENERATED ALWAYS AS (unit || '-' || report_number::text) STORED,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  workdrive_folder_id text,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit, report_number)
);
ALTER TABLE public.beachcomber_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beachcomber_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.beachcomber_reports TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_beachcomber_report(
  p_session_id uuid, p_unit text, p_payload_hash text
) RETURNS SETOF public.beachcomber_reports
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE existing public.beachcomber_reports; next_number integer;
BEGIN
  IF p_session_id IS NULL OR p_unit IS NULL OR p_unit !~ '^[0-9]{1,4}(/[0-9]{1,4})?$'
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid report reservation';
  END IF;
  -- The session lock makes retries idempotent, including across workers.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('beachcomber-session:' || p_session_id::text, 0));
  SELECT * INTO existing FROM public.beachcomber_reports WHERE session_id = p_session_id;
  IF FOUND THEN
    IF existing.unit <> p_unit OR existing.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'This report was already submitted. Start a new report for a different incident.';
    END IF;
    RETURN NEXT existing; RETURN;
  END IF;
  -- Distinct units can allocate independently; the unit lock serializes MAX+1.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('beachcomber-unit:' || p_unit, 0));
  SELECT COALESCE(MAX(report_number), 0) + 1 INTO next_number
    FROM public.beachcomber_reports WHERE unit = p_unit;
  RETURN QUERY INSERT INTO public.beachcomber_reports (session_id, unit, report_number, payload_hash)
    VALUES (p_session_id, p_unit, next_number, p_payload_hash) RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_beachcomber_report(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_beachcomber_report(uuid,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
