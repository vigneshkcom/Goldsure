-- Alpha ESS SMILE-M10-S-INV + 2x SMILE-M-BAT-13.9P (II, 27.98 kWh). OOP 0 is a placeholder: staff enter the final price on each quote.
insert into public.battery_quote_packages(id,battery_name,capacity_kwh,inverter_brand,inverter_kw,phase,oop,stcs) values
 ('BAT-006','Alpha ESS SMILE-M-BAT-13.9P II Battery',27.98,'Alpha ESS SMILE-M10-S-INV',10,'Single Phase',0,146) on conflict(id) do nothing;
