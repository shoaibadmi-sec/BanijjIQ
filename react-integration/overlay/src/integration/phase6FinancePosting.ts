import type {AccountTransfer} from '../data/financeAccounts';
import type {LiveBankTransferInput} from './banijjApi';

/** Validates user input before immutable, idempotent bank transfer posting. */
export function toVerifiedTransferPost(transfer:AccountTransfer,clientRequestId:string):LiveBankTransferInput {
 const fromAccountId=transfer.fromAccountId?.trim()??'';
 const toAccountId=transfer.toAccountId?.trim()??'';
 if(!fromAccountId||!toAccountId||fromAccountId===toAccountId)
   throw new Error('Choose two different money accounts.');
 if(!clientRequestId||clientRequestId.length<8)
   throw new Error('Missing stable transfer request identity.');
 const minor4=transfer.amount*10000;
 const ticks=Math.round(minor4);
 if(!Number.isFinite(minor4)||!Number.isSafeInteger(ticks)||ticks<=0||Math.abs(minor4-ticks)>0.000001)
   throw new Error('Transfer amount must be positive with at most four decimal places.');
 return {fromAccountId,toAccountId,amount:ticks/10000,
  notes:transfer.reference?.trim()||'',clientRequestId};
}
