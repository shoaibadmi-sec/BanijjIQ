/** Build-copy-only Finance adaptation. Original JSX/tabs/row components remain upstream. */
export function patchSourceFinance(source){
 const edit=(before,after)=>{
  if(source.split(before).length!==2)throw Error('Finance upstream contract changed: '+before.slice(0,70));
  source=source.replace(before,after);
 };
 edit("import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';",
   "import React, { useEffect, useMemo, useState } from 'react';");
 edit("import { financePreviewRelationshipSummary, getFinancePreviewSnapshot, subscribeFinancePreview, updateFinancePreview } from '../data/financePreviewStore';",
   "import { usePhase6Finance } from '../integration/usePhase6Finance';");
 edit("import { useCashSession } from '../contexts/CashSessionContext';", "");
 edit("  accountTransfers as seedTransfers,\n  cashSessions,\n", "");
 edit("  financeAccounts as seedAccounts,\n  financeTransactions as seedTransactions,\n", "");
 edit("import { cheques as seedCheques, type ChequeRecord, type ChequeStatus } from '../data/cheques';",
   "import { type ChequeRecord, type ChequeStatus } from '../data/cheques';");
 const anchor="type Tab = 'overview' | 'transactions' | 'counter' | 'accounts' | 'cheques' | 'cash';";
 edit(anchor,anchor+"\nconst phase6Money=(value:number)=>Number.isFinite(value)?taka(value):'—';");
 edit("  const { setOpen: setCashDialogOpen, sessionOpen, openingCash, expectedCash, lastCount } = useCashSession();",
   "  const {accounts:realAccounts,transactions:realTransactions,people:realPeople,transfers:realTransfers,sessionOpen,permitted,loading,error}=usePhase6Finance();\n  const phase6ReadOnly=true;\n  const setCashDialogOpen=(_open:boolean)=>{};\n  const openingCash=Number.NaN,expectedCash=Number.NaN,lastCount=null;");
 const initial="  const { accounts, transactions, people } = useSyncExternalStore(subscribeFinancePreview, getFinancePreviewSnapshot);\n  const relationshipSummary = financePreviewRelationshipSummary(transactions);\n  const setAccounts: React.Dispatch<React.SetStateAction<FinanceAccount[]>> = (change) => updateFinancePreview('accounts', change);\n  const setTransactions: React.Dispatch<React.SetStateAction<FinanceTransaction[]>> = (change) => updateFinancePreview('transactions', change);\n  const setPeople: React.Dispatch<React.SetStateAction<FinancePerson[]>> = (change) => updateFinancePreview('people', change);";
 edit(initial,
   "  const [accounts,setAccounts]=useState<FinanceAccount[]>([]);\n  const [transactions,setTransactions]=useState<FinanceTransaction[]>([]);\n  const [people,setPeople]=useState<FinancePerson[]>([]);\n  useEffect(()=>setAccounts(realAccounts),[realAccounts]);\n  useEffect(()=>setTransactions(realTransactions),[realTransactions]);\n  useEffect(()=>setPeople(realPeople),[realPeople]);\n  const relationshipSummary={ownerCapital:Number.NaN,ownerAdvance:Number.NaN,outstandingLoan:Number.NaN,lenderCredit:Number.NaN,borrowerReceivable:Number.NaN,borrowerCredit:Number.NaN};");
 edit("  const [transfers, setTransfers] = useState<AccountTransfer[]>(() => seedTransfers.map((transfer) => ({\n    ...transfer,\n    fromAccountId: transferAccountId(transfer, 'from', seedAccounts),\n    toAccountId: transferAccountId(transfer, 'to', seedAccounts)\n  })));",
   "  const [transfers,setTransfers]=useState<AccountTransfer[]>([]);\n  useEffect(()=>setTransfers(realTransfers),[realTransfers]);");
 edit("  const [chequeRecords, setChequeRecords] = useState<ChequeRecord[]>(seedCheques);",
   "  const [chequeRecords, setChequeRecords] = useState<ChequeRecord[]>([]);");
 edit("  const totalLiquid = accounts.filter((item) => item.status === 'Active').reduce((sum, item) => sum + item.balance, 0);",
   "  const totalLiquid = Number.NaN; // Cash is not a reconciled bank balance.");
 edit("  const cashBalance = accounts.filter((item) => (item.type === 'Cash' || item.type === 'Petty Cash') && item.status === 'Active').reduce((sum, item) => sum + item.balance, 0);",
   "  const cashBalance = Number.NaN; // Only a separately sourced cash-session balance can be shown.");
 edit("  const varianceSessions = cashSessions.filter", "  const liveCashSessions:CashSessionRecord[]=[];\n  const varianceSessions = liveCashSessions.filter");
 edit("  const pendingChequeAmount = chequeRecords\n    .filter((item) => !['Cleared', 'Cancelled', 'Returned', 'Stopped', 'Bounced'].includes(item.status))\n    .reduce((sum, item) => sum + item.amount, 0);",
   "  const pendingChequeAmount=Number.NaN; // No cheque API contract; no sample records.");
 edit("cashSessions.map((session)", "liveCashSessions.map((session)");
 edit("  const pdcCount = chequeRecords.filter((item) => item.chequeDate > '2026-10-07'", "  const pdcCount = chequeRecords.filter((item) => item.chequeDate > new Date().toISOString().slice(0,10)");
 const seedTransferCount=source.split('seedTransfers.length').length-1;
 if(seedTransferCount!==2)throw Error('Finance upstream contract changed: transfer IDs');
 source=source.split('seedTransfers.length').join('0');
 edit("seedTransactions.length","0");
 edit("              onClick={() => setTab(id)}",
   '              disabled={phase6ReadOnly && (id===\'counter\'||id===\'cheques\'||id===\'cash\')}\n              onClick={() => setTab(id)}');
 edit('<button key={label} onClick={action}',
   '<button key={label} disabled={phase6ReadOnly && label===\'Transfer\'} onClick={action}');
 const unsafe=[
  "onClick={() => setPeopleOpen(true)}",
  "onClick={() => setTransactionOpen(true)}",
  "onClick={() => setChequeOpen(true)}",
  "onClick={() => setAccountOpen(true)}",
  "onClick={() => openTransfer()}",
  "onClick={() => setCashDialogOpen(true)}",
  "onClick={() => setTransactionAction(item)}",
  "onClick={() => setAccountAction(account)}"
 ];
 const financeStart=source.indexOf('export function Finance(');
 if(financeStart<0)throw Error('Finance upstream contract changed: missing source component');
 const prefix=source.slice(0,financeStart);
 let body=source.slice(financeStart);
 for(const trigger of unsafe){
   if(!body.includes(trigger))throw Error('Finance upstream contract changed: missing posting control '+trigger);
   body=body.split(trigger).join('disabled={phase6ReadOnly} '+trigger);
 }
 source=prefix+body;
 // Any remaining preview onSave actions stay unreachable until their true API contract is wired.
 // Don't replace UI components or synthesize balances to make incomplete modules look finished.
 const root='  return (\n    <div className="mx-auto max-w-[1440px] space-y-4">';
 edit(root,
   '  if(!permitted)return <main role="alert" className="p-4">You do not have permission to view Finance.</main>;\n  if(counterOnly)return <main role="alert" className="p-4">Counter posting requires verified backend integration.</main>;\n  return (\n    <div className="mx-auto max-w-[1440px] space-y-4" data-live-finance="">');
 edit('      {!counterOnly && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">',
   '      {loading&&<p role="status">Loading real Finance records…</p>}\n      {error&&<p role="alert" className="text-danger">{error}</p>}\n      {!counterOnly && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">');
 source=source.replaceAll('taka(', 'phase6Money(');
 // One safe formatter delegates only finite values to the source currency helper.
 source=source.replace("const phase6Money=(value:number)=>Number.isFinite(value)?phase6Money(value):'—';",
   "const phase6Money=(value:number)=>Number.isFinite(value)?taka(value):'—';");
 return source;
}
