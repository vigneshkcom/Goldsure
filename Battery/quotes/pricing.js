// Marketing labels only. Technical configuration and pricing remain in the package record and quote snapshot.
const foxNames={
 'BAT-007':'FoxESS 20kWh Battery',
 'BAT-008':'FoxESS 30kWh Battery'
};
export const hasSpecificationDocuments=p=>['BAT-006','BAT-007','BAT-008'].includes(p?.id);
export const batteryPackageName=p=>p?.id==='BAT-006'?'Alpha ESS 28kWh Battery':foxNames[p?.id]||`${p.capacity_kwh}kWh ${p.battery_name}`;
export const batteryPackageSubtitle=p=>p?.id==='BAT-006'?'10kW Alpha ESS · Single Phase':foxNames[p?.id]?`10kW FoxESS · ${p.phase}`:`${p.inverter_kw}kW ${p.inverter_brand} · ${p.phase}`;
export const batteryDocumentLabel=d=>{const brand=/^FoxESS\b/i.test(d?.name)?'FoxESS':'AlphaESS';return ({battery:`${brand} Battery Datasheet`,inverter:`${brand} Inverter Datasheet`}[d.kind]||`${brand} Warranty Terms`);};

// Shared by the browser and server. Rates are quote assumptions, not a guaranteed market price.
export const STC_RATE=39.50;
export const BRIGHTE_GREEN_LOAN=Object.freeze({provider:'Brighte',product:'Brighte Green Loan',annual_rate_percent:9.99,comparison_rate_percent:11.70,term_months:60,repayment_frequency:'fortnightly',account_fee_weekly:2.99,establishment_fee_from:199,terms_current_as_at:'2026-10-01'});
export function brighteFinance(amount){
 const principal=Math.round(Number(amount)*100)/100;
 if(!Number.isFinite(principal)||principal<=0)return null;
 const amountFinanced=Math.round((principal+BRIGHTE_GREEN_LOAN.establishment_fee_from)*100)/100,periods=BRIGHTE_GREEN_LOAN.term_months/12*26,rate=BRIGHTE_GREEN_LOAN.annual_rate_percent/100/26;
 const loanRepayment=amountFinanced*rate/(1-Math.pow(1+rate,-periods));
 const fortnightly=Math.round((loanRepayment+BRIGHTE_GREEN_LOAN.account_fee_weekly*2)*100)/100;
 const monthlyBeforeFees=Math.round((principal*(BRIGHTE_GREEN_LOAN.annual_rate_percent/100/12)/(1-Math.pow(1+BRIGHTE_GREEN_LOAN.annual_rate_percent/100/12,-BRIGHTE_GREEN_LOAN.term_months)))*100)/100;
 const total=Math.round(fortnightly*periods*100)/100;
 return {...BRIGHTE_GREEN_LOAN,principal,amount_financed:amountFinanced,establishment_fee_assumed:BRIGHTE_GREEN_LOAN.establishment_fee_from,repayment_count:periods,estimated_fortnightly_repayment:fortnightly,estimated_total_repayments:total,estimated_finance_cost:Math.round((total-principal)*100)/100,estimated_monthly_before_fees:monthlyBeforeFees,estimate_only:true};
}
export function batteryPricing(pkg){
 if(pkg.pricing_version===1)return {gross:Number(pkg.gross_amount),deduction:Number(pkg.stc_deduction),rate:Number(pkg.stc_rate),oop:Number(pkg.oop),discount:Number(pkg.discount_amount||0),discountLabel:pkg.discount_label||'Goldsure discount'};
 const rate=Number(pkg.stc_rate??STC_RATE),oopCents=Math.round(Number(pkg.oop)*100),discountCents=Number(pkg.stcs)*Math.round(rate*100);
 return {gross:(oopCents+discountCents)/100,deduction:discountCents/100,rate,oop:oopCents/100,discount:0,discountLabel:''};
}
export function snapshotBatteryPricing(pkg){const p=batteryPricing(pkg);return {pricing_version:1,stc_rate:p.rate,gross_amount:p.gross,stc_deduction:p.deduction};}
// Staff may set the final price payable (the STC deduction stays fixed), or edit the system price and add an extra discount. Returns the adjustments to merge into a quote snapshot.
export function priceAdjustment(snapshot,input={}){
 const blank=v=>v===undefined||v===null||String(v).trim()==='';
 const toCents=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*100):NaN;};
 const baseGross=Math.round(Number(snapshot.gross_amount)*100),deduction=Math.round(Number(snapshot.stc_deduction)*100);
 if(!blank(input.oop)){const oop=toCents(input.oop);if(!Number.isInteger(oop)||oop<0||oop>100000000)return {error:'Enter a valid final price.'};if(oop===baseGross-deduction)return {};return {base_gross_amount:baseGross/100,gross_amount:(oop+deduction)/100,oop:oop/100,discount_amount:0,discount_label:''};}
 const gross=blank(input.gross)?baseGross:toCents(input.gross),discount=blank(input.discount)?0:toCents(input.discount);
 if(!Number.isInteger(gross)||!Number.isInteger(discount)||gross<0||discount<0||gross>100000000)return {error:'Enter valid amounts for the system price and discount.'};
 if(gross===baseGross&&discount===0)return {};
 if(gross-deduction-discount<0)return {error:'The price and discount cannot make the amount payable negative.'};
 return {base_gross_amount:baseGross/100,gross_amount:gross/100,oop:(gross-deduction-discount)/100,discount_amount:discount/100,discount_label:discount?(String(input.discount_label||'').trim().slice(0,60)||'Goldsure discount'):''};
}
