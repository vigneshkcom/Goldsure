begin;

update public.battery_quote_packages
set active = true,
    version = version + 1,
    updated_at = now()
where id = 'BAT-006'
  and active is distinct from true;

commit;
