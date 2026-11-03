-- Run after beachcomber-reports-schema.sql, before enabling the new numbering.
-- The existing WorkDrive report was renamed to Unit 1005 - 1005-1.
-- Preserve it as the first submission so the next new report becomes 1005-2.
INSERT INTO public.beachcomber_reports
  (session_id, unit, report_number, payload_hash, workdrive_folder_id, emailed_at, created_at)
VALUES
  ('db941d22-1cb6-46f6-abe8-149f96c23647', '1005', 1,
   'a32b69721b75f2bbfeb441e1ff01ce79ebe421a34dadb950bd7564758a4a8cab',
   'rkd7e32d8d3faeb7c4e5f83e95eed4b651e49',
   '2026-11-03T01:45:14Z', '2026-11-03T01:45:10.168Z')
ON CONFLICT (session_id) DO NOTHING;
