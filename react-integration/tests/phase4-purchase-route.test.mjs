import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('Phase 4A original Purchase source stays intact and live routes use D1 APIs',()=>{
 const prep=read('scripts/prepare-hisabiq-react.mjs');
 for(const token of ['purchasesAnchor','purchaseEditorAnchor','LivePurchasesPage',
    'purchases-design-preview','purchase-editor-design-preview','<LivePurchaseEditor />'])
    assert.ok(prep.includes(token),token);
 const view=read('react-integration/overlay/src/integration/LivePurchasesPage.tsx');
 for(const token of ['data-live-purchases','data-live-purchase-editor','searchPurchaseSuppliers(search)',
     'getRealPurchases()','createDuePurchase(supplier,lines)','setOutcomeUnknown(true)',
     'canUseModule(user,\'purchase\',\'add\')'])
    assert.ok(view.includes(token),token);
 assert.ok(!view.includes('erpDemoStore'),'Operational Purchase route cannot display demos');
 const api=read('react-integration/overlay/src/integration/purchaseApi.ts');
 for(const route of ['/api/purchases/supplier-search','/api/purchases','/api/bootstrap'])
    assert.ok(api.includes(route),route);
});
