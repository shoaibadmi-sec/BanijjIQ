import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BackendProduct, BasicProductInput, ProductCatalogEdit } from '../banijjApi';
import {
  adjustProductStock, changeProductStatus, createProduct, editProduct,
  loadProductCatalog, loadProductHistory, loadProductLots
} from './productApi';
import type { LiveLot, StockMovement } from './productApi';
import { toCatalogView, type Lookup } from './productContracts';

type PendingOperation='create'|'edit'|'adjust'|'status'|null;
export function useLiveProducts(enabled=true) {
  const [items,setItems]=useState<BackendProduct[]>([]);
  const [lookups,setLookups]=useState<{categories:Lookup[];brands:Lookup[];units:Lookup[]}>({
    categories:[],brands:[],units:[]
  });
  const [stockValueByProduct,setStockValueByProduct]=useState<Record<string,number|null>>({});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [pendingOperation,setPendingOperation]=useState<PendingOperation>(null);
  const pendingRef=useRef(false);
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const requestId=++generation.current;
    setLoading(true);setError('');
    try {
      const response=await loadProductCatalog();
      const view=toCatalogView(response);
      if(requestId===generation.current){
        setItems(response.products);
        setLookups({categories:view.categories,brands:view.brands,units:view.units});
        setStockValueByProduct(Object.fromEntries(
          response.products.map((p,i)=>[p.productId,view.items[i].stockValue])));
      }
      return response;
    } catch(e) {
      if(requestId===generation.current)setError(e instanceof Error?e.message:'Could not load products');
      throw e;
    } finally {
      if(requestId===generation.current)setLoading(false);
    }
  },[]);
  useEffect(()=>{if(enabled)void refresh().catch(()=>{});return()=>{generation.current++;};},[refresh,enabled]);
  const runWrite=useCallback(async<T,>(operation:Exclude<PendingOperation,null>,write:()=>Promise<T>):Promise<T>=>{
    if(pendingRef.current)throw new Error('A product operation is already in progress.');
    pendingRef.current=true;
    setPendingOperation(operation);setError('');
    try {
      const result=await write();
      // Never report a successful save before the authoritative D1 catalog is reloaded.
      await refresh();
      return result;
    } catch(e) {
      setError(e instanceof Error?e.message:'Product operation failed');
      throw e; // Caller decides whether a retry is safe; NEVER automatically retry a POST.
    } finally {pendingRef.current=false;setPendingOperation(null);}
  },[refresh]);
  const create=useCallback((input:BasicProductInput)=>runWrite('create',()=>createProduct(input)),[runWrite]);
  const edit=useCallback((productId:string,input:ProductCatalogEdit)=>runWrite('edit',()=>editProduct(productId,input)),[runWrite]);
  const adjustStock=useCallback((productId:string,delta:number,note:string)=>
    runWrite('adjust',()=>adjustProductStock(productId,delta,note)),[runWrite]);
  const setStatus=useCallback((productId:string,status:'Active'|'Inactive')=>
    runWrite('status',()=>changeProductStatus(productId,status)),[runWrite]);
  const loadLots=useCallback((productId:string):Promise<LiveLot[]>=>loadProductLots(productId),[]);
  const loadHistory=useCallback((productId:string):Promise<StockMovement[]>=>loadProductHistory(productId),[]);
  return useMemo(()=>({
    items,lookups,stockValueByProduct,loading,error,pendingOperation,
    refresh,create,edit,adjustStock,setStatus,loadLots,loadHistory
  }),[items,lookups,stockValueByProduct,loading,error,pendingOperation,refresh,create,edit,adjustStock,setStatus,loadLots,loadHistory]);
}
