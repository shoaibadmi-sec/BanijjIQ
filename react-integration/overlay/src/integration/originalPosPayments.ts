import type {PosBootstrap} from './banijjApi';
import type {PosPaymentMethod} from '../hooks/usePosCart';

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
