// Shared by the browser and server. Rates are quote assumptions, not a guaranteed market price.
export const STC_RATE=39.50;
export function batteryPricing(pkg){
 if(pkg.pricing_version===1)return {gross:Number(pkg.gross_amount),deduction:Number(pkg.stc_deduction),rate:Number(pkg.stc_rate),oop:Number(pkg.oop)};
 const rate=Number(pkg.stc_rate??STC_RATE),oopCents=Math.round(Number(pkg.oop)*100),discountCents=Number(pkg.stcs)*Math.round(rate*100);
 return {gross:(oopCents+discountCents)/100,deduction:discountCents/100,rate,oop:oopCents/100};
}
export function snapshotBatteryPricing(pkg){const p=batteryPricing(pkg);return {pricing_version:1,stc_rate:p.rate,gross_amount:p.gross,stc_deduction:p.deduction};}
