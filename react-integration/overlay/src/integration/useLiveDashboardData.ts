import {useEffect,useState} from 'react';
import {businessToday} from '../utils/dateRange';
import {canUseModule,useBackendSession} from './BackendGate';
import {getBootstrap,getLiveReportSummary} from './banijjApi';

type Value={value:string;foot:string};
type DashboardValues=Record<string,Value>;

const metricIds:Record<string,string>={
  netSales:'today-sales',
  receivablesBalance:'receivable',
  payablesBalance:'payable',
  cashCurrentBalance:'cash',
  grossProfit:'gross-profit'
};
const takaMinor=(minor:number)=>
  '৳'+(minor/100).toLocaleString('en-BD',{maximumFractionDigits:2});

/** Existing authorized API summaries only: never convert incomplete amounts into 0. */
export function useLiveDashboardData(){
  const user=useBackendSession();
  const [values,setValues]=useState<DashboardValues>({});
  useEffect(()=>{
    let alive=true;
    setValues({});
    if(canUseModule(user,'reports','view')){
      const date=businessToday();
      getLiveReportSummary(date,date).then(result=>{
        if(!alive)return;
        const verified:DashboardValues={};
        for(const metric of result.metrics){
          const id=metricIds[metric.key];
          if(!id||!(metric.status==='ready')||metric.valueMinor===null||
            !Number.isFinite(metric.valueMinor))continue;
          verified[id]={value:takaMinor(metric.valueMinor),foot:'Verified from recorded sources'};
        }
        setValues(previous=>({...previous,...verified}));
      }).catch(()=>{/* Unavailable totals remain visibly unavailable, never demo values. */});
    }
    if(canUseModule(user,'products','view')){
      getBootstrap().then(result=>{
        if(!alive)return;
        const count=result.products.filter(p=>p.status==='Active'&&
          Number.isFinite(p.sellableStock??p.currentStock)&&
          (p.sellableStock??p.currentStock)<p.minimumStock).length;
        setValues(previous=>({...previous,'low-stock':{
          value:count+' items',foot:'Below minimum · live product stock'
        }}));
      }).catch(()=>{/* Product stock remains unavailable without authenticated data. */});
    }
    return ()=>{alive=false};
  },[user]);
  return {values};
}
