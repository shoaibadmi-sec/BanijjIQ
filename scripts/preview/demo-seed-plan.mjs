/**
 * Converts the pinned HisabIQ UI fixtures to a REAL, limited preview-only dataset.
 * Historical dashboard totals and incompatible split payments are intentionally excluded.
 * Run with node --import tsx; never use a production DB or credentials.
 */
const source=(await Promise.all(['products','parties','sales','purchases','financeAccounts'].map(async file=>{
  const module=await import('../../apps/hisabiq-web/src/data/'+file+'.ts');
  return module.default ?? module['module.exports'] ?? module;
})));
const [catalog,partyData,saleData,purchaseData,financeData]=source;

export function buildDemoSeedPlan(){
  const originals=catalog.products;
  const invoices=saleData.salesInvoices.filter(s=>['s241','s240'].includes(s.id));
  const purchase=purchaseData.purchases.find(p=>p.id==='pu117');
  if(!purchase||invoices.length!==2)throw Error('Pinned HisabIQ fixture changed: review and update seed mapping.');
  const sales=[
    {sourceId:'s241',customerKey:'c1',customerName:'[DEMO] Rahman Hardware',phone:'01099000001',
      paymentType:'Due',paidAmount:0,paymentMethod:'Cash',discount:140,
      lines:[{key:'p3',qty:220,unitPrice:112},{key:'p9',qty:42,unitPrice:25}],expectedTotal:25550},
    {sourceId:'s240',customerName:'[DEMO] Walk-in customer',phone:'01099000010',paymentType:'Cash',paidAmount:0,
      paymentMethod:'Cash',discount:0,
      lines:[{key:'p7',qty:2,unitPrice:650},{key:'p10',qty:4,unitPrice:60},{key:'p9',qty:12,unitPrice:25}],
      expectedTotal:1840}
  ];
  for(const sale of sales){
    const original=invoices.find(s=>s.id===sale.sourceId);
    if(original?.total!==sale.expectedTotal)throw Error('Demo sale amount changed: '+sale.sourceId);
    const quoted=sale.lines.reduce((total,line)=>total+line.qty*line.unitPrice,0)-sale.discount;
    if(quoted!==sale.expectedTotal)throw Error('Demo sale is not reconcilable: '+sale.sourceId);
  }
  const purchases=[{sourceId:purchase.id,supplierKey:'s2',productKey:'p3',qty:800,unitPrice:98,
    paidAmount:40000,paymentMethod:'Bank',accountKey:'acc-dbl',expectedTotal:78400}];
  if(purchase.total!==78400||purchase.paid!==40000)throw Error('Demo supplier purchase changed.');
  const products=originals.filter(p=>p.kind!=='Service').map(p=>{
    const outgoing=sales.flatMap(s=>s.lines).filter(l=>l.key===p.id)
      .reduce((sum,line)=>sum+line.qty,0);
    const incoming=purchases.filter(x=>x.productKey===p.id).reduce((sum,x)=>sum+x.qty,0);
    const openingStock=p.stock+outgoing-incoming;
    if(!Number.isFinite(openingStock)||openingStock<0)throw Error('Unsafe opening stock for '+p.id);
    return {sourceId:p.id,name:'[DEMO] '+p.name,category:p.category,unit:p.unit,barcode:'DEMO-'+(p.sku||p.id),
      brand:'',openingStock,expectedStock:p.stock,minimumStock:p.minStock,
      purchasePrice:p.purchasePrice,sellingPrice:p.sellPrice,status:p.active?'Active':'Inactive'};
  });
  const partners=partyData.parties;
  const customers=partners.filter(p=>p.roles.includes('Customer')).map((p,index)=>({
    sourceId:p.id,name:'[DEMO] '+p.name,phone:'01099'+String(index+1).padStart(6,'0'),address:p.area}));
  const suppliers=partners.filter(p=>p.roles.includes('Supplier')).map((p,index)=>({
    sourceId:p.id,name:'[DEMO] '+p.name,phone:'01097'+String(index+1).padStart(6,'0'),address:p.area}));
  const vendors=partners.filter(p=>p.roles.includes('Vendor')).map((p,index)=>({
    sourceId:p.id,name:'[DEMO] '+p.name,phone:'01098'+String(index+1).padStart(6,'0')}));
  const accounts=financeData.financeAccounts.filter(a=>a.type!=='Cash').map(a=>({
    sourceId:a.id,name:'[DEMO] '+a.name,accountType:a.type,bankName:a.institution,
    accountNumber:a.number,openingBalance:a.openingBalance}));
  const cashAccount=financeData.financeAccounts.find(a=>a.type==='Cash');
  const expense=purchaseData.expenses.find(e=>e.id==='e59');
  if(!expense||expense.amount!==35000||expense.method!=='Bank')throw Error('Demo rent expense changed.');
  return {
    sourceCommit:'0389b179b6fa8e930f64d014c90d1a8785c00664',
    openingCash:cashAccount?.openingBalance??0,products,customers,suppliers,vendors,accounts,purchases,sales,
    expense:{sourceId:expense.id,category:'[DEMO] '+expense.category,payee:'[DEMO] '+expense.payee,
      description:expense.note||'Demo rental expense',amount:expense.amount,accountKey:'acc-dbl'},
    financePeople:financeData.financePeople.filter(p=>p.roles.includes('Owner')||p.roles.includes('Lender'))
      .map((p,index)=>({sourceId:p.id,name:'[DEMO] '+p.name,phone:'01096'+String(index+1).padStart(6,'0'),personType:p.roles.includes('Owner')?'Owner':'Lender'})),
    excluded:[
      'historical dashboard/chart totals are designed values, not journal entries',
      'tracked serial/expiry/warranty details not seeded: product records are untracked test fixtures',
      'source 2026 historical dates are not backposted; transaction dates use the posting day',
      'mixed-method invoices and purchase payments are not imported with invented allocations',
      'partial returns, virtual bundle sample, and source-only purchase descriptions require their own supported workflows',
      'existing customer and supplier opening balances are not forged; dues come from actual test postings',
      'example purchase pu117 paid BDT 40,000 via one bank source (original demo split payment unsupported)'
    ]
  };
}

