import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchNativeParties} from '../../scripts/preview/patch-native-parties.mjs';

test('4L original HisabIQ Party page is reused and reads authenticated D1 sources only',()=>{
 const original=readFileSync(new URL('../../apps/hisabiq-web/src/pages/Parties.tsx',import.meta.url),'utf8');
 const output=patchNativeParties(original);
 for(const value of ['<PartyDirectory','<PartyDetail','<PartyActionSheet','<PageHeader',
   'useLivePartySources','data-live-native-parties','getLivePartyLedger','getLivePartyDirectory']){
  assert.ok(output.includes(value),'Original Party UI/live source missing: '+value);
 }
 for(const demo of ['availableParties','availablePurchases','getPartyPreviewSnapshot',
   'dispatchPartyPreview','demoPermissions','subscribePartyPreview']){
  assert.ok(!output.includes(demo),'Demo Party source or write remains: '+demo);
 }
 assert.ok(output.includes('blockUnconnectedAction'),'Unverified party writes must fail closed');
 assert.ok(output.includes('state.parties'),'Directory must use actual D1 parties');
 assert.ok(output.includes('readOnlyLedgerReady'),'Selected statement must not appear before D1 source fetch');
});

test('4L refuses to patch an altered upstream Party page',()=>{
 assert.throws(()=>patchNativeParties('export function Parties() { return <h1>Different UI</h1>; }'),/source|pinned|mismatch/i);
});
