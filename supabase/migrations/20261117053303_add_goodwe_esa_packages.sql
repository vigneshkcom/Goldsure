begin;

-- Add the four GoodWe ESA supplier combinations. Existing quote snapshots are not changed.
-- Screenshot prices are stored as the editable starting OOP values.
insert into public.battery_quote_packages(
 id,battery_name,battery_manufacturer,battery_model,battery_quantity,capacity_kwh,
 inverter_brand,inverter_manufacturer,inverter_model,inverter_kw,phase,
 battery_chemistry,depth_of_discharge,ip_rating,oop,stcs,active
) values
 ('BAT-011','GoodWe ESA Battery','GoodWe','GW5.1-BAT-D-G20',3,15,'GoodWe','GoodWe','GW5K-EHA-G20',5,'Single Phase','LiFePO4',98,'IP66',5349,99,true),
 ('BAT-012','GoodWe ESA Battery','GoodWe','GW6.0-BAT-D-G20',4,23.6,'GoodWe','GoodWe','GW9.999K-EHA-G20',9.999,'Single Phase','LiFePO4',98,'IP66',6485,134,true),
 ('BAT-013','GoodWe ESA Battery','GoodWe','GW9.0-BAT-D-G20',3,26.55,'GoodWe','GoodWe','GW9.999K-EHA-G20',9.999,'Single Phase','LiFePO4',98,'IP66',8085,146,true),
 ('BAT-014','GoodWe ESA Battery','GoodWe','GW9.0-BAT-D-G20',3,26.55,'GoodWe','GoodWe','GW15K-ETA-G20',15,'Three Phase','LiFePO4',98,'IP66',8095,146,true)
on conflict(id) do update set
 battery_name=excluded.battery_name,
 battery_manufacturer=excluded.battery_manufacturer,
 battery_model=excluded.battery_model,
 battery_quantity=excluded.battery_quantity,
 capacity_kwh=excluded.capacity_kwh,
 inverter_brand=excluded.inverter_brand,
 inverter_manufacturer=excluded.inverter_manufacturer,
 inverter_model=excluded.inverter_model,
 inverter_kw=excluded.inverter_kw,
 phase=excluded.phase,
 battery_chemistry=excluded.battery_chemistry,
 depth_of_discharge=excluded.depth_of_discharge,
 ip_rating=excluded.ip_rating,
 oop=excluded.oop,
 stcs=excluded.stcs,
 active=excluded.active,
 version=public.battery_quote_packages.version+1,
 updated_at=now();

commit;
