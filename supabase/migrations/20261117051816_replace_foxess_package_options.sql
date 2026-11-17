begin;

-- Replace the former EP11 examples with the four FoxESS systems supplied by Goldsure.
-- Existing quotations are immutable snapshots and remain unchanged.
-- Package prices stay at zero so staff must enter the agreed customer price.
insert into public.battery_quote_packages(
 id,battery_name,battery_manufacturer,battery_model,battery_quantity,capacity_kwh,
 inverter_brand,inverter_manufacturer,inverter_model,inverter_kw,phase,
 battery_chemistry,depth_of_discharge,ip_rating,oop,stcs,active
) values
 ('BAT-007','FoxESS EQ4800 Battery','FoxESS','EQ4800',4,18.64,'FoxESS','FoxESS','H1-5.0-E-G2',5,'Single Phase','LiFePO4',100,'IP65',0,114,true),
 ('BAT-008','FoxESS EQ4800 Battery','FoxESS','EQ4800',4,18.64,'FoxESS','FoxESS','KH10',10,'Single Phase','LiFePO4',100,'IP65',0,114,true),
 ('BAT-009','FoxESS CQ7 Battery','FoxESS','CQ7',4,27.84,'FoxESS','FoxESS','KH10',10,'Single Phase','LiFePO4',100,'IP65',0,151,true),
 ('BAT-010','FoxESS CQ7 Battery','FoxESS','CQ7',4,27.84,'FoxESS','FoxESS','H3-9.9-Smart',9.9,'Three Phase','LiFePO4',100,'IP65',0,151,true)
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
