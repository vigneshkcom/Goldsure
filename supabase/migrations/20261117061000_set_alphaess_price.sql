begin;

update public.battery_quote_packages
set oop = 6900,
    version = version + 1,
    updated_at = now()
where id = 'BAT-006'
  and oop is distinct from 6900;

commit;
