import {createContext, useEffect, useState, type ReactNode} from 'react';
import {toast} from 'sonner';
import type {Product,Party} from '../types/erp';
import {getPosBootstrap} from './banijjApi';
import {mapOriginalPosCustomers} from './originalPosCustomers';
import {loadOriginalPosCatalog,attachOriginalPosUnitProfiles} from './originalPosCatalog';

export const OriginalPosCatalogContext = createContext<readonly Product[] | null>(null);
export const OriginalPosCustomerContext = createContext<readonly Party[] | null>(null);

/** Data provider only. Original POS preview does not post financial transactions. */
export function OriginalPosCatalogProvider({children}: {children:ReactNode}) {
  const [catalog,setCatalog] = useState<readonly Product[]>([]);
  const [customers,setCustomers] = useState<readonly Party[]>([]);
  useEffect(()=>{
    let active=true;
    Promise.all([loadOriginalPosCatalog(),getPosBootstrap()]).then(([products,pos])=>{
      const verified=attachOriginalPosUnitProfiles(products,pos);
      const parties=mapOriginalPosCustomers(pos);
      if(active){setCatalog(verified);setCustomers(parties);}
    }).catch(error=>{
      if(active){
        setCatalog([]);setCustomers([]);
        toast.error(error instanceof Error ? error.message : 'Could not verify live POS data.');
      }
    });
    return ()=>{active=false;};
  },[]);
  return <OriginalPosCatalogContext.Provider value={catalog}><OriginalPosCustomerContext.Provider value={customers}>{children}</OriginalPosCustomerContext.Provider></OriginalPosCatalogContext.Provider>;
}
