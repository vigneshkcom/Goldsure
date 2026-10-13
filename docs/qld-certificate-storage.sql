-- Apply once before enabling the QLD certificate workflow in production.
-- These RESTRICTIVE policies ensure existing broad permissive policies cannot
-- expose this bucket to anon/authenticated roles. Service role bypasses RLS.
-- No changes to data or access rules for any other bucket.
begin;
create policy qld_certificates_private_read on storage.objects
as restrictive for select to anon, authenticated
using (bucket_id <> 'qld-compliance-certificates');
create policy qld_certificates_private_insert on storage.objects
as restrictive for insert to anon, authenticated
with check (bucket_id <> 'qld-compliance-certificates');
create policy qld_certificates_private_update on storage.objects
as restrictive for update to anon, authenticated
using (bucket_id <> 'qld-compliance-certificates')
with check (bucket_id <> 'qld-compliance-certificates');
create policy qld_certificates_private_delete on storage.objects
as restrictive for delete to anon, authenticated
using (bucket_id <> 'qld-compliance-certificates');
commit;
