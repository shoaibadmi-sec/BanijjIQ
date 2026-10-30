import type {PosBootstrap,PosSalePayload} from './banijjApi';
import type {PosPaymentMethod,PosPaymentRow} from '../hooks/usePosCart';

type Accounts=Record<PosPaymentMethod,string[]>;
const empty=():Accounts=>({
  Cash:[],Bank:[],Card:[],bKash:[],Nagad:[],
  'Mobile Banking':[],'Customer Credit':[]
});

/** Only backend-verified accounts; never infer a bank/provider from display text. */
export function verifiedOriginalPosPaymentAccounts(pos:PosBootstrap):Accounts {
  if(pos?.ok!==true||!Array.isArray(pos.bankAccounts))throw new Error('Invalid D1 payment accounts.');
  const result=empty(),ids=new Set<string>(),names=new Set<string>();
  if(pos.activeSession!==null){
    if(!pos.activeSession||typeof pos.activeSession.sessionId!=='string'||!pos.activeSession.sessionId.trim())
      throw new Error('Invalid D1 cash session identity.');
    result.Cash.push('Cash counter');
  }
  for(const account of pos.bankAccounts){
    if(!account||typeof account.id!=='string'||!account.id.trim()||
      typeof account.name!=='string'||!account.name.trim())
      throw new Error('Invalid D1 account identity.');
    if(ids.has(account.id))throw new Error('Duplicate D1 account identity.');
    ids.add(account.id);
    const type=account.accountType;
    if(type!=='Bank'&&type!=='Mobile Banking')continue; // Unsupported, not guessed.
    const name=account.name.trim(),identity=type+':'+name.toLowerCase();
    if(names.has(identity))throw new Error('Duplicate D1 payment account name.');
    names.add(identity);
    result[type].push(name);
  }
  return result;
}

/** Preserve source object/array identity used by the original CheckoutPanel. */
export function applyOriginalPosPaymentAccounts(target:Accounts,verified:Accounts):void {
  for(const method of Object.keys(target) as PosPaymentMethod[])
    target[method].splice(0,target[method].length,...verified[method]);
}

/** Convert the ORIGINAL CheckoutPanel's selected label into an authenticated D1 account ID.
 *  This does not post a sale. Splits need a real atomic backend API first.
 */
export function resolveOriginalPosSinglePayment(
  rows:readonly PosPaymentRow[],pos:PosBootstrap
):Pick<PosSalePayload,'paymentMethod'|'paidAmount'|'bankAccountId'>{
  if(!Array.isArray(rows)||rows.length!==1)
    throw new Error('Split/multiple payments require atomic backend support.');
  const row=rows[0];
  if(!row||!['Cash','Bank','Mobile Banking'].includes(row.method))
    throw new Error('Unsupported POS payment method.');
  if(typeof row.amount!=='string'||!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(row.amount))
    throw new Error('Invalid POS payment amount.');
  const paidAmount=Number(row.amount);
  if(!Number.isFinite(paidAmount)||!Number.isSafeInteger(Math.round(paidAmount*100)))
    throw new Error('Invalid POS payment amount.');
  const method=row.method as PosSalePayload['paymentMethod'];
  const verified=verifiedOriginalPosPaymentAccounts(pos);
  if(method==='Cash'){
    if(!verified.Cash.length)throw new Error('No verified active cash session.');
    if(row.account!==verified.Cash[0])throw new Error('Invalid cash payment account.');
    return {paymentMethod:method,paidAmount};
  }
  if(typeof row.account!=='string'||!verified[method].includes(row.account))
    throw new Error('Unknown D1 payment account.');
  const matches=pos.bankAccounts.filter(account=>
    account.accountType===method&&account.name.trim()===row.account
  );
  if(matches.length!==1)throw new Error('Ambiguous D1 payment account.');
  return {paymentMethod:method,paidAmount,bankAccountId:matches[0].id};
}