/**
 * Post through the same authenticated API handlers used by HisabIQ.
 * Append tagged [DEMO] records without overwriting existing preview records; refuse a second import.
 * Failed imports deliberately stop; do not automatically clear an existing database.
 */
export async function executeDemoSeed(api,plan){
  const safe=async(method,path,body)=>{
    const value=await api(method,path,body);
    if(value?.status!==200||value.ok!==true)
      throw Error('Demo seed failed at '+method+' '+path+': '+String(value?.error||value?.status));
    return value;
  };
  const bootstrap=await safe('GET','/api/bootstrap');
  const pos=await safe('GET','/api/pos/bootstrap');
  if(!Array.isArray(bootstrap.products)||!Array.isArray(pos.customers)||
    !Array.isArray(pos.bankAccounts)||!Array.isArray(pos.vendors))
    throw Error('Live backend bootstrap is incomplete; no demo import permitted.');
  const customersPage=await safe('GET','/api/customers');
  const suppliersPage=await safe('GET','/api/suppliers');
  if(!Array.isArray(customersPage.customers)||!Array.isArray(suppliersPage.suppliers))
    throw Error('Cannot verify party tables; no demo import permitted.');
  // Add to populated previews safely, never overwrite existing records or import twice.
  const existing=[
    ...bootstrap.products,...pos.customers,...pos.bankAccounts,...pos.vendors,
    ...customersPage.customers,...suppliersPage.suppliers
  ];
  if(existing.some(record=>Object.values(record).some(value=>
      typeof value==='string'&&(value.startsWith('[DEMO] ')||value.startsWith('DEMO-')))))
    throw Error('Preview database already contains [DEMO] seed data; import twice is unsafe.');
  if(!pos.activeSession)
    await safe('POST','/api/pos/cash-session/start',{openingCash:0});
  const ids={products:new Map(),customers:new Map(),suppliers:new Map(),accounts:new Map()};
  for(const account of plan.accounts){
    const result=await safe('POST','/api/bank/accounts',{
      name:account.name,accountType:account.accountType,bankName:account.bankName,
      accountNumber:account.accountNumber,openingBalance:account.openingBalance,
      notes:'Isolated HisabIQ sample finance account'});
    ids.accounts.set(account.sourceId,result.id);
  }
  for(const customer of plan.customers){
    const result=await safe('POST','/api/customers',{
      name:customer.name,phone:customer.phone,address:customer.address,openingBalance:0,
      notes:'HisabIQ sample party; balance comes from real posted invoices'});
    ids.customers.set(customer.sourceId,result.id);
  }
  for(const supplier of plan.suppliers){
    const result=await safe('POST','/api/suppliers',{
      name:supplier.name,phone:supplier.phone,address:supplier.address,openingBalance:0,
      notes:'HisabIQ sample supplier; balance comes from real posted purchases'});
    ids.suppliers.set(supplier.sourceId,result.id);
  }
  for(const vendor of plan.vendors)
    await safe('POST','/api/pos/vendors',{name:vendor.name,phone:vendor.phone});
  for(const person of plan.financePeople)
    await safe('POST','/api/finance/persons',{
      name:person.name,phone:person.phone,personType:person.personType});
  for(const product of plan.products){
    const result=await safe('POST','/api/products',{
      productName:product.name,category:product.category,unit:product.unit,
      barcode:product.barcode,brand:product.brand,purchasePrice:product.purchasePrice,
      sellingPrice:product.sellingPrice,currentStock:product.openingStock,
      minimumStock:product.minimumStock,status:product.status,
      trackSerial:false,trackExpiry:false,trackWarranty:false
    });
    ids.products.set(product.sourceId,result.productId);
  }
  for(const purchase of plan.purchases){
    const result=await safe('POST','/api/purchases',{
      supplierId:ids.suppliers.get(purchase.supplierKey),
      paymentMethod:purchase.paymentMethod,bankAccountId:ids.accounts.get(purchase.accountKey),
      paidAmount:purchase.paidAmount,
      clientRequestId:'a627b6eb-6bbb-4c9d-a70b-0000000'+purchase.sourceId.replace(/\D/g,'').padStart(5,'0'),
      note:'Imported fixture '+purchase.sourceId+'; single bank payment replaces demo split',
      items:[{productId:ids.products.get(purchase.productKey),qty:purchase.qty,unitPrice:purchase.unitPrice}]
    });
    if(result.grandTotal!==purchase.expectedTotal)throw Error('Purchase amount reconciliation failed');
  }
  for(const sale of plan.sales){
    const result=await safe('POST','/api/pos/sales',{
      clientRequestId:'57d7b770-0000-4b50-8ad4-000000000'+sale.sourceId.replace(/\D/g,'').padStart(3,'0'),
      customerId:sale.customerKey?ids.customers.get(sale.customerKey):undefined,
      customerName:sale.customerName,customerPhone:sale.phone,
      discount:sale.discount,paymentType:sale.paymentType,paidAmount:sale.paidAmount,
      paymentMethod:sale.paymentMethod,
      items:sale.lines.map(line=>({
        productId:ids.products.get(line.key),name:plan.products.find(p=>p.sourceId===line.key)?.name,
        qty:line.qty,unitPrice:line.unitPrice,fulfillmentMode:'own'
      }))
    });
    if(result.invoice?.grandTotal!==sale.expectedTotal)
      throw Error('Invoice amount reconciliation failed: '+sale.sourceId);
  }
  const expenseCategory=await safe('POST','/api/expense-categories',{name:plan.expense.category});
  const expensePayee=await safe('POST','/api/expense-payees',{name:plan.expense.payee});
  await safe('POST','/api/expenses',{
    categoryId:expenseCategory.id,payeeId:expensePayee.id,amount:plan.expense.amount,
    paymentMethod:'Bank',bankAccountId:ids.accounts.get(plan.expense.accountKey),
    description:plan.expense.description,
    notes:'HisabIQ demo source '+plan.expense.sourceId
  });
  const actual=await safe('GET','/api/bootstrap');
  for(const product of plan.products){
    const value=actual.products.find(p=>p.productId===ids.products.get(product.sourceId));
    if(!value||Math.abs(value.currentStock-product.expectedStock)>0.0001)
      throw Error('Post-import stock mismatch for '+product.sourceId);
  }
  return {products:plan.products.length,customers:plan.customers.length,
    suppliers:plan.suppliers.length,vendors:plan.vendors.length,
    accounts:plan.accounts.length,sales:plan.sales.length,
    purchases:plan.purchases.length,expenses:1};
}