/**
 * GitHub UI checks for the pinned HisabIQ React build.
 * All business data is synthetic; all /api requests are intercepted.
 * Screenshots, layout data, accessibility reports and browser errors go to ui-checks/output.
 */
import assert from 'node:assert/strict';
import { runProductsHybridChecks } from './products-hybrid.mjs';
import { runFinalProductChecks } from './products-final.mjs';
import {runPaidRefundChecks} from './phase4-paid-refunds.mjs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root=resolve(process.cwd()), web=join(root,'.generated/hisabiq-web');
const require=createRequire(pathToFileURL(join(web,'package.json')));
const { chromium }=require('playwright');
const out=join(root,'ui-checks/output');
mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:4173';
const productData=[
 {productId:'PRD-000001',productName:'Copper Cable 2.5mm',displayName:'Copper Cable 2.5mm',
  brand:'Demo Brand',category:'Electrical',unit:'Pcs',barcode:'UI-E2E-001',
  purchasePrice:80,sellingPrice:120,currentStock:25,sellableStock:25,minimumStock:5,
  trackSerial:0,trackExpiry:0,trackWarranty:0,status:'Active',updatedAt:'2026-10-28 12:00:00'},
 {productId:'PRD-000002',productName:'PVC Pipe 20mm',displayName:'PVC Pipe 20mm',
  brand:'Demo Brand',category:'Hardware',unit:'Pcs',barcode:'UI-E2E-002',
  purchasePrice:35,sellingPrice:55,currentStock:3,sellableStock:3,minimumStock:5,
  trackSerial:0,trackExpiry:0,trackWarranty:0,status:'Active',updatedAt:'2026-10-28 12:00:00'},
 {productId:'PRD-000003',productName:'Serial Tracked Motor',displayName:'Serial Tracked Motor',
  brand:'Demo Brand',category:'Electrical',unit:'Pcs',barcode:'UI-E2E-003',
  purchasePrice:500,sellingPrice:700,currentStock:2,sellableStock:2,minimumStock:1,
  trackSerial:1,trackExpiry:0,trackWarranty:1,status:'Active',updatedAt:'2026-10-28 12:00:00'}
];
const user={userId:'UI-E2E-ADMIN',fullName:'UI Test Administrator',
  phone:'01000000000',role:'admin',permissions:{
    products:{view:true,add:true,edit:true},pos:{view:true,add:true,edit:true},
    returns:{view:true,add:true,edit:true}}};
const posProducts=productData.map(p=>({
  id:p.productId,name:p.productName,productName:p.productName,brand:p.brand,category:p.category,
  unit:p.unit,barcode:p.barcode,sellingPrice:p.sellingPrice,stock:p.sellableStock,
  minimumStock:p.minimumStock,trackSerial:Boolean(p.trackSerial),trackExpiry:false,
  trackWarranty:Boolean(p.trackWarranty)
}));
const posMixedProduct={
 id:'PRD-MIXED-E2E',name:'Carton Test Cable',productName:'Carton Test Cable',
 brand:'',category:'Electrical',unit:'Pcs',barcode:'MIXED-E2E-001',
 sellingPrice:10,stock:400,minimumStock:5,trackSerial:false,trackExpiry:false,trackWarranty:false,
 unitProfilePreview:{baseUnit:'Pcs',revision:1,postingEnabled:true,units:[
  {unit:'Carton',symbol:'CT',containsNext:12,factor:240,sellingPrice:2100},
  {unit:'Box',symbol:'BOX',containsNext:20,factor:20,sellingPrice:180},
  {unit:'Pcs',symbol:'PCS',containsNext:null,factor:1,sellingPrice:10}
 ]}
};
const invoice={invoiceId:'UI-E2E-INV-001',date:'2026-10-28',
 customerName:'Test Customer',customerPhone:'01000000001',
 customerFatherName:'',customerAddress:'',subtotal:120,discount:0,
 grandTotal:120,paidAmount:120,dueAmount:0,paymentStatus:'Paid',paymentMethod:'Cash',
 items:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',quantity:1,
   unit:'Pcs',unitPrice:120,lineTotal:120}]};
const results={startedAt:new Date().toISOString(),passed:[],failed:[],warnings:[],screenshots:[],
  accessibility:[],layouts:[],consoleErrors:[],apiCalls:[]};
