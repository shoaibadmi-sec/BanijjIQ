import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDashboardMetrics,visibleSales,visibleDues,recentSalesFrom} from '../overlay/src/integration/dashboardModel.mjs';
test('recent source rows stay inside the reporting API 365-day maximum',()=>{
 const from=recentSalesFrom('2026-10-30');
 assert.equal(from,'2025-10-31');
 assert.equal((Date.parse('2026-10-30')-Date.parse(from))/86400000,364);
});

const metric=(key,status,valueMinor)=>({key,status,valueMinor,reason:'source verified',asOf:'2026-10-30',sources:[]});
test('dashboard numbers come from reporting evidence; unverified profits and failed requests show unavailable, not samples',()=>{
 const data=loadDashboardMetrics([
   metric('netSales','ready',218400),metric('grossProfit','incomplete',999900),
   metric('receivablesBalance','needs-review',2555000),metric('payablesBalance','needs-review',3840000),
   metric('cashBookBalance','needs-review',500000)
 ],[{productId:'p1',currentStock:2,minimumStock:5,status:'Active'},{productId:'p2',currentStock:9,minimumStock:5,status:'Active'}]);
 assert.equal(data['today-sales'].amount,2184);
 assert.equal(data['gross-profit'].amount,null);
 assert.equal(data.receivable.amount,25550);
 assert.equal(data.payable.amount,38400);
 assert.equal(data.cash.amount,5000);
 assert.equal(data['low-stock'].amount,1);
 assert.equal(loadDashboardMetrics([],null).cash.amount,null);
 assert.equal(loadDashboardMetrics([metric('netSales','needs-review',218400)],null)['today-sales'].amount,null);
});
test('invoice rows are source-linked, not labeled paid or due from unverified sale totals',()=>{
 const result=visibleSales([{sourceId:'INV-0001',sourceModule:'sales',date:'2026-10-30',label:'Buyer',amountMinor:20050,status:'needs-review'}]);
 assert.deepEqual(result,[{id:'INV-0001',customer:'Buyer',date:'2026-10-30',amount:200.5}]);
 assert.deepEqual(visibleSales([{sourceId:'WRONG',sourceModule:'products',amountMinor:100}]),[]);
});
test('dues have current balances but no fabricated overdue days',()=>{
 const result=visibleDues([{sourceId:'CUS-1',sourceModule:'customers',date:'2026-10-30',label:'Buyer',amountMinor:2555000,status:'needs-review'}]);
 assert.deepEqual(result,[{id:'CUS-1',name:'Buyer',amount:25550}]);
 assert.deepEqual(visibleDues([{sourceId:'CUS-1',sourceModule:'customers',label:'Buyer',amountMinor:null,status:'incomplete'}]),[]);
});