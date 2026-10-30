import {useEffect,useState} from 'react';
import {businessToday} from '../utils/dateRange';
import type {ReportData,ReportFilters,ReportKey,ReportResult,ReportRow} from '../reports/types';
import {getLiveReportRows,type LiveReportBackendKey,type LiveReportStatus,type LiveReportRecord} from './banijjApi';

// The pinned HisabIQ report components are the only presentation layer.
// Never pass data from browser preview stores into a live financial report.
export const emptyLiveReportData:ReportData={
 asOf:businessToday(),sales:[],saleLines:[],returns:[],purchases:[],purchaseLines:[],
 expenses:[],stock:[],lots:[],movements:[],cash:[],finance:[],warranty:[],quality:[]
};
const reportApi:Partial<Record<ReportKey,LiveReportBackendKey>>={
 'sales-register':'sales',purchases:'purchase',stock:'stock',
 receivables:'receivables',payables:'payables','cash-book':'cash',
 expenses:'expenses','finance-movements':'finance',
 'product-profit':'product-profit','profit-loss':'profit-loss'
};
const maximumRows=500;
const unavailable=(reason:string):ReportResult=>({
 rows:[],totals:{amount:null},basis:reason,basisBn:'মূল হিসাব এখনো যাচাই করা যায়নি।'
});
const toRow=(record:LiveReportRecord,report:LiveReportBackendKey):ReportRow=>{
 const amount=record.amountMinor===null?null:record.amountMinor/100;
 return {
  id:record.sourceId,label:report==='sales'||report==='purchase'?record.sourceId:record.label,
  party:report==='sales'||report==='purchase'?record.label:undefined,
  date:record.date,status:record.status,
  route:report==='sales'?'/app/sales?q='+encodeURIComponent(record.sourceId):
   report==='purchase'?'/app/purchases?q='+encodeURIComponent(record.sourceId):undefined,
  values:{amount,inflow:amount===null?null:Math.max(0,amount),
   outflow:amount===null?null:Math.max(0,-amount),
   paid:report==='sales'&&typeof record.paidMinor==='number'?record.paidMinor/100:null,
   due:report==='sales'&&typeof record.dueMinor==='number'?record.dueMinor/100:null,
   cost:null,profit:null,stock:null,quantity:null},
  note:record.reason
 };
};
type Status=LiveReportStatus|'loading';
type State={key:string;result:ReportResult;status:Status;reason:string;loading:boolean};
export function useLiveReportResult(key:ReportKey,filters:ReportFilters,refresh:number){
 const requestKey=JSON.stringify([key,filters.from,filters.to,filters.search,
  filters.category,filters.brand,filters.product,filters.party,filters.user,
  filters.account,filters.status,filters.compare,filters.sort,filters.direction,refresh]);
 const [saved,setSaved]=useState<State|null>(null);
 useEffect(()=>{
  let active=true;
  const api=reportApi[key];
  const unsupportedFilter=Boolean(filters.category||filters.brand||filters.product||
   filters.party||filters.user||filters.account||filters.status||filters.compare!=='none');
  if(!api||unsupportedFilter){
   setSaved({key:requestKey,result:unavailable(unsupportedFilter
    ?'This filter requires a verified backend source. No preview data is shown.'
    :'This report is not yet connected to an authenticated backend source.'),
    status:'unavailable',reason:'Source data unavailable',loading:false});
   return;
  }
  setSaved({key:requestKey,result:unavailable('Loading authenticated source records…'),
   status:'loading',reason:'Loading real records',loading:true});
  const run=async()=>{
   const params={report:api,from:filters.from,to:filters.to,pageSize:100 as const,
    search:filters.search};
   const first=await getLiveReportRows({...params,page:1});
   if(first.totalRows>maximumRows){
    throw new Error('More than '+maximumRows+' source rows. Full, safe server paging is not yet supported; no partial totals are shown.');
   }
   const pages=await Promise.all(Array.from({length:Math.ceil(first.totalRows/100)-1},
    (_,i)=>getLiveReportRows({...params,page:i+2})));
   const all=[first,...pages];
   if(all.some(p=>p.report!==api||p.totalRows!==first.totalRows||
      p.coverage.status!==first.coverage.status)){
    throw new Error('Report source changed during pagination; totals withheld.');
   }
   let rows=all.flatMap(p=>p.rows).map(record=>toRow(record,api));
   if(rows.length!==first.totalRows)throw new Error('Incomplete report pages; totals withheld.');
   const field=(row:ReportRow)=>filters.sort==='amount'?Number(row.values.amount??0):
    filters.sort==='date'?row.date:filters.sort==='label'?row.label:row.id;
   rows=rows.sort((x,y)=>{const l=field(x),r=field(y);
    const d=typeof l==='number'&&typeof r==='number'?l-r:String(l).localeCompare(String(r));
    return (filters.direction==='asc'?1:-1)*Math.sign(d)||x.id.localeCompare(y.id);
   });
   const certified=first.coverage.status==='ready'&&rows.every(r=>typeof r.values.amount==='number');
   const sumMinor=certified?all.flatMap(p=>p.rows).reduce((n,r)=>n+Number(r.amountMinor),0):null;
   const result:ReportResult={rows,totals:{amount:sumMinor===null?null:sumMinor/100},
    basis:first.coverage.reason||'Authenticated BanijjIQ records',
    basisBn:'মূল BanijjIQ হিসাবের রেকর্ড'};
   if(active)setSaved({key:requestKey,result,status:first.coverage.status,
    reason:first.coverage.reason,loading:false});
  };
  void run().catch(error=>{if(active){
   const reason=error instanceof Error?error.message:'Could not load real report records.';
   setSaved({key:requestKey,result:unavailable(reason),status:'unavailable',reason,loading:false});
  }});
  return ()=>{active=false;};
 },[requestKey]);
 return saved?.key===requestKey?saved:{
  key:requestKey,result:unavailable('Loading authenticated source records…'),
  status:'loading' as const,reason:'Loading real records',loading:true
 };
}
