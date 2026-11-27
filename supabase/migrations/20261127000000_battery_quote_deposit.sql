-- Deposit received against a saved battery quote. Stored outside package_snapshot, which is immutable by design.
alter table public.battery_quotes
  add column if not exists deposit_amount numeric(12,2) check (deposit_amount is null or deposit_amount >= 0),
  add column if not exists deposit_received_on date,
  add column if not exists deposit_method text check (deposit_method is null or deposit_method in ('Bank transfer','Credit or debit card','Cash','Cheque'));
