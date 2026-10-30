import {useEffect,useState} from 'react';
import type {FinanceAccount,FinancePerson,FinanceTransaction,AccountTransfer} from '../data/financeAccounts';
import {canUseModule,useBackendSession} from './BackendGate';
import {getFinanceBootstrap,getBankAccounts,getBankReconciliation,getBankTransfers,
  getFinancePersonLedger,getCashSessionSummary} from './banijjApi';

type FinanceState={
 accounts:FinanceAccount[];people:FinancePerson[];transactions:FinanceTransaction[];
 transfers:AccountTransfer[];sessionOpen:boolean;
};
const empty:FinanceState={accounts:[],people:[],transactions:[],transfers:[],sessionOpen:false};
const financeTypes:Record<string,FinanceTransaction['type']>={
 'Owner Investment':'Owner Credit','Owner Withdrawal':'Owner Debit',
 'Loan Received':'Lender Credit','Loan Repayment':'Lender Debit'
};

export function usePhase6Finance(){
 const user=useBackendSession();
 const financeAccess=canUseModule(user,'finance','view');
 const bankAccess=canUseModule(user,'bank','view');
 const cashAccess=canUseModule(user,'pos','view');
 const permitted=financeAccess||bankAccess;
 const [state,setState]=useState<FinanceState>(empty);
 const [error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  let active=true;setState(empty);setError('');
  if(!permitted)return;
  setLoading(true);
  (async()=>{
   const [personData,bankData,reconcileData,transferData,cashData]=await Promise.all([
    financeAccess?getFinanceBootstrap():Promise.resolve(null),
    bankAccess?getBankAccounts():Promise.resolve(null),
    bankAccess?getBankReconciliation():Promise.resolve(null),
    bankAccess?getBankTransfers():Promise.resolve(null),
    cashAccess?getCashSessionSummary():Promise.resolve(null)
   ]);
   const accounts:FinanceAccount[]=(bankData?.bankAccounts||[]).map(account=>{
    const verified=reconcileData?.accounts.find(a=>a.id===account.id);
    const ready=verified?.status==='ready'&&verified.bookBalance!==null;
    return {id:account.id,name:account.name,type:account.accountType,
     balance:ready?verified!.bookBalance!:Number.NaN,
     openingBalance:verified?.openingBalance??Number.NaN,
     status:account.status==='Active'?'Active':'Inactive',
     lastActivity:ready?'Reconciled':'Needs review'};
   });
   const people:FinancePerson[]=(personData?.personsAll||[]).map(p=>({
    id:p.id,name:p.name,phone:p.phone,roles:[p.type],status:p.status==='Active'?'Active':'Inactive'
   }));
   const all=await Promise.all(people.map(async person=>{
    const ledger=await getFinancePersonLedger(person.id,{page:1,pageSize:50});
    return {person,ledger};
   }));
   const transactions:FinanceTransaction[]=[];
   let needsReview=0;
   for(const {person,ledger} of all){
    if(ledger.coverage.status!=='ready'){needsReview++;continue;}
    for(const r of ledger.rows){
     if(r.sourceStatus!=='matched'){needsReview++;continue;}
     const type=financeTypes[r.transactionType];
     if(!type)continue;
     const incoming=type==='Owner Credit'||type==='Lender Credit';
     transactions.push({id:r.financeId,date:r.date,type,party:person.name,
      partyId:person.id,relationship:person.roles[0]==='Owner'?'Owner Balance':'Lender Balance',
      method:r.paymentMethod==='Cash'?'Cash':r.paymentMethod==='Bank'?'Bank':'Mobile Banking',
      amount:r.amount,direction:incoming?'in':'out',
      reference:r.referenceNo,note:r.notes,status:'Active',createdBy:r.createdBy});
    }
   }
   const transfers:AccountTransfer[]=(transferData?.transfers||[]).map(t=>({
    id:t.transferId,date:t.date,from:t.fromAccountName,to:t.toAccountName,
    fromAccountId:t.fromAccountId,toAccountId:t.toAccountId,amount:t.amount,
    reference:t.notes,status:t.reversedAt?'Reversed':'Completed'
   }));
   if(active){
    setState({accounts,people,transactions,transfers,
      sessionOpen:cashData?.summary!==null&&cashData!==null});
    setError(needsReview>0?'Some finance source records need independent review. Unverified amounts are hidden.':'');
   }
  })().catch(e=>{if(active){setState(empty);setError(e instanceof Error?e.message:'Cannot load Finance.');}})
     .finally(()=>{if(active)setLoading(false)});
  return ()=>{active=false};
 },[permitted,financeAccess,bankAccess,cashAccess]);
 return {...state,permitted,loading,error};
}
