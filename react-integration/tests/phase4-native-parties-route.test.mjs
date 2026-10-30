import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchNativeParties} from '../../scripts/preview/patch-native-parties.mjs';

test('4L original HisabIQ Party page is reused and reads authenticated D1 sources only',()=>{
 const original=readFileSync(new URL('../../apps/hisabiq-web/src/pages/Parties.tsx',import.meta.url),'utf8');
 const output=patchNativeParties(original);
 for(const value of ['<PartyDirectory','<PartyDetail','<PartyActionSheet','<PageHeader',
   'useLivePartySources','data-live-native-parties']){
  assert.ok(output.includes(value),'Original Party UI/live source missing: '+value);
 }
 for(const demo of ['availableParties','availablePurchases','getPartyPreviewSnapshot',
   'dispatchPartyPreview','demoPermissions','subscribePartyPreview']){
  assert.ok(!output.includes(demo),'Demo Party source or write remains: '+demo);
 }
 const sourceHook=readFileSync(new URL('../overlay/src/integration/parties/useLivePartySources.ts',import.meta.url),'utf8');
 assert.ok(sourceHook.includes('getLivePartyLedger')&&sourceHook.includes('getLivePartyDirectory'),
   'Live Party hook must use merged authenticated source APIs');
 assert.ok(output.includes('blockUnconnectedAction'),'Unverified party writes must fail closed');
 assert.ok(output.includes('Available after server-side Party write integration'),
   'Unconnected import and add/edit actions must be disabled');
 const prep=readFileSync(new URL('../../scripts/prepare-hisabiq-react.mjs',import.meta.url),'utf8');
 assert.ok(prep.includes('patchNativeParties')&&prep.includes('generatedPartiesPath'),
   'Only generated original Party source is patched at build time');
 assert.ok(output.includes('state.parties'),'Directory must use actual D1 parties');
 assert.ok(output.includes('readOnlyLedgerReady'),'Selected statement must not appear before D1 source fetch');
});

test('4L refuses to patch an altered upstream Party page',()=>{
 assert.throws(()=>patchNativeParties('export function Parties() { return <h1>Different UI</h1>; }'),/source|pinned|mismatch/i);
});