const safe=(name)=>name.replace(/[^a-z0-9-]/gi,'-').toLowerCase();
async function waitForServer(proc){
  for(let i=0;i<70;i++){
    if(proc.exitCode!==null)throw new Error('Vite preview exited before serving: '+proc.exitCode);
    try{const r=await fetch(base+'/');if(r.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  throw new Error('Timed out starting React preview');
}
async function withCheck(name,fn){
  try{await fn();results.passed.push(name);process.stdout.write('PASS '+name+'\n');}
  catch(error){results.failed.push({name,error:String(error?.stack||error)});
    process.stderr.write('FAIL '+name+': '+String(error?.message||error)+'\n');}
}
function startMocking(context,calls){
  let cashSessionOpen=true;
  let postedPurchase=null;
  let returnedQty=0;
  let supplierDue=100;
  let planned=null;
  let order=null;
  const supplierSettlements=[];
  return context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    calls.push({method:request.method(),path});
    const respond=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});

    if(path==='/api/daybook/bootstrap'&&request.method()==='GET')return respond({
      ok:true,currencySymbol:'৳',editableDays:7,
      modules:['Sales','Purchase','Expense','Bank','Bank Transfer','Finance'],isAdmin:true
    });
    if(path==='/api/daybook'&&request.method()==='GET'){
      const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||50);
      assert.ok(pageSize===50||pageSize===100,'Daybook must use 50/100 paging');
      assert.ok(['createdAt','transactionDate'].includes(url.searchParams.get('sortBy')));
      calls.push({method:'ASSERT',path,page,pageSize,sortBy:url.searchParams.get('sortBy')});
      return respond({ok:true,page,pageSize,totalRows:1,totalPages:1,dateFrom:url.searchParams.get('dateFrom'),
        dateTo:url.searchParams.get('dateTo'),sortBy:url.searchParams.get('sortBy'),isAdmin:true,count:1,
        totals:{cashIn:0,cashOut:0,bankIn:0,bankOut:0,netCash:0,netBank:0},
        rows:[{ts:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Dhaka'}).format(new Date())+'T11:00:00',date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Dhaka'}).format(new Date()),time:'11:00:00',
          referenceNo:'BTR-UI-6E-001',module:'Bank Transfer',transactionType:'Bank Transfer',
          party:'Shop Bank → Wallet',description:'Internal transfer between accounts',
          paymentMethod:'Bank',cashIn:0,cashOut:0,bankIn:0,bankOut:0,amount:0,
          runningCashBalance:null,createdBy:'Test Admin',status:'Active',isDeleted:false,
          isBackdated:false,backdatedDays:0,backdatedReason:'',
          sourceModule:'Bank Transfer',sourceId:'BTR-UI-6E-001',openId:'BTR-UI-6E-001',
          deleteAction:'',deleteId:'BTR-UI-6E-001',canEdit:false}]
      });
    }
    if(path==='/api/expenses/bootstrap'&&request.method()==='GET')return respond({
      ok:true,currencySymbol:'৳',activeCashSession:true,
      categories:[{id:'CAT-UI-6F',name:'Shop Rent',status:'Active'}],
      payees:[],bankAccounts:[{id:'BK-UI-6F',name:'Shop Bank',accountType:'Bank'}],
      paymentMethods:['Cash','Bank','Mobile Banking']
    });
    if(path==='/api/expenses'&&request.method()==='GET')return respond({
      ok:true,expenses:[{expenseId:'EXP-UI-6F-OLD',date:'2026-10-30',
        categoryId:'CAT-UI-6F',category:'Shop Rent',payeeId:'',payeeName:'',
        amount:15,paymentMethod:'Cash',bankAccountId:'',bankAccountName:'',
        description:'Legacy shop rent',referenceNo:'',notes:'',status:'Active',
        createdBy:'Test Cashier',createdAt:'2026-10-30 08:00:00',
        isBackdated:false,backdatedDays:0,backdatedReason:''}]
    });
    if(path==='/api/expenses'&&request.method()==='POST'){
      const data=request.postDataJSON();
      assert.equal(data.categoryId,'CAT-UI-6F');
      assert.equal(data.paymentMethod,'Bank');
      assert.equal(data.bankAccountId,'BK-UI-6F');
      assert.equal(data.amount,35.5);
      assert.ok(typeof data.clientRequestId==='string'&&data.clientRequestId.length>=8);
      calls.push({method:'ASSERT',path,payload:data});
      return respond({ok:true,id:'EXP-UI-6F-POSTED',replayed:false});
    }
    if(path==='/api/expenses/EXP-UI-6F-OLD/cancel'&&request.method()==='POST'){
      const data=request.postDataJSON();
      assert.ok(data.reason.length>=8);
      calls.push({method:'ASSERT',path,payload:data});
      return respond({ok:true,id:'EXP-UI-6F-OLD'});
    }
    // Finance 6A uses real endpoint shapes, never the pinned demo account store.
    if(path==='/api/bank/accounts'&&request.method()==='GET')return respond({
      ok:true,currencySymbol:'৳',bankAccounts:[
        {id:'BK-OK',name:'Shop Bank',accountType:'Bank',currentBalance:125.6234,status:'Active'},
        {id:'BK-DISPUTED',name:'Disputed Bank',accountType:'Mobile Banking',currentBalance:999,status:'Active'}
      ]});
    if(path==='/api/bank/transfers'&&request.method()==='GET')return respond({
      ok:true,transfers:[{transferId:'BTR-UI-6B-001',date:'2026-10-30',
        fromAccountId:'BK-OK',fromAccountName:'Shop Bank',toAccountId:'BK-DISPUTED',
        toAccountName:'Disputed Bank',amount:20,notes:'test posting',clientRequestId:'PREVIOUS-REQUEST-001',
        reversedAt:'',reversalReason:''}]});
    if(path==='/api/bank/transfers'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.ok(typeof payload.clientRequestId==='string'&&payload.clientRequestId.length>8,
        'all transfer posts must carry an idempotency key');
      assert.equal(payload.fromAccountId,'BK-OK');
      assert.equal(payload.toAccountId,'BK-DISPUTED');
      assert.equal(payload.amount,12.5);
      calls.push({method:'ASSERT',path,payload});
      return respond({ok:true,id:'BTR-UI-6B-POSTED',replayed:false});
    }
    if(path==='/api/bank/transfers/BTR-UI-6B-001/reverse'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.ok(payload.reason.length>=8);
      calls.push({method:'ASSERT',path,payload});
      return respond({ok:true,id:'BTR-UI-6B-001',reversed:true});
    }
    if(path==='/api/pos/cash-session/summary'&&request.method()==='GET')
      return respond({ok:true,summary:cashSessionOpen?{
        sessionId:'CS-UI-6C-001',openedAt:'2026-10-30 08:00:00',openingCash:100,
        cashIn:200,cashOut:50,expectedCash:250
      }:null});
    if(path==='/api/pos/cash-session/close'&&request.method()==='POST'){
      const body=request.postDataJSON();
      assert.equal(body.countedCash,255);
      assert.ok(body.notes.length>=8);
      assert.ok(typeof body.clientRequestId==='string'&&body.clientRequestId.length>=8);
      calls.push({method:'ASSERT',path,payload:body});
      cashSessionOpen=false;
      return respond({ok:true,sessionId:'CS-UI-6C-001',expected:250,counted:255,variance:5,replayed:false});
    }
    if(path==='/api/pos/cash-session/start'&&request.method()==='POST'){
      const body=request.postDataJSON();
      assert.ok(typeof body.clientRequestId==='string'&&body.clientRequestId.length>=8);
      cashSessionOpen=true;
      calls.push({method:'ASSERT',path,payload:body});
      return respond({ok:true,sessionId:'CS-UI-6C-002',replayed:false});
    }
    if(path==='/api/bank/reconciliation'&&request.method()==='GET')return respond({
      ok:true,asOf:'2026-10-30T09:00:00.000Z',coverage:{status:'needs-review',reason:'One account differs from bank book.'},
      accounts:[
        {id:'BK-OK',name:'Shop Bank',accountType:'Bank',openingBalance:100,
          recordedBalance:125.6234,bookBalance:125.6234,status:'ready',reason:'Bank-book movements agree.'},
        {id:'BK-DISPUTED',name:'Disputed Bank',accountType:'Mobile Banking',openingBalance:0,
          recordedBalance:999,bookBalance:null,status:'needs-review',reason:'Bank-book mismatch.'}
      ]});
    if(path==='/api/finance/persons/PERSON-1/ledger'&&request.method()==='GET')return respond({
      ok:true,person:{id:'PERSON-1',name:'Finance Test Owner',type:'Owner',status:'Active'},
      balance:120,openingBalance:0,closingBalance:120,page:Number(url.searchParams.get('page')||1),
      pageSize:Number(url.searchParams.get('pageSize')||50),
      totalRows:1,totalPages:1,dateFrom:url.searchParams.get('dateFrom')||'',dateTo:url.searchParams.get('dateTo')||'',
      coverage:{status:'ready',reason:'Every finance entry has one matching source.'},
      rows:[{financeId:'FIN-UI-6D-001',personId:'PERSON-1',date:'2026-10-29',
        transactionType:'Owner Investment',paymentMethod:'Cash',amount:120,debit:0,credit:120,
        balance:120,sourceStatus:'matched',referenceNo:'',notes:'',
        createdBy:'Test Finance',createdAt:'2026-10-29 12:00:00',isBackdated:false,backdatedReason:''}]
    });
    if(path==='/api/finance/transactions'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.equal(payload.personId,'PERSON-1');
      assert.equal(payload.transactionType,'Owner Investment');
      assert.equal(payload.paymentMethod,'Cash');
      assert.equal(payload.amount,12.5);
      assert.ok(typeof payload.clientRequestId==='string'&&payload.clientRequestId.length>=8);
      calls.push({method:'ASSERT',path,payload});
      return respond({ok:true,id:'FIN-UI-6D-POSTED',replayed:false});
    }
    if(path==='/api/finance/bootstrap'&&request.method()==='GET')return respond({
      ok:true,personsAll:[{id:'PERSON-1',name:'Finance Test Owner',type:'Owner',status:'Active',phone:''}],
      currencySymbol:'৳',activeCashSession:true
    });
    if(path==='/api/reports/v2/catalog'&&request.method()==='GET')return respond({ok:true,
      mainTabs:[{id:'overview',en:'Dashboard',bn:'ড্যাশবোর্ড'},{id:'library',en:'Report Library',bn:'রিপোর্ট লাইব্রেরি'}],
      reports:[{id:'sales',en:'Sales register',bn:'বিক্রির হিসাব',group:'sales',status:'needs-review',reason:'Unreconciled invoice sources.'}]});
    if(path==='/api/reports/v2/summary'&&request.method()==='GET')return respond({
      ok:true,range:{from:'2026-10-01',to:'2026-10-30'},metrics:[
        ...[['inventoryValue',5000],['receivablesBalance',4000],['payablesBalance',7000]].map(
          ([key,valueMinor])=>({key,valueMinor,status:'needs-review',
            reason:'Current snapshot only; no historical due ageing.',asOf:'2026-10-30',sources:[]}))
      ],coverage:{status:'unavailable',reason:'Verified dashboard totals are pending.'}});
    if(path==='/api/reports/v2/rows'&&request.method()==='GET'){
      const kind=url.searchParams.get('report')||'sales';
      if(kind==='product-profit'||kind==='profit-loss'){
        const reason=kind==='product-profit'
          ?'Product-level FIFO allocations, line discounts and return costs are not yet reconciled.'
          :'Full ledger balances and posted adjustments are required for a Profit & Loss statement.';
        return respond({ok:true,report:kind,range:{from:'2026-10-01',to:'2026-10-30'},
          page:1,pageSize:50,totalRows:0,rows:[],metrics:[],
          coverage:{status:'unavailable',reason}});
      }
      if(kind==='sales'&&url.searchParams.get('search')==='CI-PAGE'){
        const page=Number(url.searchParams.get('page')||1);
        const pageSize=Number(url.searchParams.get('pageSize')||50);
        const all=Array.from({length:105},(_,i)=>({
          sourceId:'INV-CI-'+String(i+1).padStart(4,'0'),sourceModule:'sales',
          date:'2026-10-15',label:'CI-PAGE buyer',amountMinor:12000,
          status:'needs-review',reason:'Posted invoice source.'
        }));
        return respond({ok:true,report:'sales',range:{from:'2026-10-01',to:'2026-10-30'},
          page,pageSize,totalRows:all.length,rows:all.slice((page-1)*pageSize,page*pageSize),
          metrics:[],coverage:{status:'needs-review',reason:'Posted invoice sources.'}});
      }
      const fixtures={
        sales:{sourceId:'INV-LIVE-REPORT-001',sourceModule:'sales',date:'2026-10-15',
          label:'Real API Mock Buyer',amountMinor:12000,status:'needs-review',reason:'Recorded invoice amount.'},
        stock:{sourceId:'STK-LIVE-001',sourceModule:'products',date:'2026-10-30',
          label:'Verified Cable Roll',amountMinor:5000,status:'needs-review',reason:'Current FIFO snapshot only.'},
        receivables:{sourceId:'CUS-LIVE-001',sourceModule:'customers',date:'2026-10-30',
          label:'Current Buyer Due',amountMinor:4000,status:'needs-review',reason:'Current dues, ageing unavailable.'},
        payables:{sourceId:'SUP-LIVE-001',sourceModule:'suppliers',date:'2026-10-30',
          label:'Current Supplier Due',amountMinor:null,status:'incomplete',reason:'Supplier ledger mismatch.'},
        cash:{sourceId:'CB-CAP-LIVE',sourceModule:'cash_book',date:'2026-10-17',
          label:'Owner Investment · Capital funding',amountMinor:30000,status:'needs-review',
          reason:'Financing is not sale revenue.'},
        bank:{sourceId:'BB-OUT-LIVE',sourceModule:'bank_book',date:'2026-10-17',
          label:'Transfer Out · Internal',amountMinor:-10000,status:'needs-review',
          reason:'Internal bank transfer not income.'},
        expenses:{sourceId:'EXP-LIVE-001',sourceModule:'expenses',date:'2026-10-17',
          label:'Utilities',amountMinor:5000,status:'needs-review',
          reason:'Recorded operating expense matched to cash book.'},
        finance:{sourceId:'FIN-LIVE-001',sourceModule:'finance_transactions',date:'2026-10-17',
          label:'Owner Investment · Owner',amountMinor:30000,status:'needs-review',
          reason:'Capital is not sales or profit.'}
      };
      const record=fixtures[kind]||null;
      const amounts=kind==='cash'?{cashReceipts:50000,cashPayments:5000,
        externalNetMovement:45000,bankCurrentBalance:35000}:
        kind==='bank'?{bankReceipts:10000,bankPayments:10000,bankCurrentBalance:35000}:
        kind==='expenses'?{operatingExpenses:5000}:
        kind==='finance'?{ownerCapitalIn:30000}:{};
      const metrics=Object.entries(amounts).map(([key,valueMinor])=>({
        key,valueMinor,status:'needs-review',reason:'Source-backed test fixture',
        asOf:'2026-10-30',sources:[]}));
      return respond({ok:true,report:kind,range:{from:'2026-10-01',to:'2026-10-30'},page:1,pageSize:50,
        totalRows:record?1:0,metrics,rows:record?[record]:[],coverage:{
          status:record?.status||'unavailable',reason:record?.reason||'Report unavailable.'}});
    }
    if(path==='/api/auth/me'&&request.method()==='GET')return respond({ok:true,user});
    if(path.startsWith('/api/purchases/unit-profile/')&&request.method()==='GET'){
      const productId=decodeURIComponent(path.slice('/api/purchases/unit-profile/'.length));
      if(productId==='PRD-000002')return respond({ok:true,productId,revision:1,postingEnabled:true,
        profile:{baseUnit:'Pcs',units:[
          {unit:'Carton',symbol:'CT',containsNext:12,factor:240,sellingPrice:2400},
          {unit:'Box',symbol:'BX',containsNext:20,factor:20,sellingPrice:200},
          {unit:'Pcs',symbol:'PCS',containsNext:null,factor:1,sellingPrice:20}
        ]}});
      return respond({ok:true,productId,revision:0,postingEnabled:true,profile:null});
    }
    if(path==='/api/purchases/supplier-settlements/supplier/SUP-UI-001'&&request.method()==='GET'){
      return respond({ok:true,supplier:{id:'SUP-UI-001',name:'Khan Hardware',
        currentDue:supplierDue},ledgerDue:supplierDue,needsReconciliation:false,
        activeSession:true,bankAccounts:[{id:'BANK-UI-1',name:'Bank test account',
         type:'Bank',currentBalance:500}],settlements:supplierSettlements});
    }
    if(path==='/api/purchases/supplier-settlements'&&request.method()==='POST'){
      const x=request.postDataJSON();
      assert.equal(x.supplierId,'SUP-UI-001');
      assert.ok(/^[0-9a-f-]{32,36}$/i.test(x.clientRequestId));
      assert.equal(x.method,'Cash');assert.equal(x.amount,40);
      assert.ok(x.amount<=supplierDue);
      supplierDue-=x.amount;
      const settlementId='SST-UI-001',ledgerId='LEDGER-UI-001';
      supplierSettlements.push({settlementId,requestId:x.clientRequestId,
       ledgerId,amount:x.amount,method:x.method,bankAccountId:'',date:'2026-10-30',
       status:'Posted',reversalLedgerId:'',createdAt:'2026-10-30'});
      calls.push({method:'ASSERT',path,body:x});
      return respond({ok:true,settlementId,ledgerId,amount:x.amount,newDue:supplierDue});
    }
    if(path==='/api/purchases/supplier-settlements/SST-UI-001/reverse'&&request.method()==='POST'){
      const x=request.postDataJSON();assert.ok(x.reason.length>=4);
      assert.equal(supplierSettlements.length,1);
      assert.equal(supplierSettlements[0].status,'Posted');
      supplierSettlements[0].status='Reversed';
      supplierSettlements[0].reversalLedgerId='REV-UI-001';
      supplierDue+=supplierSettlements[0].amount;
      calls.push({method:'ASSERT',path,body:x});
      return respond({ok:true,settlementId:'SST-UI-001',reversalLedgerId:'REV-UI-001',newDue:supplierDue});
    }
    if(path==='/api/purchases/planner/analyze'&&request.method()==='GET')
      return respond({ok:true,rows:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',
       currentStock:2,suggestedQty:4,plannedQty:4,included:true,supplierId:'',
       lastPurchaseCost:80}],suppliers:[{id:'SUP-UI-001',name:'Khan Hardware'}]});
    if(path==='/api/purchases/planner/plans'&&request.method()==='GET')
      return respond({ok:true,plans:planned?[planned]:[]});
    if(path==='/api/purchases/planner/plans'&&request.method()==='POST'){
      const data=request.postDataJSON();assert.equal(data.items.length,1);
      assert.deepEqual(data.items[0],{productId:'PRD-000001',supplierId:'SUP-UI-001',
       plannedQty:4,included:true});
      planned={planId:'PPL-UI-001',planNo:'PPL-UI-001',status:'Draft',itemCount:1,
       totalInvestment:320};calls.push({method:'ASSERT',path,body:data});
      return respond({ok:true,planId:planned.planId});
    }
    if(path==='/api/purchases/planner/plans/PPL-UI-001/approve'&&request.method()==='POST'){
      assert.equal(planned?.status,'Draft');planned.status='Approved';
      order={orderId:'SPO-UI-001',orderNo:'SPO-UI-001',status:'Open',
       supplierId:'SUP-UI-001',supplierName:'Khan Hardware',totalQty:4,convertedPurchaseId:''};
      calls.push({method:'ASSERT',path});return respond({ok:true,planId:planned.planId,
       orders:[{...order}]});
    }
    if(path==='/api/purchases/planner/orders'&&request.method()==='GET')
      return respond({ok:true,orders:order?[order]:[]});
    if(path==='/api/purchases/planner/orders/SPO-UI-001/convert-data'&&request.method()==='GET'){
      assert.equal(order.status,'Open');return respond({ok:true,purchase:{
       purchasePlanOrderId:'SPO-UI-001',orderNo:'SPO-UI-001',
       supplierId:'SUP-UI-001',supplierName:'Khan Hardware',
       items:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',quantity:4,unitPrice:80}] }});
    }
    if(path==='/api/purchases/supplier-search'&&request.method()==='GET'){
      const q=(url.searchParams.get('q')||'').toLowerCase();
      const supplier={id:'SUP-UI-001',name:'Khan Hardware',phone:'01700000001',
        currentDue:100,ledgerDue:100,needsReconciliation:false};
      return respond({ok:true,suppliers:['','khan','sup-ui-001','01700000001']
        .some(term=>term===q)||(q&&[supplier.name.toLowerCase(),supplier.phone,supplier.id.toLowerCase()].some(x=>x.includes(q)))
          ?[supplier]:[]});
    }
    if(path==='/api/purchases/PUR-UI-MIXED/return-data'&&request.method()==='GET'){
      const profile={baseUnit:'Pcs',units:[
       {unit:'Carton',symbol:'CT',containsNext:12,factor:240,sellingPrice:2400},
       {unit:'Box',symbol:'BX',containsNext:20,factor:20,sellingPrice:200},
       {unit:'Pcs',symbol:'PCS',containsNext:null,factor:1,sellingPrice:20}
      ]};
      return respond({ok:true,purchase:{
        purchaseId:'PUR-UI-MIXED',supplierId:'SUP-UI-001',supplierName:'Khan Hardware',
        grandTotal:2830,paidAmount:0,previouslyReturnedAmount:returnedQty*10,netPurchase:2830-returnedQty*10,
        items:[{productId:'PRD-000002',productName:'PVC Pipe 20mm',
          boughtQty:283,unitPrice:10,previouslyReturnedQty:returnedQty,
          availableQty:283-returnedQty,unitDescription:'1 CT 2 BX 3 PCS',
          returnSupported:true,unsupportedReason:'',originalLineTotal:2830,
          unitSnapshot:{revision:1,profile,quantities:{Carton:1,Box:2,Pcs:3},
            priceUnit:'Carton',enteredUnitPrice:2400,
            description:'1 CT 2 BX 3 PCS',sourceLotId:'LOT-UI-001'}}]
      }});
    }
    if(path==='/api/purchase-returns'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.equal(payload.purchaseId,'PUR-UI-MIXED');
      assert.equal(payload.refundMethod,'Supplier Credit');
      assert.ok(/^[0-9a-f-]{32,36}$/i.test(payload.clientRequestId));
      assert.equal(payload.items.length,1);
      assert.deepEqual(payload.items[0].unitQuantities,{Box:1,Pcs:2});
      returnedQty+=22;
      calls.push({method:'ASSERT',path:'/api/purchase-returns',payload});
      return respond({ok:true,returnId:'PRTN-UI-0001',totalReturnAmount:220});
    }
    if(path==='/api/purchases'&&request.method()==='GET')
      return respond({ok:true,purchases:postedPurchase?[postedPurchase]:[]});
    if(path==='/api/purchases'&&request.method()==='POST'){
      const data=request.postDataJSON();
      assert.equal(data.supplierId,'SUP-UI-001');
      assert.equal(data.paidAmount,0);
      assert.equal(data.items.length,1);
      if(data.items[0].unitQuantities){
        assert.equal(data.items[0].productId,'PRD-000002');
        assert.equal(data.items[0].unitProfileRevision,1);
        assert.deepEqual(data.items[0].unitQuantities,{Carton:1,Box:2,Pcs:3});
        assert.equal(data.items[0].priceUnit,'Carton');
        assert.equal(data.items[0].unitPrice,2400);
      }else{
        assert.equal(data.items[0].productId,'PRD-000001');
        assert.equal(data.items[0].qty,data.purchasePlanOrderId?4:3);
        assert.equal(data.items[0].unitPrice,80);
      }
      calls.push({method:'ASSERT',path:'/api/purchases',payload:data});
      if(data.purchasePlanOrderId){
        assert.equal(data.purchasePlanOrderId,'SPO-UI-001');
        assert.equal(order?.status,'Open');order.status='Converted';
        order.convertedPurchaseId='PUR-UI-ORDER';planned.status='Converted';
        calls.push({method:'ASSERT',path:'/api/purchases/order-conversion',payload:data});
      }
      const amount=data.purchasePlanOrderId?320:data.items[0].unitQuantities?2830:240;
      postedPurchase={purchaseId:data.purchasePlanOrderId?'PUR-UI-ORDER':data.items[0].unitQuantities?'PUR-UI-MIXED':'PUR-UI-0001',
        purchaseDate:'2026-10-30',supplierId:data.supplierId,supplierName:'Khan Hardware',
        grandTotal:amount,paidAmount:0,dueAmount:amount,paymentStatus:'Due',items:[]};
      return respond({ok:true,purchaseId:postedPurchase.purchaseId,grandTotal:amount,dueAmount:amount});
    }
    if(path==='/api/bootstrap'&&request.method()==='GET')return respond({ok:true,products:productData,
      categories:[{id:'CAT-ELEC',name:'Electrical'},{id:'CAT-HARD',name:'Hardware'}],
      brands:[{id:'BRAND-DEMO',name:'Demo Brand'}],units:[{id:'UNIT-PCS',name:'Pcs'}]});
    if(path==='/api/pos/bootstrap'&&request.method()==='GET')return respond({
      ok:true,products:[...posProducts,posMixedProduct],customers:[],bankAccounts:[],
      vendors:[{id:'VEN-UI-1',name:'UI Test Vendor',phone:'01000000111',currentDue:0,status:'Active'}],
      activeSession:{sessionId:'UI-E2E-SESSION',openedAt:'2026-10-28 09:00:00',openingCash:500},
      invoiceDesign:{settings:{'Shop Name':'UI Fixture Shop','Shop Name Bangla':'টেস্ট দোকান',
        'Address':'Fixture address, Rajshahi','Phone 1':'01000000000',
        'Invoice Footer':'Test receipt only'},logoDataUri:''}
    });
    if(path==='/api/pos/sales'&&request.method()==='POST'){
      const posted=request.postDataJSON();
      assert.ok(['PRD-000001','PRD-000002','PRD-000003','PRD-MIXED-E2E'].includes(posted.items[0]?.productId));
      if(posted.items[0]?.productId==='PRD-000003')
        assert.deepEqual(posted.items[0].serialNumbers,['SN-UI-001']);
      calls.push({method:'ASSERT',path:'/api/pos/sales',payload:posted});
      return respond({ok:true,invoice});
    }
    if(path==='/api/pos/invoices/INV-LIVE-REPORT-001'&&request.method()==='GET')
      return respond({ok:true,invoice:{invoiceId:'INV-LIVE-REPORT-001',date:'2026-10-15',
        customerName:'Real API Mock Buyer',customerPhone:'01000000199',subtotal:120,
        discount:0,grandTotal:120,paidAmount:120,dueAmount:0,paymentMethod:'Cash',paymentStatus:'Paid',
        items:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',
          quantity:1,unit:'Pcs',unitPrice:120,lineTotal:120}]}});
    if(path==='/api/pos/invoices/UI-E2E-INV-001'&&request.method()==='GET')
      return respond({ok:true,invoice});
    if(path.startsWith('/api/pos/products/')&&path.endsWith('/tracking-options')&&request.method()==='GET')
      return respond({ok:true,serials:[{serialNumber:'SN-UI-001'}]});
    if(path==='/api/pos/vendors'&&request.method()==='POST')
      return respond({ok:true,vendor:{id:'VEN-UI-2',name:request.postDataJSON().name,
        phone:request.postDataJSON().phone,currentDue:0,status:'Active'}});
    if(path==='/api/sales-returns/search'&&url.searchParams.get('q')?.includes('DUE-REV'))
      return respond({ok:true,matches:[{invoiceId:'UI-E2E-DUE-REV',date:'2026-10-29',
        customerName:'Due Cancellation Buyer',customerPhone:'01000000688',grandTotal:2490,
        paymentStatus:'Due',returnStatus:'No Return'}]});
    if(path==='/api/sales-management/UI-E2E-DUE-REV/reverse'&&request.method()==='GET')
      return respond({ok:true,preview:{eligible:true,reason:'',invoiceId:'UI-E2E-DUE-REV',
        refundMethod:'Due Adjustment',refundBankAccountId:'',refundAccountName:'',
        refundAmount:2490,customerDueBefore:2490,previouslyRefundedAmount:0,remainingBaseQuantity:283,
        items:[{productId:'PRD-MIXED-E2E',qty:283,unitPrice:0,
          unitQuantities:{Carton:1,Box:2,Pcs:3}}]}});
    if(path==='/api/sales-management/UI-E2E-DUE-REV/reverse'&&request.method()==='POST'){
      const payload=request.postDataJSON();assert.ok(payload.reason.length>=8);
      calls.push({method:'ASSERT',path,payload});
      return respond({ok:true,returnId:'SRT-UI-DUE-REV-1',totalReturnAmount:2490});
    }
    if(path==='/api/sales-returns/UI-E2E-DUE-REV/data'&&request.method()==='GET')
      return respond({ok:true,sale:{invoiceId:'UI-E2E-DUE-REV',date:'2026-10-29',
        customerId:'CUS-DUE',customerName:'Due Cancellation Buyer',customerPhone:'01000000688',
        grandTotal:2490,paidAmount:0,dueAmount:2490,previouslyReturnedAmount:0,netSale:2490,
        items:[{productId:'PRD-MIXED-E2E',name:'Carton Test Cable',soldQty:283,vendorQty:0,
          previouslyReturnedQty:0,availableQty:283,unitPrice:2490/283,
          trackSerial:false,trackExpiry:false,trackWarranty:false,availableSerials:[],
          mixedUnit:{description:'1 CT 2 BOX 3 PCS',netPriceFactor:1,
            originalQuantities:{Carton:1,Box:2,Pcs:3},availableQuantities:{Carton:1,Box:2,Pcs:3},
            profile:posMixedProduct.unitProfilePreview}}]}} );
    if(path==='/api/sales-returns/search'&&url.searchParams.get('q')?.includes('BANK-REV'))
      return respond({ok:true,matches:[{invoiceId:'UI-E2E-BANK-REV',date:'2026-10-29',
        customerName:'Bank Refund Buyer',customerPhone:'01000000014',grandTotal:2490,
        paymentStatus:'Paid',returnStatus:'No Return'}]});
    if(path==='/api/sales-management/UI-E2E-BANK-REV/reverse'&&request.method()==='GET')
      return respond({ok:true,preview:{eligible:true,reason:'',invoiceId:'UI-E2E-BANK-REV',
        refundMethod:'Bank',refundBankAccountId:'BNK-UI-01',refundAccountName:'Current Bank · Test',
        refundAmount:2490,previouslyRefundedAmount:0,remainingBaseQuantity:283,
        items:[{productId:'PRD-MIXED-E2E',qty:283,unitPrice:0,
          unitQuantities:{Carton:1,Box:2,Pcs:3}}]}});
    if(path==='/api/sales-management/UI-E2E-BANK-REV/reverse'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.ok(payload.reason.length>=8);
      calls.push({method:'ASSERT',path,payload});
      return respond({ok:true,returnId:'SRT-UI-BANK-REV-1',totalReturnAmount:2490});
    }
    if(path==='/api/sales-returns/UI-E2E-BANK-REV/data'&&request.method()==='GET')
      return respond({ok:true,sale:{invoiceId:'UI-E2E-BANK-REV',date:'2026-10-29',
        customerId:'CUS-BANK',customerName:'Bank Refund Buyer',customerPhone:'01000000014',
        grandTotal:2490,paidAmount:2490,dueAmount:0,previouslyReturnedAmount:0,netSale:2490,
        items:[{productId:'PRD-MIXED-E2E',name:'Carton Test Cable',soldQty:283,vendorQty:0,
          previouslyReturnedQty:0,availableQty:283,unitPrice:2490/283,
          trackSerial:false,trackExpiry:false,trackWarranty:false,availableSerials:[],
          mixedUnit:{description:'1 CT 2 BOX 3 PCS',netPriceFactor:1,
            originalQuantities:{Carton:1,Box:2,Pcs:3},availableQuantities:{Carton:1,Box:2,Pcs:3},
            profile:posMixedProduct.unitProfilePreview}}]}} );
    if(path==='/api/sales-returns/search'&&url.searchParams.get('q')?.includes('MIXED'))
      return respond({ok:true,matches:[{invoiceId:'UI-E2E-MIXED',date:'2026-10-28',
        customerName:'Unit Return Buyer',customerPhone:'01000000011',grandTotal:2490,
        paymentStatus:'Paid',returnStatus:'No Return'}]});
    if(path==='/api/sales-management/UI-E2E-MIXED/reverse'&&request.method()==='GET')
      return respond({ok:true,preview:{eligible:true,reason:'',invoiceId:'UI-E2E-MIXED',
        refundMethod:'Cash',refundBankAccountId:'',refundAccountName:'',
        refundAmount:2300,previouslyRefundedAmount:190,remainingBaseQuantity:262,
        items:[{productId:'PRD-MIXED-E2E',qty:262,unitPrice:0,
          unitQuantities:{Carton:1,Box:1,Pcs:2}}]}});
    if(path==='/api/sales-management/UI-E2E-MIXED/reverse'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.ok(payload.reason.length>=8);
      calls.push({method:'ASSERT',path,payload});
      return respond({ok:true,returnId:'SRT-UI-REVERSE-0001',totalReturnAmount:2300});
    }
    if(path==='/api/sales-returns/UI-E2E-MIXED/data'&&request.method()==='GET')
      return respond({ok:true,sale:{invoiceId:'UI-E2E-MIXED',date:'2026-10-28',
        customerId:'CUS-MIXED',customerName:'Unit Return Buyer',customerPhone:'01000000011',
        grandTotal:2490,paidAmount:2490,dueAmount:0,previouslyReturnedAmount:0,netSale:2490,
        items:[{productId:'PRD-MIXED-E2E',name:'Carton Test Cable',soldQty:283,vendorQty:0,
          previouslyReturnedQty:0,availableQty:283,unitPrice:2490/283,
          trackSerial:false,trackExpiry:false,trackWarranty:false,availableSerials:[],
          mixedUnit:{description:'1 CT 2 BOX 3 PCS',netPriceFactor:1,
            originalQuantities:{Carton:1,Box:2,Pcs:3},availableQuantities:{Carton:1,Box:2,Pcs:3},
            profile:posMixedProduct.unitProfilePreview}}]}} );
    if(path==='/api/sales-returns/search'&&request.method()==='GET')
      return respond({ok:true,matches:[{invoiceId:'UI-E2E-RET-INVOICE',date:'2026-10-28',
        customerName:'UI Return Buyer',customerPhone:'01000000001',grandTotal:700,
        paymentStatus:'Paid',returnStatus:'No Return'}]});
    if(path==='/api/sales-returns/UI-E2E-RET-INVOICE/data'&&request.method()==='GET')
      return respond({ok:true,sale:{invoiceId:'UI-E2E-RET-INVOICE',date:'2026-10-28',
        customerId:'CUS-UI',customerName:'UI Return Buyer',customerPhone:'01000000001',
        grandTotal:700,paidAmount:700,dueAmount:0,previouslyReturnedAmount:0,
        netSale:700,items:[{productId:'PRD-000003',name:'Serial Tracked Motor',
          soldQty:1,vendorQty:0,previouslyReturnedQty:0,availableQty:1,unitPrice:700,
          trackSerial:true,trackExpiry:false,trackWarranty:true,availableSerials:['SN-UI-001']}]}} );
    if(path==='/api/sales-returns'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      if(payload.invoiceId==='UI-E2E-MIXED'){
        assert.equal(payload.items[0].qty,21);
        assert.deepEqual(payload.items[0].unitQuantities,{Box:1,Pcs:1});
        calls.push({method:'ASSERT',path:'/api/sales-returns',payload});
        return respond({ok:true,returnId:'SRT-UI-MIXED-001',totalReturnAmount:190});
      }
      assert.equal(payload.invoiceId,'UI-E2E-RET-INVOICE');
      assert.deepEqual(payload.items[0].serialNumbers,['SN-UI-001']);
      calls.push({method:'ASSERT',path:'/api/sales-returns',payload});
      return respond({ok:true,returnId:'SRT-UI-E2E-001',totalReturnAmount:700});
    }
    if(path==='/api/sales-returns'&&request.method()==='GET')
      return respond({ok:true,returns:[]});
    if(path==='/api/pos/sales-by-phone'&&request.method()==='GET')
      return respond({ok:true,sales:[]});
    // Unknown requests intentionally fail closed; never reach a live backend.
    results.warnings.push('Blocked unexpected API call: '+request.method()+' '+path);
    return route.fulfill({status:404,contentType:'application/json',body:'{"ok":false,"error":"Unmocked UI-check API request"}'});
  });
}
async function screenshot(page,label){
  const file=safe(label)+'.png';
  await page.screenshot({path:join(out,file),fullPage:true,animations:'disabled'});
  results.screenshots.push(file);
}
async function audit(page,label){
  const axePath=join(web,'node_modules/axe-core/axe.min.js');
  if(!existsSync(axePath))throw new Error('axe-core dependency missing from source');
  await page.addScriptTag({content:readFileSync(axePath,'utf8')});
  const report=await page.evaluate(async()=>{
    const r=await window.axe.run(document.querySelector('[data-live-products], [data-live-pos], [data-live-reports], [data-live-finance], [data-live-daybook], [data-live-expenses], [data-live-purchases], [data-live-purchase-editor]')||document.body,
      {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
    return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,
      nodes:v.nodes.slice(0,5).map(n=>({target:n.target,summary:n.failureSummary}))})),
      passes:r.passes.length,incomplete:r.incomplete.length};
  });
  results.accessibility.push({label,...report});
  // New screens should have no critical errors. Other detected issues are captured
  // as structured artifact findings instead of silently hidden or modifying the design.
  const serious=report.violations.filter(x=>['critical','serious'].includes(x.impact));
  assert.equal(serious.length,0,label+' contains critical/serious accessibility violations: '+JSON.stringify(serious));
}
async function inspectLayout(page,label){
  const info=await page.evaluate(()=>{
    const root=document.querySelector('[data-live-products], [data-live-pos], [data-live-reports], [data-live-finance], [data-live-daybook], [data-live-expenses], [data-live-purchases], [data-live-purchase-editor]');
    const rect=root?.getBoundingClientRect();
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
      workspaceWidth:rect?.width||0,workspaceLeft:rect?.left||0,
      productRows:document.querySelectorAll('[data-live-products] tbody tr').length,
      screen:location.hash};
  });
  results.layouts.push({label,...info});
  assert.ok(info.workspaceWidth>150,label+' workspace should render');
  // The cart and table may scroll internally; the whole document must fit.
  if(info.documentWidth>info.viewport+3)
    results.warnings.push(label+': document overflows by '+(info.documentWidth-info.viewport)+'px');
}
const server=spawn(process.execPath,[join(web,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','4173','--strictPort'],
 {cwd:web,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_COLOR:'1'}});
let serverLogs='';
for(const stream of [server.stdout,server.stderr])stream.on('data',c=>serverLogs+=String(c).slice(-2000));
let browser;
try{
  await waitForServer(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  await withCheck('unauthenticated route stays behind real sign-in',async()=>{
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/products');
    await page.getByText('Sign in · BanijjIQ').waitFor({timeout:10000});
    assert.equal(await page.locator('[data-live-products]').count(),0);
    await screenshot(page,'auth-390');
    await ctx.close();
  });

  for(const width of [390,768,1440]){
    await withCheck('Phase 6A Finance shows only reconciled bank values '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/finance-backend-check');
      const finance=page.locator('[data-live-finance]');await finance.waitFor({timeout:10000});
      const personSelector=page.getByRole('combobox',{name:'Finance person'});
      await personSelector.waitFor({timeout:10000});
      assert.equal(await personSelector.locator('option[value="PERSON-1"]').count(),1);
      assert.ok((await finance.innerText()).includes('Shop Bank'));
      assert.ok((await finance.innerText()).includes('125.6234'));
      assert.ok((await finance.innerText()).includes('Disputed Bank'));
      assert.ok(!(await finance.innerText()).includes('999.00'),'disputed recorded balance must never show');
      assert.ok(calls.some(c=>c.method==='GET'&&c.path==='/api/bank/reconciliation'));
      assert.ok(calls.some(c=>c.method==='GET'&&c.path==='/api/finance/bootstrap'));
      assert.ok(!calls.some(c=>c.method!=='GET'&&c.path.includes('/api/bank/')));
      await screenshot(page,'phase6a-finance-'+width);
      await inspectLayout(page,'phase6a-finance-'+width);
      await audit(page,'phase6a-finance-'+width);
      await ctx.close();
    });
  }

  for(const width of [390,768,1440]){
    await withCheck('Phase 6B bank transfer review and paired reversal '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/finance-backend-check');
      await page.locator('[data-phase6-bank-transfers]').waitFor({timeout:12000});
      await page.getByRole('combobox',{name:'Transfer from account'}).selectOption('BK-OK');
      await page.getByRole('combobox',{name:'Transfer to account'}).selectOption('BK-DISPUTED');
      await page.getByRole('spinbutton',{name:'Transfer amount'}).fill('12.5');
      await page.getByRole('textbox',{name:'Transfer note'}).fill('operating float');
      await page.getByRole('button',{name:'Review transfer'}).click();
      await page.getByRole('button',{name:'Confirm transfer'}).click();
      await page.getByText(/BTR-UI-6B-POSTED/).waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/bank/transfers').length,1,
        'transfer is posted exactly once');
      await page.getByRole('button',{name:'Reverse',exact:true}).first().click();
      await page.getByRole('textbox',{name:'Transfer reversal reason'}).fill('Customer funds correction');
      await page.getByRole('button',{name:'Confirm reversal'}).click();
      await page.getByText(/two ledger entries/).waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path.includes('/reverse')).length,1);
      await screenshot(page,'phase6b-bank-transfer-'+width);
      await inspectLayout(page,'phase6b-bank-transfer-'+width);
      await audit(page,'phase6b-bank-transfer-'+width);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }

  for(const width of [390,768,1440]){
    await withCheck('Phase 6C cash count and variance review '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/finance-backend-check');
      const panel=page.locator('[data-phase6-cash-session]');
      await panel.waitFor({timeout:12000});
      await page.getByText('Expected cash').waitFor({timeout:12000});
      assert.ok((await panel.innerText()).includes('250'));
      await page.getByRole('spinbutton',{name:'Counted cash'}).fill('255');
      await page.getByRole('textbox',{name:'Cash variance reason'}).fill('Cash difference checked by manager');
      await page.getByRole('button',{name:'Review close'}).click();
      await page.getByRole('button',{name:'Confirm close'}).click();
      await page.getByText(/Cash session closed/).waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/pos/cash-session/close').length,1);
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path==='/api/pos/cash-session/close').length,1);
      await screenshot(page,'phase6c-cash-count-'+width);
      await inspectLayout(page,'phase6c-cash-count-'+width);
      await audit(page,'phase6c-cash-count-'+width);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }

  for(const width of [390,768,1440]){
    await withCheck('Phase 6D finance source-backed person ledger and investment '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/finance-backend-check');
      const panel=page.locator('[data-finance-person-ledger]');
      await panel.waitFor({timeout:12000});
      await panel.getByText('FIN-UI-6D-001').waitFor({timeout:12000});
      assert.ok(calls.some(x=>x.method==='GET'&&x.path==='/api/finance/persons/PERSON-1/ledger'),
        'person rows must come from protected finance ledger endpoint');
      await panel.getByRole('combobox',{name:'Finance ledger page size'}).selectOption('100');
      await panel.getByRole('combobox',{name:'Finance transaction type'}).selectOption('Owner Investment');
      await panel.getByRole('spinbutton',{name:'Finance transaction amount'}).fill('12.5');
      await panel.getByRole('button',{name:'Review entry'}).click();
      await panel.getByRole('button',{name:'Confirm entry'}).click();
      await panel.getByText(/FIN-UI-6D-POSTED/).waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/finance/transactions').length,1);
      await screenshot(page,'phase6d-person-ledger-'+width);
      await inspectLayout(page,'phase6d-person-ledger-'+width);
      await audit(page,'phase6d-person-ledger-'+width);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }

  // User-facing Finance is source-authentic; the old API diagnostic stays off navigation
  // so pre-existing cash/finance/transfer E2E accounting checks cannot silently disappear.
  for(const width of [390,768,1440]){
    await withCheck('Phase 6 source HisabIQ Finance reads reconciled D1 and posts transfer once '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/finance');
      const finance=page.locator('[data-live-finance]');
      await finance.waitFor({timeout:12000});
      await finance.getByText('Shop Bank').first().waitFor({timeout:12000});
      const content=await finance.innerText();
      assert.ok(content.includes('125.6234'),'Finance must show verified 4-decimal book balance');
      assert.ok(content.includes('Disputed Bank'),'Finance must show disputed account identity');
      assert.ok(!content.includes('999.00'),'Unreconciled recorded amount must remain hidden');
      assert.ok(calls.some(x=>x.method==='GET'&&x.path==='/api/bank/reconciliation'));
      assert.ok(calls.some(x=>x.method==='GET'&&x.path==='/api/finance/bootstrap'));
      await finance.getByRole('tab',{name:/Money Accounts/}).click();
      await finance.getByRole('button',{name:'Transfer',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:/Transfer between accounts/});
      await dialog.waitFor({timeout:10000});
      await dialog.getByRole('combobox',{name:/From account/}).selectOption('BK-OK');
      await dialog.getByRole('combobox',{name:/To account/}).selectOption('BK-DISPUTED');
      await dialog.getByRole('textbox',{name:/Amount/}).fill('12.5');
      await dialog.getByRole('textbox',{name:/Reference/}).fill('operating float');
      await dialog.getByRole('button',{name:/Review transfer/}).click();
      await dialog.getByRole('button',{name:/Confirm transfer/}).click();
      await page.getByText('BTR-UI-6B-POSTED').waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/bank/transfers').length,1);
      assert.ok(!calls.some(x=>x.method==='POST'&&x.path.includes('/reverse')));
      await screenshot(page,'phase6-source-finance-'+width);
      await inspectLayout(page,'phase6-source-finance-'+width);
      await audit(page,'phase6-source-finance-'+width);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }

  for(const width of [390,768,1440]){
    await withCheck('Phase 6F real Expense posting and cancellation '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/expenses');
      const panel=page.locator('[data-live-expenses]');
      await panel.waitFor({timeout:12000});
      await panel.getByText('EXP-UI-6F-OLD').waitFor({timeout:12000});
      await page.getByRole('combobox',{name:'Expense category'}).selectOption('CAT-UI-6F');
      await page.getByRole('spinbutton',{name:'Expense amount'}).fill('35.5');
      await page.getByRole('combobox',{name:'Expense payment method'}).selectOption('Bank');
      await page.getByRole('combobox',{name:'Expense bank account'}).selectOption('BK-UI-6F');
      await page.getByRole('button',{name:'Review expense'}).click();
      await page.getByRole('button',{name:'Confirm expense'}).click();
      await page.getByText(/EXP-UI-6F-POSTED/).waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/expenses').length,1);
      await panel.getByRole('button',{name:'Cancel',exact:true}).first().click();
      await page.getByRole('textbox',{name:'Expense cancellation reason'}).fill('Duplicate shop rent reviewed');
      await page.getByRole('button',{name:'Confirm cancel'}).click();
      await page.getByText(/Expense cancelled/).waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path.includes('/cancel')).length,1);
      await screenshot(page,'phase6f-expenses-'+width);
      await inspectLayout(page,'phase6f-expenses-'+width);
      await audit(page,'phase6f-expenses-'+width);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }

  for(const width of [390,768,1440]){
    await withCheck('Phase 6E source-linked read-only Daybook '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/daybook');
      const daybook=page.locator('[data-live-daybook]');
      await daybook.waitFor({timeout:12000});
      await daybook.getByText('BTR-UI-6E-001').waitFor({timeout:12000});
      await daybook.getByRole('button',{name:'Actions for BTR-UI-6E-001'}).click();
      await page.getByRole('dialog',{name:'Actions for BTR-UI-6E-001'}).getByRole('button',{name:'Go to source'}).waitFor({state:'visible',timeout:5000});
      assert.equal(await page.getByRole('button',{name:'Review reversal'}).count(),0,'Daybook must not expose unsupported posting reversals');
      await daybook.getByRole('combobox',{name:'Daybook rows per page'}).selectOption('100');
      await daybook.getByRole('button',{name:/Created Date/}).click();
      await page.waitForFunction(()=>document.querySelector('[data-live-daybook]')?.textContent?.includes('1 of 1 records'),null,{timeout:12000});
      assert.ok(calls.some(x=>x.method==='ASSERT'&&x.path==='/api/daybook'&&x.pageSize===100&&x.sortBy==='createdAt'));
      assert.ok(!calls.some(x=>x.method==='POST'&&x.path.startsWith('/api/daybook')));
      await screenshot(page,'phase6e-daybook-'+width);
      await inspectLayout(page,'phase6e-daybook-'+width);
      await audit(page,'phase6e-daybook-'+width);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }

  for(const width of [390,768,1440]){
    await withCheck('two-tab live Reports '+width+' only reads authenticated API source',async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];
      await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/reports?screen=library&report=sales-register&from=2026-10-01&to=2026-10-30');
      await page.locator('[data-live-reports]').waitFor({timeout:10000});
      await page.getByText('INV-LIVE-REPORT-001').waitFor({timeout:10000});
      const nav=page.locator('[data-live-reports] [role="tab"]');
      assert.equal(await nav.count(),2,'only Dashboard and Report Library are top-level tabs');
      assert.deepEqual((await nav.allTextContents()).map(x=>x.trim()),['Dashboard','Report Library']);
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),1);
      assert.equal(await page.getByText('120',{exact:true}).count(),0,'money formatted and labeled, not synthetic bare values');
      assert.ok(calls.some(x=>x.method==='GET'&&x.path==='/api/reports/v2/rows'));
      assert.ok(!calls.some(x=>x.method==='POST'&&x.path.startsWith('/api/reports')));
      await nav.first().click();
      await page.getByText('Verified dashboard totals are pending.').waitFor({timeout:10000});
      assert.equal(await page.locator('[data-live-reports] [role="tab"]').count(),2);
      await inspectLayout(page,'reports-two-tabs-'+width);
      await screenshot(page,'reports-two-tabs-'+width);
      await audit(page,'reports-two-tabs-'+width);
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 5D current stock and dues UI '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/reports?screen=library&report=stock&from=2026-10-01&to=2026-10-30');
      await page.getByText('STK-LIVE-001').waitFor({timeout:10000});
      await page.getByRole('columnheader',{name:'Current FIFO value'}).waitFor();
      assert.equal(await page.locator('[data-live-reports] [role="tab"]').count(),2);
      await screenshot(page,'reports-stock-'+width);
      await page.goto(base+'/#/app/reports?screen=library&report=payables&from=2026-10-01&to=2026-10-30');
      await page.getByText('SUP-LIVE-001').waitFor({timeout:10000});
      await page.getByRole('columnheader',{name:'Current due'}).waitFor();
      await page.getByText('Needs checking').first().waitFor();
      await screenshot(page,'reports-supplier-dues-'+width);
      await page.getByRole('tab',{name:'Dashboard'}).click();
      await page.locator('[data-current-balance="inventoryValue"]').getByText('৳50').waitFor({timeout:10000});
      assert.match(await page.locator('[data-current-balance="inventoryValue"]').innerText(),/50/);
      assert.equal(await page.locator('[data-live-reports] [role="tab"]').count(),2);
      await inspectLayout(page,'reports-current-balances-'+width);
      await audit(page,'reports-current-balances-'+width);
      assert.ok(calls.every(x=>x.method!=='POST'||!x.path.startsWith('/api/reports')));
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 5E money ledger UI '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/reports?screen=library&report=cash-book&from=2026-10-01&to=2026-10-30');
      await page.getByText('CB-CAP-LIVE').waitFor({timeout:10000});
      await page.getByRole('columnheader',{name:'Money in'}).waitFor();
      await page.getByRole('columnheader',{name:'Money out'}).waitFor();
      await page.locator('[data-report-metric="externalNetMovement"]').getByText('৳450').waitFor();
      assert.equal(await page.locator('[data-live-reports] [role="tab"]').count(),2);
      await screenshot(page,'reports-money-'+width);
      await page.goto(base+'/#/app/reports?screen=library&report=finance-movements&from=2026-10-01&to=2026-10-30');
      await page.getByText('FIN-LIVE-001').waitFor({timeout:10000});
      await page.locator('[data-report-metric="ownerCapitalIn"]').getByText('৳300').waitFor();
      await screenshot(page,'reports-finance-'+width);
      await page.goto(base+'/#/app/reports?screen=library&report=expenses&from=2026-10-01&to=2026-10-30');
      await page.getByText('EXP-LIVE-001').waitFor({timeout:10000});
      await page.locator('[data-report-metric="operatingExpenses"]').getByText('৳50').waitFor();
      await inspectLayout(page,'reports-expense-'+width);
      await screenshot(page,'reports-expense-'+width);
      await audit(page,'reports-expense-'+width);
      assert.equal(await page.locator('[data-live-reports] [role="tab"]').count(),2);
      assert.ok(!calls.some(x=>x.method==='POST'&&x.path.startsWith('/api/reports')));
      await ctx.close();
    });
  }
  await withCheck('report reader without POS permission cannot open invoice details',async()=>{
    const ctx=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
    const calls=[];await startMocking(ctx,calls);
    await ctx.route('**/api/auth/me',route=>route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,user:{...user,role:'staff',permissions:{
        reports:{view:true,add:false,edit:false},pos:{view:false,add:false,edit:false}
      }}})}));
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/reports?screen=library&report=sales-register&from=2026-10-01&to=2026-10-30');
    await page.getByText('INV-LIVE-REPORT-001').waitFor({timeout:10000});
    assert.equal(await page.getByRole('button',{name:'INV-LIVE-REPORT-001'}).count(),0,
      'report-only users must not get an invoice action without POS view');
    assert.equal(calls.filter(x=>x.path.startsWith('/api/pos/invoices/')).length,0);
    await ctx.close();
  });
  for(const width of [390,768,1440]){
    await withCheck('report pagination honors 50/100 and direct page jump '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/reports?screen=library&report=sales-register&from=2026-10-01&to=2026-10-30');
      await page.getByRole('textbox',{name:'Search records'}).fill('CI-PAGE');
      await page.getByText('INV-CI-0001').waitFor({timeout:10000});
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),50);
      await page.getByRole('button',{name:'Next'}).click();
      await page.getByText('INV-CI-0051').waitFor();
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),50);
      await page.getByRole('button',{name:'Next'}).click();
      await page.getByText('INV-CI-0101').waitFor();
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),5);
      assert.equal(await page.getByRole('button',{name:'Next'}).isDisabled(),true);
      const jump=page.getByRole('spinbutton',{name:'Go to page'});
      await jump.fill('1');
      await jump.press('Enter');
      await page.getByText('INV-CI-0001').waitFor();
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),50);
      await page.getByRole('combobox',{name:'Rows per page'}).selectOption('100');
      await page.getByText('INV-CI-0100').waitFor();
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),100);
      await page.getByRole('button',{name:'Next'}).click();
      await page.getByText('INV-CI-0101').waitFor();
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),5);
      assert.ok(calls.every(call=>call.method!=='POST'||!call.path.startsWith('/api/reports')));
      await screenshot(page,'reports-pagination-'+width);
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Sales Register reads original invoice without writes '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/reports?screen=library&report=sales-register&from=2026-10-01&to=2026-10-30');
      await page.getByRole('button',{name:'INV-LIVE-REPORT-001'}).click();
      const modal=page.getByRole('dialog',{name:'Recorded invoice'});
      await modal.getByText('Real API Mock Buyer').waitFor({timeout:10000});
      await modal.getByText('Copper Cable 2.5mm').waitFor();
      await modal.getByText('৳120').first().waitFor();
      assert.equal(calls.filter(x=>x.path==='/api/pos/invoices/INV-LIVE-REPORT-001'&&x.method==='GET').length,1);
      assert.ok(!calls.some(x=>x.method==='POST'&&x.path.startsWith('/api/')),
        'opening a report source must be read-only');
      await screenshot(page,'reports-invoice-source-'+width);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog',{name:'Recorded invoice'}).count(),0);
      await ctx.close();
    });
  }
  for(const width of [390,1440]){
    await withCheck('profit report destinations do not reuse invoice-cohort figures '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();const queried=[];
      page.on('request',request=>{
        const url=new URL(request.url());
        if(url.pathname==='/api/reports/v2/rows')queried.push(url.searchParams.get('report'));
      });
      await page.goto(base+'/#/app/reports?screen=library&report=product-profit&from=2026-10-01&to=2026-10-30');
      await page.getByText(/Product-level FIFO allocations/).waitFor({timeout:10000});
      assert.ok(queried.includes('product-profit'),'product gross profit must have its own backend report ID');
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),0);
      await page.getByRole('navigation',{name:'Report library'})
        .getByRole('button',{name:'Profit & Loss statement'}).click();
      await page.getByText(/Full ledger balances and posted adjustments/).waitFor({timeout:10000});
      assert.ok(queried.includes('profit-loss'),'a P&L must not reuse the invoice-cohort profitability endpoint');
      assert.equal(await page.locator('[data-live-reports] tbody tr').count(),0);
      assert.ok(!queried.includes('profit'),'neither unsupported report may present cohort profit as its own');
      assert.equal(await page.locator('[data-live-reports] [role="tab"]').count(),2);
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('reports search resets when selecting a different report '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/reports?screen=library&report=cash-book&from=2026-10-01&to=2026-10-30');
      await page.getByText('CB-CAP-LIVE').waitFor({timeout:10000});
      const search=page.getByRole('textbox',{name:'Search records'});
      await search.fill('Investment');
      assert.equal(await search.inputValue(),'Investment');
      const nav=page.getByRole('navigation',{name:'Report library'});
      await nav.getByRole('button',{name:'Expense register'}).click();
      await page.getByText('EXP-LIVE-001').waitFor({timeout:10000});
      assert.equal(await search.inputValue(),'','switching report must not preserve a previous report-only record search');
      const reportCalls=calls.filter(x=>x.method==='GET'&&x.path==='/api/reports/v2/rows');
      assert.ok(reportCalls.length>0);
      assert.equal(await page.locator('[data-live-reports] [role="tab"]').count(),2);
      await ctx.close();
    });
  }
  for(const width of [390,768,1024,1440]){
    for(const theme of ['light','dark']){
      await withCheck('products '+width+' '+theme,async()=>{
        const ctx=await browser.newContext({viewport:{width,height:900},
          colorScheme:theme,reducedMotion:'reduce',deviceScaleFactor:1});
        const api=[];
        await startMocking(ctx,api);
        await ctx.addInitScript(({theme})=>{
          localStorage.setItem('shererp_auth_token','ui-e2e-only-token');
          localStorage.setItem('hisabiq-theme',theme);
        },{theme});
        const page=await ctx.newPage();
        page.on('pageerror',e=>results.consoleErrors.push('products '+width+': '+e.message));
        await page.goto(base+'/#/app/products',{waitUntil:'domcontentloaded'});
        await page.locator('[data-live-products]').waitFor({timeout:10000});
        await page.getByText('Copper Cable 2.5mm').first().waitFor({timeout:10000});
        await inspectLayout(page,'products-'+width+'-'+theme);
        await screenshot(page,'products-'+width+'-'+theme);
        await audit(page,'products-'+width+'-'+theme);
        if(width===390&&theme==='light'){
          const search=page.getByRole('textbox',{name:'Search products'});
          await search.fill('Copper');
          assert.equal(await page.locator('[data-live-products] tbody tr').count(),1);
          await page.getByRole('button',{name:'Clear Search products',exact:true}).click();
          assert.equal(await page.locator('[data-live-products] tbody tr').count(),3);
          await page.getByRole('button',{name:/Add product/i}).click();
          await page.locator('[data-live-product-editor]').waitFor();
          await screenshot(page,'product-editor-390');
        }
        results.apiCalls.push(...api);
        await ctx.close();
      });
    }
  }
  await runProductsHybridChecks({browser,base,withCheck,results});
  await runFinalProductChecks({browser,base,withCheck,results});
  await runPaidRefundChecks({browser,base,withCheck,results,startMocking,screenshot,audit});
  for(const width of [390,768,1440]){
    await withCheck('Phase 4A supplier search + due purchase '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];
      await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('purchase '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases/new');
      await page.locator('[data-live-purchase-editor]').waitFor({timeout:12000});
      const supplier=page.getByRole('combobox',{name:'Search supplier name, phone or ID'});
      await supplier.fill('Khan');
      await page.getByRole('option',{name:/Khan Hardware/}).click();
      await page.getByText(/Existing due/).waitFor();
      assert.ok((await page.locator('[data-live-purchase-editor]').innerText()).includes('100'));
      await page.getByRole('combobox',{name:'Product'}).selectOption('PRD-000001');
      await page.getByRole('spinbutton',{name:'Purchase quantity'}).fill('3');
      await page.getByRole('spinbutton',{name:'Purchase unit cost'}).fill('80');
      await inspectLayout(page,'phase4-purchase-entry-'+width);
      await screenshot(page,'phase4-purchase-entry-'+width);
      if(width===390)await audit(page,'phase4-purchase-entry-390');
      await page.getByRole('button',{name:/Confirm Due Purchase/}).click();
      await page.locator('[data-live-purchases]').waitFor({timeout:12000});
      await page.getByText('PUR-UI-0001').waitFor();
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/purchases').length,1);
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path==='/api/purchases').length,1);
      results.apiCalls.push(...calls);
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 4I-B paid purchase UI and double-submit guard '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      let paidPosts=0;
      await ctx.route('**/api/purchases',async route=>{
        if(route.request().method()==='GET')return route.fulfill({
          status:200,contentType:'application/json',body:JSON.stringify({ok:true,purchases:[
            {purchaseId:'PUR-UI-PAID',purchaseDate:'2026-10-30',
             supplierId:'SUP-UI-001',supplierName:'Khan Hardware',grandTotal:240,
             paidAmount:40,dueAmount:200,paymentStatus:'Partial',items:[]}
          ]})});
        const body=route.request().postDataJSON();
        paidPosts++;
        calls.push({method:'ASSERT',path:'/api/purchases/paid',payload:body});
        assert.equal(body.supplierId,'SUP-UI-001');
        assert.equal(body.paymentMethod,'Bank');
        assert.equal(body.bankAccountId,'BANK-UI-1');
        assert.equal(body.paidAmount,40);
        assert.match(body.clientRequestId,/^[0-9a-f-]{32,36}$/i);
        assert.deepEqual(body.items,[{productId:'PRD-000001',qty:3,unitPrice:80}]);
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({ok:true,purchaseId:'PUR-UI-PAID',grandTotal:240,dueAmount:200})});
      });
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      await page.goto(base+'/#/app/purchases/new');
      await page.locator('[data-live-purchase-editor]').waitFor({timeout:12000});
      assert.equal(await page.getByRole('combobox',{name:'Purchase payment method'}).inputValue(),'Due');
      await page.getByRole('combobox',{name:'Search supplier name, phone or ID'}).fill('Khan');
      await page.getByRole('option',{name:/Khan Hardware/}).click();
      await page.getByRole('combobox',{name:'Product'}).selectOption('PRD-000001');
      await page.getByRole('spinbutton',{name:'Purchase quantity'}).fill('3');
      await page.getByRole('spinbutton',{name:'Purchase unit cost'}).fill('80');
      await page.getByRole('combobox',{name:'Purchase payment method'}).selectOption('Bank');
      await page.getByRole('spinbutton',{name:'Purchase paid amount'}).fill('241');
      await page.getByRole('combobox',{name:'Purchase bank account'}).selectOption('BANK-UI-1');
      assert.equal(await page.getByRole('button',{name:/Confirm Paid Purchase/}).isDisabled(),true);
      await page.getByRole('spinbutton',{name:'Purchase paid amount'}).fill('40');
      await page.getByText('৳200',{exact:false}).first().waitFor();
      await inspectLayout(page,'phase4i-paid-purchase-'+width);
      await screenshot(page,'phase4i-paid-purchase-'+width);
      if(width===390)await audit(page,'phase4i-paid-purchase-390');
      await page.getByRole('button',{name:/Confirm Paid Purchase/}).dblclick();
      await page.locator('[data-live-purchases]').waitFor({timeout:12000});
      await page.getByText('PUR-UI-PAID').waitFor();
      assert.equal(paidPosts,1,'One cash movement and purchase per double-click');
      results.apiCalls.push(...calls);await ctx.close();
    });
  }
  await withCheck('Phase 4I-B mixed-unit paid tender stays disabled while Due works',async()=>{
    const ctx=await browser.newContext({viewport:{width:768,height:940},reducedMotion:'reduce'});
    const calls=[];await startMocking(ctx,calls);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/purchases/new');
    await page.locator('[data-live-purchase-editor]').waitFor({timeout:12000});
    await page.getByRole('combobox',{name:'Search supplier name, phone or ID'}).fill('Khan');
    await page.getByRole('option',{name:/Khan Hardware/}).click();
    await page.getByRole('combobox',{name:'Product'}).selectOption('PRD-000002');
    await page.locator('[data-multi-quantity]').waitFor({timeout:10000});
    await page.getByRole('combobox',{name:'Purchase payment method'}).selectOption('Cash');
    await page.getByText(/mixed.unit.*due|due.*mixed.unit/i).first().waitFor();
    assert.equal(await page.getByRole('button',{name:/Confirm Paid Purchase/}).isDisabled(),true);
    await page.getByRole('combobox',{name:'Purchase payment method'}).selectOption('Due');
    assert.equal(await page.getByRole('button',{name:/Confirm Due Purchase/}).isDisabled(),false);
    assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/purchases').length,0);
    await ctx.close();
  });
  await withCheck('Phase 4I-B Mobile Banking and uncertain payment never auto-retry',async()=>{
    const ctx=await browser.newContext({viewport:{width:768,height:940},reducedMotion:'reduce'});
    const calls=[];await startMocking(ctx,calls);
    let sessionOpen=false,attempts=0,posted=null;
    await ctx.route('**/api/purchases/supplier-settlements/supplier/SUP-UI-001',route=>
      route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        ok:true,supplier:{id:'SUP-UI-001',name:'Khan Hardware',currentDue:100},
        ledgerDue:100,needsReconciliation:false,activeSession:sessionOpen,
        bankAccounts:[{id:'MOBILE-UI-1',name:'Shop mobile account',type:'Mobile Banking',currentBalance:120}],
        settlements:[]
      })}));
    await ctx.route('**/api/purchases',route=>{
      if(route.request().method()!=='POST')return route.fallback();
      posted=route.request().postDataJSON();attempts++;
      return route.fulfill({status:503,contentType:'application/json',
        body:JSON.stringify({ok:false,error:'Temporary network outcome unknown'})});
    });
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/purchases/new');
    await page.locator('[data-live-purchase-editor]').waitFor({timeout:12000});
    await page.getByRole('combobox',{name:'Search supplier name, phone or ID'}).fill('Khan');
    await page.getByRole('option',{name:/Khan Hardware/}).click();
    await page.getByRole('combobox',{name:'Product'}).selectOption('PRD-000001');
    await page.getByRole('spinbutton',{name:'Purchase quantity'}).fill('3');
    await page.getByRole('spinbutton',{name:'Purchase unit cost'}).fill('80');
    await page.getByRole('combobox',{name:'Purchase payment method'}).selectOption('Cash');
    await page.getByRole('spinbutton',{name:'Purchase paid amount'}).fill('40');
    await page.getByText(/Open a cash session before paying/).waitFor();
    assert.equal(await page.getByRole('button',{name:/Confirm Paid Purchase/}).isDisabled(),true);
    assert.equal(attempts,0,'Closed cash sessions must never POST a purchase payment');
    sessionOpen=true;
    await page.getByRole('combobox',{name:'Purchase payment method'}).selectOption('Mobile Banking');
    await page.getByRole('combobox',{name:'Purchase bank account'}).selectOption('MOBILE-UI-1');
    await page.getByRole('button',{name:/Confirm Paid Purchase/}).click();
    await page.getByText(/Network\/server outcome uncertain/).waitFor({timeout:12000});
    assert.equal(attempts,1,'Uncertain outcome must not automatically post again');
    assert.equal(posted.paymentMethod,'Mobile Banking');
    assert.equal(posted.bankAccountId,'MOBILE-UI-1');
    assert.equal(posted.paidAmount,40);
    assert.match(posted.clientRequestId,/^[0-9a-f-]{32,36}$/i);
    assert.equal(await page.getByRole('button',{name:/Confirm Paid Purchase/}).isDisabled(),true);
    await page.getByRole('button',{name:'Check Purchase History'}).click();
    await page.locator('[data-live-purchases]').waitFor({timeout:12000});
    assert.equal(attempts,1,'Checking history must not re-submit the money movement');
    results.apiCalls.push({method:'ASSERT',path:'/api/purchases/mobile-payment-unknown',payload:posted});
    await ctx.close();
  });
  for(const width of [390,768,1440]){
    await withCheck('Phase 4B joined 3-unit purchase and price unit '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('phase4b '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases/new');
      await page.locator('[data-live-purchase-editor]').waitFor({timeout:12000});
      await page.getByRole('combobox',{name:'Search supplier name, phone or ID'}).fill('Khan');
      await page.getByRole('option',{name:/Khan Hardware/}).click();
      await page.getByRole('combobox',{name:'Product'}).selectOption('PRD-000002');
      await page.locator('[data-multi-quantity]').waitFor({timeout:10000});
      await page.getByRole('textbox',{name:'Quantity in Carton for PVC Pipe 20mm'}).fill('1');
      await page.getByRole('textbox',{name:'Quantity in Box for PVC Pipe 20mm'}).fill('2');
      await page.getByRole('textbox',{name:'Quantity in Pcs for PVC Pipe 20mm'}).fill('3');
      await page.getByRole('combobox',{name:'Purchase price unit'}).selectOption('Carton');
      await page.getByRole('spinbutton',{name:'Purchase unit cost'}).fill('2400');
      assert.ok((await page.locator('[data-live-purchase-editor]').innerText()).includes('2,830'));
      await inspectLayout(page,'phase4b-mixed-purchase-'+width);
      await screenshot(page,'phase4b-mixed-purchase-'+width);
      if(width===390)await audit(page,'phase4b-mixed-purchase-390');
      await page.getByRole('button',{name:/Confirm Due Purchase/}).click();
      await page.locator('[data-live-purchases]').waitFor({timeout:12000});
      await page.getByText('PUR-UI-MIXED').waitFor();
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path==='/api/purchases').length,1);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 4C original-cost partial purchase return '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('phase4c '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases?tab=return&purchaseId=PUR-UI-MIXED');
      await page.locator('[data-live-purchase-returns]').waitFor({timeout:12000});
      await page.getByText('PVC Pipe 20mm').waitFor();
      await page.getByRole('textbox',{name:'Quantity in Box for PVC Pipe 20mm'}).fill('1');
      await page.getByRole('textbox',{name:'Quantity in Pcs for PVC Pipe 20mm'}).fill('2');
      await page.getByPlaceholder('Why are you returning the goods?').fill('Quality inspection');
      await page.getByText(/Original purchase-cost credit/).waitFor();
      assert.ok((await page.locator('[data-live-purchase-returns]').innerText()).includes('220'));
      await screenshot(page,'phase4c-purchase-return-'+width);
      if(width===390)await audit(page,'phase4c-purchase-return-390');
      await page.getByRole('button',{name:/Confirm Purchase Return/}).click();
      await page.getByText(/Purchase return saved/).waitFor({timeout:12000});
      assert.equal(calls.filter(c=>c.method==='ASSERT'&&c.path==='/api/purchase-returns').length,1);
      results.apiCalls.push(...calls);
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 4D supplier payment and reversal '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('phase4d '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases?tab=payments&supplierId=SUP-UI-001');
      await page.locator('[data-live-supplier-settlements]').waitFor({timeout:12000});
      await page.getByText('Current due · বাকি:').waitFor({timeout:12000});
      await page.getByRole('spinbutton',{name:'Supplier payment amount'}).fill('40');
      await page.getByRole('combobox',{name:'Supplier payment method'}).selectOption('Cash');
      await inspectLayout(page,'phase4d-supplier-payment-'+width);
      await screenshot(page,'phase4d-supplier-payment-'+width);
      if(width===390)await audit(page,'phase4d-supplier-payment-390');
      await page.getByRole('button',{name:/Confirm Payment/}).click();
      await page.getByText(/Payment saved · SST-UI-001/).waitFor({timeout:12000});
      await page.getByRole('button',{name:/Reverse ·/}).click();
      await page.getByRole('textbox',{name:'Supplier payment reversal reason'}).fill('Entered wrong payout');
      await page.getByRole('button',{name:'Confirm reversal'}).click();
      await page.getByText(/Reversal recorded · REV-UI-001/).waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path==='/api/purchases/supplier-settlements').length,1);
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path.endsWith('/reverse')).length,1);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 4E Purchase Plans → Orders → Purchases '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:930},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('phase4e '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases?tab=plans');
      await page.locator('[data-live-purchase-plans]').waitFor({timeout:12000});
      await page.getByRole('spinbutton',{name:'Planned quantity for Copper Cable 2.5mm'}).fill('4');
      await page.getByRole('combobox',{name:'Supplier for Copper Cable 2.5mm'}).selectOption('SUP-UI-001');
      await inspectLayout(page,'phase4e-planner-'+width);
      await screenshot(page,'phase4e-planner-'+width);
      if(width===390)await audit(page,'phase4e-planner-390');
      await page.getByRole('button',{name:'Save Purchase Plan'}).click();
      await page.getByText(/Draft purchase plan saved/).waitFor({timeout:12000});
      await page.getByRole('button',{name:'Approve & Create Orders'}).click();
      await page.getByRole('link',{name:'Convert to Purchase'}).click();
      await page.locator('[data-live-purchase-editor]').waitFor({timeout:12000});
      await page.getByText(/Approved supplier order SPO-UI-001/).waitFor({timeout:12000});
      await page.getByRole('button',{name:/Confirm Due Purchase/}).click();
      await page.getByText('PUR-UI-ORDER').waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path==='/api/purchases/order-conversion').length,1);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }
  await withCheck('POS keeps typed name when a legacy saved phone match has an empty customer name',async()=>{
    const ctx=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.route('**/api/pos/bootstrap',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,products:[...posProducts,posMixedProduct],
        customers:[{id:'CUST-LEGACY-BLANK',name:'',phone:'01000000124',
          fatherName:'',address:'',currentDue:0}],bankAccounts:[],
        vendors:[],activeSession:{sessionId:'UI-E2E-SESSION',openedAt:'2026-10-28 09:00:00',openingCash:500},
        invoiceDesign:{settings:{'Shop Name':'UI Fixture Shop'},logoDataUri:''}})
    }));
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/pos',{waitUntil:'domcontentloaded'});
    await page.locator('[data-live-pos]').waitFor({timeout:12000});
    await page.locator('[data-live-pos] button').filter({hasText:'Copper Cable 2.5mm'}).first().click();
    await page.getByRole('spinbutton',{name:'Quantity for Copper Cable 2.5mm'}).waitFor();
    const name=page.locator('input[list="live-pos-customer-names"]');
    const phone=page.locator('input[list="live-pos-customer-phones"]');
    await name.fill('Real Browser Due Buyer');
    await phone.fill('01000000124');
    await page.getByRole('spinbutton',{name:/Amount received/}).fill('40');
    assert.equal(await name.inputValue(),'Real Browser Due Buyer',
      'legacy phone records must never silently erase a cashier-entered name on blur');
    assert.equal(await phone.inputValue(),'01000000124');
    assert.equal(await page.getByRole('spinbutton',{name:/Amount received/}).inputValue(),'40');
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/pos/sales').length,0);
    await ctx.close();
  });
  for(const width of [390,768,1440]){
    await withCheck('pos '+width+' light',async()=>{
      const ctx=await browser.newContext({viewport:{width,height:960},
        reducedMotion:'reduce',deviceScaleFactor:1});
      const api=[];
      await startMocking(ctx,api);
      await ctx.addInitScript(()=>{
        localStorage.setItem('shererp_auth_token','ui-e2e-only-token');
        localStorage.setItem('hisabiq-theme','light');
      });
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('pos '+width+': '+e.message));
      await page.goto(base+'/#/app/pos',{waitUntil:'domcontentloaded'});
      await page.locator('[data-live-pos]').waitFor({timeout:10000});
      await page.getByText('Copper Cable 2.5mm').first().waitFor({timeout:10000});
      // Source: pinned HisabIQ src/components/pos/CartTable.tsx.
      // The original seven-column header and product picker share one grid.
      const sourceCart=page.locator('[data-live-pos] [data-cart-kind="sale"]');
      assert.equal(await sourceCart.locator('[data-cart-header]').count(),1,
        'Restore the original HisabIQ cart header instead of a detached toolbar');
      assert.equal(await sourceCart.locator('[data-testid="pos-cart"]').count(),1);
      assert.equal(await sourceCart.locator('[data-testid="pos-add-row"]').count(),1,
        'Product search belongs in the original HisabIQ add-row');
      assert.equal(await sourceCart.locator('[data-cart-header] > *').count(),7,
        'Original cart has #, Product, Quantity, Price In, Price, Total, Remove');
      assert.equal(await sourceCart.locator('[data-testid="pos-add-row"] input').count(),1,
        'One embedded product search, not a second detached form');
      await inspectLayout(page,'pos-'+width+'-light');
      await screenshot(page,'pos-'+width+'-light');
      if(width===390)await audit(page,'pos-390-light');
      // Explicit keyboard focus contract, then add a regular non-tracked item.
      await page.keyboard.press('F2');
      assert.ok(await page.locator('input:focus').count()>=1,'F2 should focus the product picker');
      await page.keyboard.press('Escape'); // Close open source-authentic combobox before tapping quick item.
      const quick=page.locator('[data-live-pos] button').filter({hasText:'Copper Cable 2.5mm'}).first();
      await quick.click();
      await page.getByRole('spinbutton',{name:'Quantity for Copper Cable 2.5mm'}).waitFor();
      assert.equal(await page.locator('[data-testid="pos-cart"] [data-pos-line]').count(),1,
        'Live selected product renders in the original HisabIQ cart grid');
      await screenshot(page,'pos-cart-'+width);
      if(width===1440){
        const [name,phone]=[
          page.locator('input[list="live-pos-customer-names"]'),
          page.locator('input[list="live-pos-customer-phones"]')
        ];
        await name.fill('Test Customer');
        await phone.fill('01000000001');
        await page.getByRole('spinbutton',{name:/Amount received/}).fill('120');
        await page.getByRole('button',{name:'Review and post real sale'}).click();
        await page.getByRole('button',{name:'Confirm and post'}).click();
        await page.getByText('Sale posted successfully').waitFor({timeout:12000});
        assert.equal(api.filter(x=>x.path==='/api/pos/sales'&&x.method==='POST').length,1);
        await page.getByRole('button',{name:'View / Print receipt'}).click();
        await page.locator('#hisabiq-real-receipt').waitFor();
        await screenshot(page,'pos-saved-receipt-1440');
      }
      results.apiCalls.push(...api);
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('mixed-unit joined quantity '+width+' layout and posting',async()=>{
      const ctx=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
      const api=[];await startMocking(ctx,api);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('mixed '+width+': '+e.message));
      await page.goto(base+'/#/app/pos',{waitUntil:'domcontentloaded'});
      await page.locator('[data-live-pos]').waitFor();
      await page.locator('[data-live-pos] button').filter({hasText:'Carton Test Cable'}).first().click();
      const line=page.locator('[data-pos-line]').filter({hasText:'Carton Test Cable'});
      const inputs=line.locator('[data-multi-quantity] input');
      await inputs.first().waitFor();
      assert.equal(await inputs.count(),3);
      await inputs.nth(0).fill('1');await inputs.nth(1).fill('2');await inputs.nth(2).fill('3');
      assert.ok((await line.textContent()).includes('2,490'),'mixed prices remain independent');
      const tops=await inputs.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
      assert.ok(tops.every(top=>Math.abs(top-tops[0])<2),'one compact horizontal quantity line');
      await screenshot(page,'phase3b-mixed-quantity-'+width);
      await page.locator('input[list="live-pos-customer-names"]').fill('UI Unit Buyer');
      await page.locator('input[list="live-pos-customer-phones"]').fill('01000009123');
      await page.getByRole('spinbutton',{name:/Amount received/}).fill('2490');
      await page.getByRole('button',{name:'Review and post real sale'}).click();
      await page.getByRole('button',{name:'Confirm and post'}).click();
      await page.getByText('Sale posted successfully').waitFor({timeout:12000});
      const posted=api.find(x=>x.method==='ASSERT'&&x.path==='/api/pos/sales')?.payload;
      assert.equal(posted.items[0].qty,283);
      assert.equal(posted.items[0].unitProfileRevision,1);
      assert.deepEqual(posted.items[0].unitQuantities,{Carton:1,Box:2,Pcs:3});
      assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/pos/sales').length,1);
      results.apiCalls.push(...api);await ctx.close();
    });
  }
  await withCheck('tracked serial POS selects backend eligible IMEI and posts once',async()=>{
    const ctx=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/pos');
    await page.locator('[data-live-pos]').waitFor();
    await page.locator('[data-live-pos] button').filter({hasText:'Serial Tracked Motor'}).first().click();
    await page.getByRole('button',{name:/Serial \/ IMEI/}).click();
    await page.getByRole('button',{name:/SN-UI-001/}).click();
    await page.getByRole('button',{name:'Use serials'}).click();
    await page.locator('input[list="live-pos-customer-names"]').fill('UI Tracking Buyer');
    await page.locator('input[list="live-pos-customer-phones"]').fill('01000000001');
    await page.getByRole('spinbutton',{name:/Amount received/}).fill('700');
    await page.getByRole('button',{name:'Review and post real sale'}).click();
    await page.getByRole('button',{name:'Confirm and post'}).click();
    await page.getByText('Sale posted successfully').waitFor({timeout:12000});
    assert.equal(api.filter(x=>x.path==='/api/pos/sales'&&x.method==='POST').length,1);
    assert.equal(api.find(x=>x.method==='ASSERT'&&x.path==='/api/pos/sales')?.payload.items[0].productId,'PRD-000003');
    await screenshot(page,'phase13-pos-serial-1440');
    results.apiCalls.push(...api);await ctx.close();
  });
  await withCheck('shortage dialog explicitly chooses negative sourcing',async()=>{
    const ctx=await browser.newContext({viewport:{width:768,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/pos');await page.locator('[data-live-pos]').waitFor();
    await page.locator('[data-live-pos] button').filter({hasText:'PVC Pipe 20mm'}).first().click();
    await page.getByRole('spinbutton',{name:'Quantity for PVC Pipe 20mm'}).fill('5');
    await page.getByRole('button',{name:'Resolve stock shortage'}).click();
    await page.getByRole('radio',{name:/Negative Sale/}).click();
    await page.getByRole('button',{name:'Allow negative sale'}).click();
    await page.locator('input[list="live-pos-customer-names"]').fill('UI Shortage Buyer');
    await page.locator('input[list="live-pos-customer-phones"]').fill('01000000002');
    await page.getByRole('spinbutton',{name:/Amount received/}).fill('275');
    await page.getByRole('button',{name:'Review and post real sale'}).click();
    await page.getByRole('button',{name:'Confirm and post'}).click();
    await page.getByText('Sale posted successfully').waitFor({timeout:12000});
    const payload=api.find(x=>x.method==='ASSERT'&&x.path==='/api/pos/sales')?.payload;
    assert.equal(payload.items[0].fulfillmentMode,'negative');
    assert.equal(payload.items[0].qty,5);
    await screenshot(page,'phase13-pos-shortage-768');
    results.apiCalls.push(...api);await ctx.close();
  });
  await withCheck('vendor shortage uses live vendor ID and exact agreed cost',async()=>{
    const ctx=await browser.newContext({viewport:{width:1024,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/pos');await page.locator('[data-live-pos]').waitFor();
    await page.locator('[data-live-pos] button').filter({hasText:'PVC Pipe 20mm'}).first().click();
    await page.getByRole('spinbutton',{name:'Quantity for PVC Pipe 20mm'}).fill('5');
    await page.getByRole('button',{name:'Resolve stock shortage'}).click();
    await page.getByRole('radio',{name:/Vendor/}).click();
    await page.getByRole('textbox',{name:'New vendor name'}).fill('UI Quick Vendor');
    await page.getByRole('textbox',{name:'New vendor phone'}).fill('01000000222');
    await page.getByRole('button',{name:'+ Add & select vendor'}).click();
    await page.getByRole('combobox',{name:'Select live vendor'}).selectOption('VEN-UI-2');
    await page.getByRole('spinbutton',{name:'Vendor unit cost'}).fill('35');
    await page.getByRole('button',{name:'Use vendor'}).click();
    await page.locator('input[list="live-pos-customer-names"]').fill('UI Vendor Buyer');
    await page.locator('input[list="live-pos-customer-phones"]').fill('01000000003');
    await page.getByRole('spinbutton',{name:/Amount received/}).fill('275');
    await page.getByRole('button',{name:'Review and post real sale'}).click();
    await page.getByRole('button',{name:'Confirm and post'}).click();
    await page.getByText('Sale posted successfully').waitFor({timeout:12000});
    const payload=api.find(x=>x.method==='ASSERT'&&x.path==='/api/pos/sales')?.payload;
    assert.equal(payload.items[0].fulfillmentMode,'vendor');
    assert.equal(payload.items[0].vendorId,'VEN-UI-2');
    assert.equal(api.filter(x=>x.path==='/api/pos/vendors'&&x.method==='POST').length,1);
    assert.equal(payload.items[0].vendorUnitCost,35);
    results.apiCalls.push(...api);await screenshot(page,'phase13-pos-vendor-1024');
    await ctx.close();
  });
  for(const width of [390,768,1440]){
    await withCheck('mixed-unit partial return '+width+' historical prices and compact UI',async()=>{
      const ctx=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
      const api=[];await startMocking(ctx,api);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();page.on('dialog',dialog=>void dialog.accept());
      await page.goto(base+'/#/app/live-sales-returns');await page.locator('[data-live-sales-returns]').waitFor();
      await page.getByRole('textbox',{name:'Search saved invoices'}).fill('MIXED');
      await page.getByRole('button',{name:'Search',exact:true}).click();
      await page.getByRole('button',{name:/UI-E2E-MIXED/}).click();
      await page.getByRole('spinbutton',{name:'Return Box for Carton Test Cable'}).fill('1');
      await page.getByRole('spinbutton',{name:'Return Pcs for Carton Test Cable'}).fill('1');
      const panel=page.locator('[data-live-sales-returns]');
      assert.ok((await panel.innerText()).includes('190'),'exact original Box+Pcs historical refund');
      await screenshot(page,'phase3c-mixed-unit-return-'+width);
      await page.getByPlaceholder('Why was this returned?').fill('Partial return');
      await page.getByRole('button',{name:'Review real return'}).click();
      await page.getByRole('button',{name:'Confirm & refund'}).click();
      await page.getByText('SRT-UI-MIXED-001').waitFor({timeout:12000});
      assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-returns').length,1);
      results.apiCalls.push(...api);await ctx.close();
    });
  }
  await withCheck('mixed full invoice reversal requires preview, reason, explicit cashier confirmation',async()=>{
    const ctx=await browser.newContext({viewport:{width:768,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    page.on('dialog',d=>void d.accept());
    await page.goto(base+'/#/app/live-sales-returns');
    await page.locator('[data-live-sales-returns]').waitFor();
    await page.getByRole('textbox',{name:'Search saved invoices'}).fill('MIXED');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('button',{name:/UI-E2E-MIXED/}).click();
    await page.locator('[data-mixed-full-reversal]').waitFor();
    await page.getByRole('button',{name:'Check full reversal'}).click();
    await page.getByText(/Remaining: 1 lines/).waitFor();
    await page.getByText(/Already refunded:/).waitFor();
    const reversalButton=page.getByRole('button',{name:'Review and reverse entire invoice'});
    assert.equal(await reversalButton.isDisabled(),true);
    await page.getByRole('textbox',{name:'Full invoice reversal reason'}).fill('Original customer requested a corrected sale');
    await screenshot(page,'phase3d-full-invoice-reversal');
    await reversalButton.click();
    await page.getByText('SRT-UI-REVERSE-0001').waitFor({timeout:12000});
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-management/UI-E2E-MIXED/reverse').length,1);
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-returns').length,0);
    assert.equal(api.filter(x=>x.method==='ASSERT'&&x.path==='/api/sales-management/UI-E2E-MIXED/reverse').length,1);
    results.apiCalls.push(...api);await ctx.close();
  });
  await withCheck('bank full reversal shows original account and confirms one bank refund',async()=>{
    const ctx=await browser.newContext({viewport:{width:768,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();page.on('dialog',d=>void d.accept());
    await page.goto(base+'/#/app/live-sales-returns');
    await page.locator('[data-live-sales-returns]').waitFor();
    await page.getByRole('textbox',{name:'Search saved invoices'}).fill('BANK-REV');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('button',{name:/UI-E2E-BANK-REV/}).click();
    await page.getByRole('button',{name:'Check full reversal'}).click();
    await page.locator('[data-reversal-bank-account]').waitFor();
    assert.match(await page.locator('[data-reversal-bank-account]').innerText(),/Current Bank/);
    assert.match(await page.locator('[data-mixed-full-reversal]').innerText(),/Bank refund/);
    await page.getByRole('textbox',{name:'Full invoice reversal reason'}).fill('Refund via original bank after full cancellation');
    await screenshot(page,'phase3f-bank-reversal-original-account');
    await page.getByRole('button',{name:'Review and reverse entire invoice'}).click();
    await page.getByText('SRT-UI-BANK-REV-1').waitFor({timeout:12000});
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-management/UI-E2E-BANK-REV/reverse').length,1);
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-returns').length,0);
    results.apiCalls.push(...api);await ctx.close();
  });
  await withCheck('unpaid mixed invoice reversal cancels customer due and never claims a cash refund',async()=>{
    const ctx=await browser.newContext({viewport:{width:768,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    let confirmation='';
    page.on('dialog',d=>{confirmation=d.message();void d.accept()});
    await page.goto(base+'/#/app/live-sales-returns');
    await page.locator('[data-live-sales-returns]').waitFor();
    await page.getByRole('textbox',{name:'Search saved invoices'}).fill('DUE-REV');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('button',{name:/UI-E2E-DUE-REV/}).click();
    await page.getByRole('button',{name:'Check full reversal'}).click();
    await page.locator('[data-reversal-due-notice]').waitFor();
    assert.match(await page.locator('[data-reversal-due-notice]').innerText(),/No cash refund/);
    assert.match(await page.locator('[data-mixed-full-reversal]').innerText(),/Due to cancel/);
    await page.getByRole('textbox',{name:'Full invoice reversal reason'}).fill('Customer cancelled entire unpaid original invoice');
    await screenshot(page,'phase3g-full-unpaid-due-cancellation');
    await page.getByRole('button',{name:'Review and reverse entire invoice'}).click();
    await page.getByText('SRT-UI-DUE-REV-1').waitFor({timeout:12000});
    assert.match(confirmation,/cancel customer due/i);
    assert.doesNotMatch(confirmation,/cash refund/i);
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-management/UI-E2E-DUE-REV/reverse').length,1);
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-returns').length,0);
    results.apiCalls.push(...api);await ctx.close();
  });
  await withCheck('Sales Return uses saved invoice/serial and posts one real return',async()=>{
    const ctx=await browser.newContext({viewport:{width:390,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();page.on('dialog',d=>void d.accept());
    await page.goto(base+'/#/app/live-sales-returns');
    await page.locator('[data-live-sales-returns]').waitFor({timeout:10000});
    await page.getByRole('textbox',{name:'Search saved invoices'}).fill('UI-E2E-RET-INVOICE');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('button',{name:/UI-E2E-RET-INVOICE/}).click();
    await page.getByRole('spinbutton',{name:'Return quantity for Serial Tracked Motor'}).fill('1');
    await page.getByRole('button',{name:/Serial \/ IMEI/}).click();
    await page.getByRole('button',{name:/SN-UI-001/}).click();
    await page.getByRole('button',{name:'Use serials'}).click();
    await page.getByPlaceholder('Why was this returned?').fill('Damaged after sale');
    await page.getByRole('button',{name:'Review real return'}).click();
    await page.getByRole('button',{name:'Confirm & refund'}).click();
    await page.getByText('SRT-UI-E2E-001').waitFor({timeout:12000});
    assert.equal(api.filter(x=>x.path==='/api/sales-returns'&&x.method==='POST').length,1);
    await screenshot(page,'phase13-sales-return-390');
    results.apiCalls.push(...api);await ctx.close();
  });
}finally{
  try{await browser?.close()}catch{}
  server.kill('SIGTERM');
  results.finishedAt=new Date().toISOString();
  writeFileSync(join(out,'ui-check-results.json'),JSON.stringify(results,null,2));
  writeFileSync(join(out,'server.log'),serverLogs.slice(-10000));
}
process.stdout.write('UI checks: '+results.passed.length+' passed / '+results.failed.length+' failed; '+
  results.screenshots.length+' screenshots; '+results.accessibility.length+' accessibility audits.\n');
if(results.consoleErrors.length)results.failed.push({name:'Browser runtime errors',error:results.consoleErrors.join('\n')});
if(results.failed.length)process.exitCode=1;
