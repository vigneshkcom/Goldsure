-- Wipes the Aircon Job Tracker back to nothing so it can be seeded fresh.
-- Run in the Supabase SQL editor for project yxgdixwneprhjxzdlaqw.
--
-- Only touches aircon_jobs. That is the only table this feature created —
-- everything else in your table list (aircon_quotes, quote_emails,
-- sms_messages, staff_assessment_*, etc.) is untouched by this statement.
--
-- CASCADE takes the table's index and its four RLS policies with it (they
-- can't exist without the table anyway); it does not reach any other table.
--
-- After running this, re-run aircons/aircon-jobs-schema.sql to recreate the
-- table, then optionally aircons/aircon-jobs-seed.sql to reload the 34
-- transcribed rows — or skip the seed and add jobs fresh from the tracker.

drop table if exists aircon_jobs cascade;
