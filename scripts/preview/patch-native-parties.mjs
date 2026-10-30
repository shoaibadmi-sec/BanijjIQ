import {createHash} from 'node:crypto';
const SOURCE_BLOB='234f9131a57586991449d224076ed0b8f14b6bc8';
function once(s,from,to){
 const i=s.indexOf(from);
 if(i<0||s.indexOf(from,i+1)!==-1)throw Error('Pinned Party source mismatch: '+from.slice(0,90));
 return s.slice(0,i)+to+s.slice(i+from.length);
}
function between(s,start,end,to){
 const i=s.indexOf(start),j=s.indexOf(end,i+start.length);
 if(i<0||j<0||s.indexOf(start,i+1)!==-1)throw Error('Pinned Party source mismatch: '+start.slice(0,90));
 return s.slice(0,i)+to+s.slice(j);
}
/** Patches only the generated build copy, never the pinned HisabIQ_UI submodule. */
export function patchNativeParties(source){
 const sha=createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex');
 if(sha!==SOURCE_BLOB)throw Error('Pinned original Parties source blob mismatch');
 let s=source;
 s=once(s,"import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';","import { useEffect, useLayoutEffect, useState } from 'react';");
 s=once(s,"import {getVendorPreviewSnapshot,subscribeVendorPreview} from '../vendor/vendorPreviewStore';","");
 s=once(s,"import {projectVendorPartyProfile} from '../vendor/vendorPartyProjection';","");
 s=once(s,"import { getPartyPreviewSnapshot, subscribePartyPreview, dispatchPartyPreview } from '../data/partyPreviewStore';","import {useLivePartySources} from '../integration/parties/useLivePartySources';");
 s=once(s,"import { availableParties, availablePurchases } from '../data/erpDemoStore';","");
 s=once(s,"import { demoPermissions } from '../utils/permissions';","");
 s=once(s,"import { projectPartyStatement, pagedStatementRows, computePartyBalanceSummary } from '../utils/partyLedger';","import { projectPartyStatement, pagedStatementRows } from '../utils/partyLedger';");
 s=once(s,
  "  const state=useSyncExternalStore(subscribePartyPreview,getPartyPreviewSnapshot);\n  const vendorState=useSyncExternalStore(subscribeVendorPreview,getVendorPreviewSnapshot);\n  const allParties=availableParties();",
  "  const live=useLivePartySources(routeId||'');\n  const state=live.state;\n  const allParties=state.parties;");
 s=between(s,"  const completeVendorRange=","  const filtered=","  const vendorProfile=undefined;\n");
 s=once(s,
  "    .map(p=>({...p,balance:role!=='All'\n      ?computePartyBalanceSummary(state,p.id,role).netBalance\n      :p.roles.length===1?computePartyBalanceSummary(state,p.id,p.roles[0]).netBalance:0}));",
  "    .map(p=>p);");
 s=between(s,"  const receiptByPurchase =","  const normalizedRows:","");
 s=between(s,"    attachment:source.kind==='purchase' && source.reference && receiptByPurchase.get(source.reference)","  }));","    attachment:undefined\n");
 s=once(s,"  const statement=party&&relationship\n    ? projectPartyStatement(normalizedRows,party.id,relationship,range)",
  "  const statement=party&&relationship&&live.readOnlyLedgerReady===party.id\n    ? projectPartyStatement(normalizedRows,party.id,relationship,range)");
 s=once(s,"  const summary=party&&relationship\n    ? computePartyBalanceSummary(state,party.id,relationship) : null;",
  "  const summary=party&&relationship&&live.readOnlyLedgerReady===party.id\n    ? {relationship,netBalance:party.balance,due:Math.max(0,relationship==='Supplier'?-party.balance:party.balance),availableCredit:0,refundableCredit:0,labels:{due:Math.abs(party.balance)}} : null;");
 s=between(s,"  const actionsForRow=","  const resetLedger=",
  "  const actionsForRow=(_row:PartyLedgerRow):Array<{action:PartyAction;enabled:boolean}>=>[{action:'view',enabled:true}];\n");
 s=once(s,"  const balances=allParties.flatMap(p=>p.roles.map(r=>computePartyBalanceSummary(state,p.id,r).netBalance));",
  "  const balances=allParties.map(p=>p.balance);");
 s=between(s,"  const saveParty=","  const changeRole=",
  "  const blockUnconnectedAction=()=>{toast.error(uiText('Party changes and money transactions are not enabled yet.','পার্টির পরিবর্তন এবং টাকার লেনদেন এখনো চালু হয়নি।'));};\n  const saveParty=(_draft:PartyDraft,_openings:Omit<PartyOpeningPayload,'partyId'>[])=>{blockUnconnectedAction();};\n");
 s=between(s,"  const noteAction=","  return <div",
  "  const noteAction=(_type:'add'|'edit'|'delete',_idOrText:string,_text?:string)=>{blockUnconnectedAction();};\n  ");
 s=once(s,'return <div className="mx-auto min-w-0 max-w-[1440px] space-y-3 sm:space-y-4">',
  'return <div data-live-native-parties className="mx-auto min-w-0 max-w-[1440px] space-y-3 sm:space-y-4">\n    {live.loading&&<p role="status" className="text-xs text-ink-500">Loading verified Party records…</p>}\n    {live.error&&<p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">{live.error}</p>}\n    <p className="text-xs text-ink-500">Live ledger (read-only) · পার্টির খাতা (শুধু দেখা যাবে)</p>');
 s=once(s,"{party&&relationship?<PartyDetail","{party&&relationship&&live.readOnlyLedgerReady===party.id?<PartyDetail");
 s=once(s,
  "{uiText('No parties yet. Add your first party.','এখনো কোনো পার্টি নেই। নতুন পার্টি যোগ করুন।')}",
  "{live.loading?uiText('Loading verified ledger…','হিসাব লোড হচ্ছে…'):live.error?uiText('Ledger unavailable','হিসাব পাওয়া যায়নি'):party?uiText('Loading source ledger…','খাতা লোড হচ্ছে…'):uiText('Select a party from the directory.','তালিকা থেকে পার্টি নির্বাচন করুন।')}");
 s=between(s,"        onNewInvoice={()=>navigate(","        statement={statement!}",
  "        onNewInvoice={blockUnconnectedAction}\n");
 const callbacks=['onRecordPayment','onRefundCredit','onRecordFinance','onSetOpening','onEditSourcePayment','onReverseSource'];
 const ends=['onRefundCredit','onRecordFinance','onSetOpening','onEditSourcePayment','onReverseSource','onAddNote'];
 for(let i=0;i<callbacks.length;i++)
  s=between(s,"        "+callbacks[i]+"=","        "+ends[i]+"=","        "+callbacks[i]+"={()=>blockUnconnectedAction()}\n");
 s=between(s,"      onImport={parties=>","/>","      onImport={()=>blockUnconnectedAction()}");
 // Unconnected quick-add/import editors must never mutate the browser demo stores.
 const disallowed=' title="Available after server-side Party write integration" disabled';
 s=s.replaceAll('onClick={()=>setImportOpen(true)}',disallowed);
 s=s.replaceAll('onClick={()=>{setChooserOpen(false);setImportOpen(true);}}',disallowed);
 s=s.replaceAll('onClick={()=>setEditing(null)}',disallowed);
 s=s.replaceAll('onClick={()=>{setChooserOpen(false);setEditing(null);}}',disallowed);
 s=once(s,'onEditParty={()=>setEditing(party)}','onEditParty={blockUnconnectedAction}');

 for(const banned of ['availableParties','availablePurchases','getPartyPreviewSnapshot','dispatchPartyPreview','demoPermissions','subscribePartyPreview'])
  if(s.includes(banned))throw Error('Unconverted Party demo source: '+banned);
 return s;
}
