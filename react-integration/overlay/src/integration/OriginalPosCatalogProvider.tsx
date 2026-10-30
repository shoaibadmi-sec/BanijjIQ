import {createContext, useEffect, useState, type ReactNode} from 'react';
import {toast} from 'sonner';
import type {Product,Party} from '../types/erp';
import {getPosBootstrap} from './banijjApi';
import {mapOriginalPosCustomers} from './originalPosCustomers';
import {loadOriginalPosCatalog,attachOriginalPosUnitProfiles} from './originalPosCatalog';
import {posPaymentAccountsByMethod, type PosPaymentMethod} from '../hooks/usePosCart';
import {verifiedOriginalPosPaymentAccounts,applyOriginalPosPaymentAccounts} from './originalPosPayments';

export const OriginalPosCatalogContext = createContext<readonly Product[] | null>(null);
export const OriginalPosCustomerContext = createContext<readonly Party[] | null>(null);

/** Data provider only. Original POS preview does not post financial transactions. */
export function OriginalPosCatalogProvider({children}: {children:ReactNode}) {
  const [catalog,setCatalog] = useState<readonly Product[]>([]);
  const [customers,setCustomers] = useState<readonly Party[]>([]);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let active=true;
    const before=Object.fromEntries(Object.entries(posPaymentAccountsByMethod).map(([method,rows])=>
      [method,[...rows]])) as Record<PosPaymentMethod,string[]>;
    Promise.all([loadOriginalPosCatalog(),getPosBootstrap()]).then(([products,pos])=>{
      const verified=attachOriginalPosUnitProfiles(products,pos);
      const parties=mapOriginalPosCustomers(pos);
      const paymentAccounts=verifiedOriginalPosPaymentAccounts(pos);
      if(active){
        applyOriginalPosPaymentAccounts(posPaymentAccountsByMethod,paymentAccounts);
        setCatalog(verified);setCustomers(parties);setReady(true);
      }
    }).catch(error=>{
      if(active){
        setCatalog([]);setCustomers([]);setReady(false);
        toast.error(error instanceof Error ? error.message : 'Could not verify live POS data.');
      }
    });
    return ()=>{active=false;applyOriginalPosPaymentAccounts(posPaymentAccountsByMethod,before);};
  },[]);
  if(!ready)return null; // Mount the exact original screen only after verified data/accounts.
  return <OriginalPosCatalogContext.Provider value={catalog}><OriginalPosCustomerContext.Provider value={customers}>{children}</OriginalPosCustomerContext.Provider></OriginalPosCatalogContext.Provider>;
}
