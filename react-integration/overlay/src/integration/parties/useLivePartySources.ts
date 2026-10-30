import {useEffect,useMemo,useState} from 'react';
import {getLivePartyDirectory,getLivePartyLedger,type LiveParty,type LivePartyLedger} from '../partyApi';
import type {Party} from '../../../types/erp';
import type {PartyPreviewState,PartySourceRecord,PartyLedgerSource} from '../../../types/partyLedger';

const toParty=(item:LiveParty):Party=>({
 id:item.id,name:item.name,phone:item.phone,roles:[item.role],
 area:'',balance:item.balance,lastActivity:'',avatarColor:'teal',
 status:item.status==='Inactive'?'Inactive':'Active'
});
const sourceKind=(role:'Customer'|'Supplier',type:string):PartyLedgerSource=>{
 const t=type.toLowerCase();
 if(t.includes('opening'))return 'opening';
 if(t.includes('return'))return role==='Customer'?'sale-return':'purchase-return';
 if(t.includes('payment')||t.includes('settlement'))return role==='Customer'?'customer-payment':'supplier-payment';
 return role==='Customer'?'sale':'purchase';
};
const mapLedger=(ledger:LivePartyLedger):PartySourceRecord[]=>
 ledger.rows.map((row,index)=>({
  id:row.id,partyId:ledger.id,relationship:ledger.role,
  kind:sourceKind(ledger.role,row.type),date:row.date,
  sequence:index+1,reference:row.reference,
  description:[row.type,row.notes].filter(Boolean).join(' · '),
  debit:ledger.role==='Supplier'?row.credit:row.debit,
  credit:ledger.role==='Supplier'?row.debit:row.credit,
  method:row.paymentMethod,status:'Active' as const,
  provenance:'legacy-unverified' as const
 }));

/** Read-only projection for the pinned HisabIQ Party layout; no demo stores or writes. */
export function useLivePartySources(selectedId:string){
 const [directory,setDirectory]=useState<LiveParty[]>([]);
 const [loaded,setLoaded]=useState(false);
 const [ledger,setLedger]=useState<LivePartyLedger|null>(null);
 const [busyId,setBusyId]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  setLoaded(false);setError('');setDirectory([]);
  getLivePartyDirectory().then(rows=>{if(active)setDirectory(rows);})
   .catch(reason=>{if(active){setDirectory([]);setError(reason instanceof Error?reason.message:'Could not load parties');}})
   .finally(()=>{if(active)setLoaded(true);});
  return()=>{active=false;};
 },[]);
 useEffect(()=>{
  const selected=directory.find(p=>p.id===selectedId);
  if(!selected){setLedger(null);setBusyId('');return;}
  let active=true;
  setBusyId(selected.id);setLedger(null);setError('');
  getLivePartyLedger(selected.role,selected.sourceId)
   .then(result=>{if(active&&result.id===selected.id)setLedger(result);})
   .catch(reason=>{if(active){setLedger(null);setError(reason instanceof Error?reason.message:'Ledger unavailable');}})
   .finally(()=>{if(active)setBusyId('');});
  return()=>{active=false;};
 },[directory,selectedId]);
 const state=useMemo<PartyPreviewState>(()=>({
  parties:directory.map(toParty),sources:ledger&&ledger.id===selectedId?mapLedger(ledger):[],
  audit:[],revision:0
 }),[directory,ledger,selectedId]);
 return {state,loading:!loaded||!!busyId,error,
  readOnlyLedgerReady:ledger?.id===selectedId&&!busyId?selectedId:''};
}
