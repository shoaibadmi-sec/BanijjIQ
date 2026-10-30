import type { UnitProfile } from '../products/unitProfile.js';
export type PurchaseUnitQuote={baseQuantity:number;baseUnitCost:number;lineTotal:number;
  unitProfileRevision:number;unitQuantities:Record<string,number>;priceUnit:string;
  enteredUnitPrice:number;description:string};
/** One entered cost-unit across all mixed quantity entries. Inventory remains in the
 * smallest stock unit; invoice total rounds ONCE to 4 decimals; the denominator
 * and original cost are retained to allocate future returns without drift.
 */
export function quotePurchaseUnits(profile:UnitProfile,revision:number,quantities:Record<string,number>,
 priceUnit:string,enteredUnitPrice:number):PurchaseUnitQuote{
 if(!Number.isSafeInteger(revision)||revision<1)throw Error('Missing purchase unit revision.');
 const units=profile?.units;
 if(!Array.isArray(units)||units.length<2||units.length>4)throw Error('Invalid unit chain.');
 if(!quantities||typeof quantities!=='object'||Array.isArray(quantities))throw Error('Invalid unit quantities.');
 const priced=units.find(u=>u.unit===priceUnit);
 if(!priced||!Number.isSafeInteger(priced.factor)||priced.factor<1||priced.factor>1000000000)
   throw Error('Choose a valid purchase cost unit.');
 if(typeof enteredUnitPrice!=='number'||!Number.isFinite(enteredUnitPrice)||
   enteredUnitPrice<0||enteredUnitPrice>100000000||
   Math.abs(enteredUnitPrice*10000-Math.round(enteredUnitPrice*10000))>0.000001)
   throw Error('Purchase cost accepts up to four decimals.');
 if(Object.keys(quantities).some(k=>!units.some(u=>u.unit===k)))throw Error('Unknown purchase unit.');
 const map:Record<string,number>={};const labels:string[]=[];
 let base=0n;
 for(const u of units){
   if(!Number.isSafeInteger(u.factor)||u.factor<1||u.factor>1000000000)throw Error('Invalid conversion factor.');
   const n=quantities[u.unit]??0;
   if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>10000000)
     throw Error('Purchase units require whole nonnegative counts.');
   base+=BigInt(n)*BigInt(u.factor);map[u.unit]=n;
   if(n>0)labels.push(n+' '+u.symbol);
 }
 if(base<1n||base>1000000000n)throw Error('Invalid or excessive base quantity.');
 const micro=BigInt(Math.round(enteredUnitPrice*10000));
 const factor=BigInt(priced.factor);
 const total=(base*micro+factor/2n)/factor;
 if(total>100000000000000n)throw Error('Purchase amount exceeds limit.');
 return {baseQuantity:Number(base),baseUnitCost:Number(micro)/Number(factor)/10000,
  lineTotal:Number(total)/10000,unitProfileRevision:revision,unitQuantities:map,
  priceUnit,enteredUnitPrice,description:labels.join(' ')};
}
