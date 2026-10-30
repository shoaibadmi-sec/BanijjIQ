import {createContext, useEffect, useState, type ReactNode} from 'react';
import {toast} from 'sonner';
import type {Product,Party} from '../types/erp';
import {loadOriginalPosCustomers} from './originalPosCustomers';
import {loadOriginalPosCatalog} from './originalPosCatalog';

export const OriginalPosCatalogContext = createContext<readonly Product[] | null>(null);
export const OriginalPosCustomerContext = createContext<readonly Party[] | null>(null);

/** Data provider only. Original POS preview does not post financial transactions. */
export function OriginalPosCatalogProvider({children}: {children:ReactNode}) {
  const [catalog,setCatalog] = useState<readonly Product[]>([]);
  const [customers,setCustomers] = useState<readonly Party[]>([]);
  useEffect(()=>{
    let active=true;
    loadOriginalPosCustomers().then(items=>{if(active)setCustomers(items);}).catch(error=>{
      if(active){setCustomers([]);toast.error(error instanceof Error ? error.message : 'Could not read live customers.');}
    });
    loadOriginalPosCatalog().then(items=>{
      if(active)setCatalog(items);
    }).catch(error=>{
      if(active){
        setCatalog([]);
        toast.error(error instanceof Error ? error.message : 'Could not read live products.');
      }
    });
    return ()=>{active=false;};
  },[]);
  return <OriginalPosCatalogContext.Provider value={catalog}><OriginalPosCustomerContext.Provider value={customers}>{children}</OriginalPosCustomerContext.Provider></OriginalPosCatalogContext.Provider>;
}
