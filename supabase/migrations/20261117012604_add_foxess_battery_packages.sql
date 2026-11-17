alter table public.battery_quote_packages
 add column if not exists battery_manufacturer text,
 add column if not exists battery_model text,
 add column if not exists battery_quantity integer check(battery_quantity>0),
 add column if not exists inverter_manufacturer text,
 add column if not exists inverter_model text,
 add column if not exists battery_chemistry text,
 add column if not exists depth_of_discharge numeric(5,2) check(depth_of_discharge>0 and depth_of_discharge<=100),
 add column if not exists ip_rating text;

-- EP11 has 10.36 kWh usable capacity per unit. For systems certified from
-- 1 May to 31 December 2026, the statutory 6.8 factor and capacity taper give:
-- BAT-007: floor(14*6.8 + 6.72*6.8*0.6) = 122 STCs
-- BAT-008: floor(14*6.8 + 14*6.8*0.6 + 3.08*6.8*0.15) = 155 STCs
insert into public.battery_quote_packages(
 id,battery_name,battery_manufacturer,battery_model,battery_quantity,capacity_kwh,
 inverter_brand,inverter_manufacturer,inverter_model,inverter_kw,phase,battery_chemistry,depth_of_discharge,ip_rating,oop,stcs,active
) values
 ('BAT-007','FoxESS EP11 Battery','FoxESS','EP11',2,20.72,'FoxESS','FoxESS','KH10',10,'Single Phase','LiFePO4',100,'IP65',0,122,true),
 ('BAT-008','FoxESS EP11 Battery','FoxESS','EP11',3,31.08,'FoxESS','FoxESS','KH10',10,'Single Phase','LiFePO4',100,'IP65',0,155,true)
on conflict(id) do nothing;
