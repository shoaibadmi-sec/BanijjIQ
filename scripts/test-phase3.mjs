// Run ALL Phase 3 native accounting tests in one command.
// Reuse the same existing tests as GitHub Actions; no second test framework.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const full=process.argv.includes('--full');
const tests=[
  'tests/product-catalog.integration.test.ts',
  'tests/pos-accounting.integration.test.ts',
  'tests/products-hybrid.integration.test.ts',
  'tests/pos-unit-profile.integration.test.ts',
  'tests/pos-mixed-sale.integration.test.ts',
  'tests/pos-mixed-return.integration.test.ts',
  'tests/pos-mixed-reversal.integration.test.ts',
  'tests/pos-bank-reversal.integration.test.ts',
  'tests/pos-due-reversal.integration.test.ts',
  'tests/store-credit-liability.integration.test.ts',
  'tests/store-credit-issuance.integration.test.ts',
  'tests/store-credit-redemption.integration.test.ts',
  'tests/store-credit-reconciliation.integration.test.ts',
  'tests/store-credit-cases.integration.test.ts',
  'tests/store-credit-case-resolution.integration.test.ts',
  'tests/store-credit-outstanding-impact.integration.test.ts',
  'tests/store-credit-historical-compensation.integration.test.ts',
  'tests/split-sale-tenders.integration.test.ts',
  'tests/phase3-split-refund-permissions.integration.test.ts'
];
function run(label,cmd,args,cwd=root){
  process.stdout.write('\n### Phase 3: '+label+'\n');
  const {status,error}=spawnSync(cmd,args,{cwd,stdio:'inherit',env:process.env});
  if(error||status!==0){
    if(error)console.error(error);
    process.exit(status||1);
  }
}
if(full)run('Backend TypeScript',process.platform==='win32'?'npm.cmd':'npm',['run','backend:build']);
run('Full-migration SQLite + Hono accounting',process.execPath,['--import','tsx','--test',...tests]);
run('Pinned POS and Returns source-contract checks',process.execPath,[
  '--test',
  'react-integration/tests/pos-source-parity.test.mjs',
  'react-integration/tests/pos-checkout-source-parity.test.mjs',
  'react-integration/tests/phase3-split-refund-return-contract.test.mjs'
]);
if(full){
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const npx=process.platform==='win32'?'npx.cmd':'npx';
  run('React source-backed build',npm,['run','react:build']);
  run('Install Playwright Chromium',npx,['--no-install','playwright','install','chromium'],
    resolve(root,'.generated/hisabiq-web'));
  run('390/768/1440 browser, screenshots and axe',process.execPath,['ui-checks/run.mjs']);
  for(const name of ['run','historical-credit','phase12','phase13-browser'])
    run('Ephemeral Worker/D1 '+name,process.execPath,['d1-checks/'+name+'.mjs']);
}
console.log('Phase 3 '+(full?'FULL ':'')+'test gate passed. Hosted preview/accounting signoff are separate.');
