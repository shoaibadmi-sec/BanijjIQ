import {useRef, type MutableRefObject, type Ref} from 'react';
import type {PosUnitProfile} from './banijjApi';

type Props={
 profile:PosUnitProfile;
 quantities:Record<string,number>;
 productName:string;
 onChange:(unit:string,quantity:number)=>void;
 onLastEnter:()=>void;
 primaryRef?:Ref<HTMLInputElement>;
 disabled?:boolean;
};
/**
 * One joined, single-row quantity input for two, three or four unit levels.
 * Keeps the source HisabIQ cart's 160px quantity column and 36px control height.
 * Enter moves between units, then back to the add-product combobox.
 */
export function LiveMultiUnitQuantity({profile,quantities,productName,onChange,onLastEnter,primaryRef,disabled}:Props){
 const refs=useRef<(HTMLInputElement|null)[]>([]);
 return <div data-multi-quantity className="flex h-9 w-full min-w-0 items-stretch overflow-hidden rounded-md border border-border bg-card focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
  {profile.units.map((u,i)=><div key={u.unit}
    className={'flex min-w-0 flex-1 items-stretch '+(i?'border-l border-border':'')}>
    <input type="text" inputMode="numeric" pattern="[0-9]*"
      ref={node=>{
        refs.current[i]=node;
        if(i===0&&typeof primaryRef==='function')primaryRef(node);
        else if(i===0&&primaryRef)(primaryRef as MutableRefObject<HTMLInputElement|null>).current=node;
      }}
      data-unit={u.symbol}
      aria-label={'Quantity in '+u.unit+' for '+productName}
      value={quantities[u.unit] ? String(quantities[u.unit]) : ''}
      disabled={disabled} placeholder="0"
      onChange={e=>{
        if(!/^\d*$/.test(e.target.value))return;
        const n=e.target.value?Number(e.target.value):0;
        if(Number.isSafeInteger(n)&&n<=10000000)onChange(u.unit,n);
      }}
      onKeyDown={e=>{
        if(e.key==='Enter'){e.preventDefault();if(i+1<profile.units.length){
          refs.current[i+1]?.focus();refs.current[i+1]?.select();
        }else onLastEnter();}
      }}
      className="h-full w-0 min-w-0 flex-1 bg-transparent px-0.5 text-right text-[11px] text-ink outline-none placeholder:text-ink-400" />
    <span title={u.unit+' ('+u.symbol+')'} className="flex min-w-[19px] max-w-[34px] shrink-0 items-center justify-center truncate bg-ink-50/65 px-0.5 text-[9px] font-medium text-ink-600">
      {u.symbol}
    </span>
  </div>)}
 </div>;
}