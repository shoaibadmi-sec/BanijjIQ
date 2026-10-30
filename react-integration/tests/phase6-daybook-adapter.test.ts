import test from 'node:test';
import assert from 'node:assert/strict';
import {toUnifiedDaybookRow} from '../overlay/src/integration/phase6DaybookAdapter.ts';
import {cashflowSummary} from '../../apps/hisabiq-web/src/utils/daybook.ts';
import type {LiveDaybookEntry} from '../overlay/src/integration/banijjApi.ts';

const sample:LiveDaybookEntry={
 ts:'2026-10-30T12:00:00',date:'2026-10-30',time:'12:00:00',
 referenceNo:'BANK-MOVE',module:'Bank Transfer',transactionType:'Transfer',
 party:'Bank A → Wallet',description:'Internal transfer',paymentMethod:'Bank',
 cashIn:0,cashOut:0,bankIn:40,bankOut:40,amount:40,runningCashBalance:null,
 createdBy:'Test Admin',status:'Active',isDeleted:false,deletedBy:'',deleteReason:'',
 isBackdated:false,backdatedDays:0,backdatedReason:'',sourceModule:'Bank Transfer',
 sourceId:'BTR-ONE',openId:'BTR-ONE',deleteAction:'',deleteId:'',canEdit:false
};

test('server-linked transfer never counts as income or expense even with both bank legs',()=>{
 const row=toUnifiedDaybookRow(sample);
 assert.equal(row.source,'transfer');
 assert.equal(row.status,'Posted');
 assert.equal(row.sourceId,'BTR-ONE');
 assert.equal(row.countsTowardCashflow,false);
 assert.deepEqual(cashflowSummary([row]),{moneyIn:0,moneyOut:0,net:0});
 assert.equal(row.sourceRoute,'/app/finance?sourceId=BTR-ONE');
});

test('bank source posted status is eligible, but an orphan needing review cannot be posted',()=>{
 const normal=toUnifiedDaybookRow({...sample,sourceModule:'Bank',module:'Bank',
  status:'Active',cashIn:20,bankIn:0,bankOut:0,amount:20});
 assert.equal(normal.status,'Posted');
 assert.equal(normal.countsTowardCashflow,true);
 assert.deepEqual(cashflowSummary([normal]),{moneyIn:20,moneyOut:0,net:20});
 const orphan=toUnifiedDaybookRow({...sample,sourceModule:'Bank',module:'Bank',
  status:'Needs review',cashIn:0,bankIn:20,bankOut:0,amount:20});
 assert.equal(orphan.status,'Draft');
 assert.match(orphan.details||'',/Needs review/);
 assert.equal(orphan.countsTowardCashflow,false);
 assert.deepEqual(cashflowSummary([orphan]),{moneyIn:0,moneyOut:0,net:0});
});

test('reversed source remains historical, never re-counted as received money',()=>{
 const row=toUnifiedDaybookRow({...sample,status:'Reversed',sourceModule:'Finance',
  cashIn:250,cashOut:0,bankIn:0,bankOut:0,amount:250});
 assert.equal(row.status,'Reversed');
 assert.equal(row.countsTowardCashflow,false);
 assert.deepEqual(cashflowSummary([row]),{moneyIn:0,moneyOut:0,net:0});
});
