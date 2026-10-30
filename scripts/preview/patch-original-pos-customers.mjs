import {createHash} from 'node:crypto';
const SOURCE_BLOB='a2cf1d741d81a2b415d78b1a6d48b3d8a3c9067a';
const sha=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex');
function once(source,oldValue,newValue,tag){
  const pos=source.indexOf(oldValue);
  if(pos<0||source.indexOf(oldValue,pos+1)>=0)throw new Error('Original CustomerPicker source mismatch: '+tag);
  return source.slice(0,pos)+newValue+source.slice(pos+oldValue.length);
}
/** Data-only original picker integration: returns original JSX verbatim. */
export function patchOriginalPosCustomerPicker(source){
  if(sha(source)!==SOURCE_BLOB)throw new Error('Unknown original CustomerPicker revision.');
  let next=once(source,"import { useState, useSyncExternalStore } from 'react';",
    "import { useState, useContext } from 'react';",'react import');
  next=once(next,"import {getPartyPreviewSnapshot,subscribePartyPreview} from '../../data/partyPreviewStore';",
    "import {OriginalPosCustomerContext} from '../../integration/OriginalPosCatalogProvider';",'customer data source');
  next=once(next,'  const partyState=useSyncExternalStore(subscribePartyPreview,getPartyPreviewSnapshot);',
    '  const partyState={parties:useContext(OriginalPosCustomerContext)??[]};','real customer list');
  return next;
}
