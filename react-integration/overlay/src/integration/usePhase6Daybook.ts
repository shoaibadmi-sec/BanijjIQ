import {useEffect,useState} from 'react';
import type {EntryDateView,UnifiedTransaction} from '../types/transactions';
import type {DaybookFilterState} from '../components/daybook/DaybookFilters';
import {canUseModule,useBackendSession} from './BackendGate';
import {getLiveDaybookRows} from './banijjApi';
import {toUnifiedDaybookRow} from './phase6DaybookAdapter';

export function usePhase6Daybook(filters:DaybookFilterState,dateView:EntryDateView) {
 const user=useBackendSession();
 const permitted=canUseModule(user,'daybook','view');
 const [transactions,setTransactions]=useState<UnifiedTransaction[]>([]);
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState<50|100>(50);
 const [totalPages,setTotalPages]=useState(1),[totalRows,setTotalRows]=useState(0);
 useEffect(()=>setPage(1),[filters.from,filters.to,filters.search,filters.type,filters.account,filters.user,filters.status,dateView,pageSize]);
 useEffect(()=>{
  let active=true;
  if(!permitted){setTransactions([]);setTotalRows(0);setTotalPages(1);return;}
  if(filters.from&&filters.to&&filters.from>filters.to){
   setTransactions([]);setError('End date must follow start date.');return;
  }
  setError('');setLoading(true);setTransactions([]);
  getLiveDaybookRows({
   dateFrom:filters.from,dateTo:filters.to,
   query:filters.search,sortBy:dateView==='created'?'createdAt':'transactionDate',
   page,pageSize
  }).then(result=>{
   if(!active)return;
   setTransactions(result.rows.map(toUnifiedDaybookRow));
   setTotalRows(result.totalRows);
   setTotalPages(Math.max(1,result.totalPages));
  }).catch(e=>{
   if(active){setTransactions([]);setError(e instanceof Error?e.message:'Cannot load Daybook');}
  }).finally(()=>{if(active)setLoading(false)});
  return ()=>{active=false};
 },[permitted,filters.from,filters.to,filters.search,dateView,page,pageSize]);
 return {transactions,permitted,loading,error,page,pageSize,setPage,setPageSize,totalPages,totalRows};
}
