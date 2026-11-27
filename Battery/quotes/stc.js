// Battery STC entitlement under the Cheaper Home Batteries Program (Small-scale Renewable Energy Scheme).
// Sources (checked 27 Nov 2026): Clean Energy Regulator STC entitlement guidance and the Renewable Energy
// (Electricity) Regulations 2001, reg 20(7)-(8) and reg 59.
//   W    = first 14 kWh x 100% + next 14 kWh x 60% + next 22 kWh x 15%   (usable kWh, CEC approved list)
//   STCs = floor(factor x W), rounded down once on the total
// The factor is set by the period in which the battery is certified for compliance (the certificate of
// electrical compliance date), not by the quote date, delivery date or app activation.
export const BATTERY_STC_FACTORS=Object.freeze([
 {from:'2025-07-01',to:'2025-12-31',factor:9.3},{from:'2026-01-01',to:'2026-04-30',factor:8.4},
 {from:'2026-05-01',to:'2026-12-31',factor:6.8},{from:'2027-01-01',to:'2027-06-30',factor:5.7},
 {from:'2027-07-01',to:'2027-12-31',factor:5.2},{from:'2028-01-01',to:'2028-06-30',factor:4.6},
 {from:'2028-07-01',to:'2028-12-31',factor:4.1},{from:'2029-01-01',to:'2029-06-30',factor:3.6},
 {from:'2029-07-01',to:'2029-12-31',factor:3.1},{from:'2030-01-01',to:'2030-06-30',factor:2.6},
 {from:'2030-07-01',to:'2030-12-31',factor:2.1}
]);
export function batteryStcFactor(isoDate){const row=BATTERY_STC_FACTORS.find(r=>isoDate>=r.from&&isoDate<=r.to);return row?row.factor:null;}
// The taper (60% / 15% tiers) applies from 1 May 2026 only; earlier periods are not modelled here.
export function batteryStcs(usableKwh,isoDate){
 const u=Number(usableKwh),factor=batteryStcFactor(isoDate);
 if(!Number.isFinite(u)||u<=0||factor===null||isoDate<'2026-05-01')return null;
 const w=Math.min(u,14)+0.6*Math.min(Math.max(u-14,0),14)+0.15*Math.min(Math.max(u-28,0),22);
 return Math.floor(Math.round(factor*w*1e6)/1e6);
}
