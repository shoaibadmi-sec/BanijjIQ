import type { PosUnitProfile } from './banijjApi';

/** Same integer-base and paisa calculation as the Worker; invalid drafts do not post. */
export function quoteLiveUnits(profile:PosUnitProfile, quantities:Record<string,number>){
  const units=profile.units;
  if(!Array.isArray(units)||units.length<2||units.length>4)throw new Error('Unit chain is unavailable.');
  if(Object.keys(quantities).some(key=>!units.some(u=>u.unit===key)))
    throw new Error('Unrecognized unit in cart.');
  let qty=0,cents=0;const labels:string[]=[];
  for(const unit of units){
    const count=quantities[unit.unit]||0;
    if(!Number.isSafeInteger(count)||count<0||count>10000000)throw new Error('Invalid unit quantity.');
    qty+=count*unit.factor;
    cents+=count*Math.round(unit.sellingPrice*100);
    if(!Number.isSafeInteger(qty)||qty>1000000000||!Number.isSafeInteger(cents)||cents>100000000000)
      throw new Error('The quantity or amount is too large.');
    if(count>0)labels.push(count+' '+unit.symbol);
  }
  if(qty<=0)throw new Error('Enter at least one unit quantity.');
  return {qty,total:cents/100,description:labels.join(' ')};
}