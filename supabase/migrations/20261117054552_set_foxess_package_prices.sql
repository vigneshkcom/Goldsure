begin;

-- Apply the four supplied FoxESS starting prices without changing technical data or saved quote snapshots.
update public.battery_quote_packages
set oop=case id
 when 'BAT-007' then 5429
 when 'BAT-008' then 6129
 when 'BAT-009' then 7649
 when 'BAT-010' then 7669
 end,
 version=version+1,
 updated_at=now()
where id in ('BAT-007','BAT-008','BAT-009','BAT-010');

commit;
