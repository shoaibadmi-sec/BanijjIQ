/**
 * Authenticated, intentionally one-shot preview-only demo seed client.
 * Never run without the protected GitHub environment and independent D1 preflight.
 *
 * --dry-run: only describe public, source-derived sample plan (no network).
 * --apply: requires exact confirmation, credentials, and known isolated hostname.
 */
import {buildDemoSeedPlan,executeDemoSeed} from './demo-seed-plan.mjs';

const plan=buildDemoSeedPlan();
const summary={
  productCount:plan.products.length,customerCount:plan.customers.length,
  supplierCount:plan.suppliers.length,vendorCount:plan.vendors.length,
  bankAccountCount:plan.accounts.length,purchaseCount:plan.purchases.length,
  saleCount:plan.sales.length,expenseCount:1,financePersonCount:plan.financePeople.length,
  limitations:plan.excluded
};
if(process.argv.includes('--dry-run')){
  console.log(JSON.stringify(summary,null,2));
}else if(process.argv.length===3&&process.argv[2]==='--apply'){
  const base='https://banijjiq-hisabiq-react-preview.shoaibadmisec.workers.dev';
  if(process.env.HISABIQ_DEMO_SEED_CONFIRM!=='SEED-ISOLATED-DEMO-ONLY')
    throw Error('Isolated preview-only demo seed confirmation is required');
  const phone=process.env.HISABIQ_PREVIEW_ADMIN_PHONE;
  const password=process.env.HISABIQ_PREVIEW_ADMIN_PASSWORD;
  if(!phone||!password||!process.env.GITHUB_ACTIONS)
    throw Error('Use the protected GitHub Actions preview environment; no local production credentials');
  const request=async(method,path,body,token='')=>{
    if(!path.startsWith('/api/'))throw Error('Non-API route rejected');
    const headers={'Accept':'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(token)headers.Authorization='Bearer '+token;
    const res=await fetch(base+path,{method,headers,
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const result=await res.json();
    return {...result,status:res.status};
  };
  const login=await request('POST','/api/auth/login',{phone,password});
  if(login.status!==200||!login.ok||!login.token||login.user?.role!=='admin')
    throw Error('Preview admin login failed. No fixture import started.');
  const api=(method,path,body)=>request(method,path,body,login.token);
  const status=await api('GET','/api/auth/me');
  if(status.status!==200||status.user?.role!=='admin')
    throw Error('Authenticated preview admin verification failed');
  const result=await executeDemoSeed(api,plan);
  console.log('Isolated preview D1 seeded through authenticated APIs: '+JSON.stringify(result));
  console.log('Demo source limitations remain: '+JSON.stringify(plan.excluded));
}else{
  throw Error('Use --dry-run, or --apply only within manually authorized isolated-preview GitHub workflow');
}