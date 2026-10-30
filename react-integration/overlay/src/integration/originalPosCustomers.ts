import {getPosBootstrap, type PosBootstrap} from './banijjApi';
import type {Party} from '../types/erp';

/** Map authenticated customers and their authoritative D1 due into the existing Party view contract. */
export function mapOriginalPosCustomers(result:PosBootstrap):readonly Party[]{
  if(result?.ok!==true||!Array.isArray(result.customers))throw new Error('Invalid D1 customers response.');
  const ids=new Set<string>();
  return result.customers.map(row=>{
    if(!row||typeof row.id!=='string'||!row.id.trim()||typeof row.phone!=='string')
      throw new Error('Invalid D1 customer identity.');
    if(ids.has(row.id))throw new Error('Duplicate D1 customer identity.');
    ids.add(row.id);
    if(typeof row.currentDue!=='number'||!Number.isFinite(row.currentDue))
      throw new Error('Invalid D1 customer due.');
    return {
      id:row.id,name:row.name?.trim()||row.phone,phone:row.phone,
      roles:['Customer'],area:row.address??'',balance:row.currentDue,
      lastActivity:'',avatarColor:'#0D7C74',status:'Active'
    };
  });
}

export async function loadOriginalPosCustomers(
  load:()=>Promise<PosBootstrap> = getPosBootstrap
):Promise<readonly Party[]>{
  return mapOriginalPosCustomers(await load());
}
