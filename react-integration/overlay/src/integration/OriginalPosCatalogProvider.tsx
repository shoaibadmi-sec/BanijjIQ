import {createContext, useEffect, useState, type ReactNode} from 'react';
import {toast} from 'sonner';
import type {Product} from '../types/erp';
import {loadOriginalPosCatalog} from './originalPosCatalog';

export const OriginalPosCatalogContext = createContext<readonly Product[] | null>(null);

/** Data provider only. Original POS preview does not post financial transactions. */
export function OriginalPosCatalogProvider({children}: {children:ReactNode}) {
  const [catalog,setCatalog] = useState<readonly Product[]>([]);
  useEffect(()=>{
    let active=true;
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
  return <OriginalPosCatalogContext.Provider value={catalog}>{children}</OriginalPosCatalogContext.Provider>;
}
