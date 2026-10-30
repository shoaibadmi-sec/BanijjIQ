import test from 'node:test';
import assert from 'node:assert/strict';
import {toVerifiedTransferPost} from '../overlay/src/integration/phase6FinancePosting.ts';
import type {AccountTransfer} from '../../apps/hisabiq-web/src/data/financeAccounts.ts';

const transfer:AccountTransfer={id:'UI-ONLY',date:'2026-10-31',from:'Main Bank',
 to:'bKash',fromAccountId:'BANK-1',toAccountId:'WALLET-2',
 amount:12.1234,reference:'Operating float',status:'Completed'};

test('Phase 6 source transfer posts exact bank account IDs, at most 4 decimals and stable request ID',()=>{
 assert.deepEqual(toVerifiedTransferPost(transfer,'request-immutable-001'),{
  fromAccountId:'BANK-1',toAccountId:'WALLET-2',amount:12.1234,
  notes:'Operating float',clientRequestId:'request-immutable-001'
 });
 assert.equal(toVerifiedTransferPost({...transfer,amount:0.0001},'request-immutable-001').amount,0.0001);
});

test('Transfer input rejects overdraft-like precision and invalid endpoints before any POST',()=>{
 for(const invalid of [
   {...transfer,toAccountId:'BANK-1'},
   {...transfer,fromAccountId:''},
   {...transfer,amount:0},
   {...transfer,amount:-1},
   {...transfer,amount:Number.NaN},
   {...transfer,amount:1.12345},
   {...transfer,amount:Number.MAX_SAFE_INTEGER}
 ])assert.throws(()=>toVerifiedTransferPost(invalid,'request-immutable-001'));
 assert.throws(()=>toVerifiedTransferPost(transfer,'bad'));
});
