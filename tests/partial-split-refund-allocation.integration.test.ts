import test from 'node:test';
import assert from 'node:assert/strict';

const module=await import('../server/modules/sales/partial-split-refunds.ts')
  .catch(()=>({} as any));
const allocate=(module as any).allocatePartialSplitRefund as
  ((original:readonly {sourceKey:string;amountCents:number}[],
    refunded:readonly {sourceKey:string;amountCents:number}[],
    requested:number)=>readonly {sourceKey:string;amountCents:number}[]);

const sources=[
  {sourceKey:'Cash',amountCents:2000},
  {sourceKey:'Store Credit',amountCents:3000}
];
const values=(a:readonly {sourceKey:string;amountCents:number}[])=>
  a.map(({sourceKey,amountCents})=>[sourceKey,amountCents]);
const cents=(a:readonly {amountCents:number}[])=>
  a.reduce((n,r)=>n+r.amountCents,0);

test('G2-I proportional refund preserves original sources and returns exact poisha',()=>{
  assert.equal(typeof allocate,'function','missing source-specific partial allocation function (TDD RED)');
  const a=allocate(sources,[],1000);
  assert.deepEqual(values(a),[['Cash',400],['Store Credit',600]]);
  assert.equal(cents(a),1000);
  assert.ok(Object.isFrozen(a)&&a.every(Object.isFrozen),'allocations are immutable');
  const b=allocate(sources,a,1000);
  assert.deepEqual(values(b),[['Cash',400],['Store Credit',600]]);
  const prior=[...a,...b];
  const remainder=allocate(sources,prior,3000);
  assert.deepEqual(values(remainder),[['Cash',1200],['Store Credit',1800]]);
  assert.equal(cents([...prior,...remainder]),5000,'all source liabilities/refunds conserved');
  assert.deepEqual(sources,[{sourceKey:'Cash',amountCents:2000},
    {sourceKey:'Store Credit',amountCents:3000}],'original allocations not mutated');
});

test('G2-I bank/mobile/credit refund preserves exact account source keys',()=>{
  const original=[
    {sourceKey:'Bank:ACCT-1',amountCents:1000},
    {sourceKey:'Mobile Banking:ACCT-2',amountCents:2000},
    {sourceKey:'Store Credit',amountCents:2000}
  ];
  assert.deepEqual(values(allocate(original,[],500)),[
    ['Bank:ACCT-1',100],['Mobile Banking:ACCT-2',200],['Store Credit',200]
  ]);
  assert.deepEqual(values(allocate(original,[{sourceKey:'Bank:ACCT-1',amountCents:1000}],4000)),[
    ['Mobile Banking:ACCT-2',2000],['Store Credit',2000]
  ]);
});

test('G2-I repeated one-poisha refunds have stable tie order and no zero journal row',()=>{
  const original=[
    {sourceKey:'Bank:A',amountCents:1},
    {sourceKey:'Cash',amountCents:1},
    {sourceKey:'Store Credit',amountCents:1}
  ];
  const prior: {sourceKey:string;amountCents:number}[]=[];
  for(const key of ['Bank:A','Cash','Store Credit']){
    const current=allocate(original,prior,1);
    assert.deepEqual(values(current),[[key,1]],'source preference must be deterministic');
    prior.push(...current);
  }
  assert.equal(cents(prior),3);
  assert.throws(()=>allocate(original,prior,1));
});

test('G2-I validates source provenance, monetary bounds, duplicates and prior payouts',()=>{
  const badOriginal=[
    [...sources,{sourceKey:'Cash',amountCents:1}],
    [{sourceKey:'Cash',amountCents:0},{sourceKey:'Store Credit',amountCents:2}],
    [{sourceKey:'Cash',amountCents:1.5},{sourceKey:'Store Credit',amountCents:2}],
    [{sourceKey:'Cash',amountCents:Number.MAX_SAFE_INTEGER},
      {sourceKey:'Store Credit',amountCents:1}]
  ];
  for(const original of badOriginal)
    assert.throws(()=>allocate(original,[],1));
  for(const bad of [0,-1,1.2,Infinity,NaN,5001])
    assert.throws(()=>allocate(sources,[],bad));
  for(const prior of [
    [{sourceKey:'Bank:DIFFERENT',amountCents:1}],
    [{sourceKey:'Cash',amountCents:2001}],
    [{sourceKey:'Cash',amountCents:-1}],
    [{sourceKey:'Cash',amountCents:1.5}]
  ])assert.throws(()=>allocate(sources,prior,1));
  assert.deepEqual(values(allocate(sources,[{sourceKey:'Cash',amountCents:2000}],3000)),
    [['Store Credit',3000]],'never convert exhausted Cash refund to fake Cash');
});

test('G2-I deterministic property sweep: every partial return conserves poisha and never overdrafts its source',()=>{
  // An exhaustive small-money matrix catches allocation/rounding regressions
  // without randomized, flaky tests or a new property-testing dependency.
  for(let cash=1;cash<=6;cash++)for(let credit=1;credit<=6;credit++){
    const original=[
      {sourceKey:'Cash',amountCents:cash},
      {sourceKey:'Store Credit',amountCents:credit}
    ];
    const prior:{sourceKey:string;amountCents:number}[]=[];
    for(let n=0;n<cash+credit;n++){
      const round=allocate(original,prior,1);
      assert.equal(cents(round),1);
      assert.ok(Object.isFrozen(round)&&round.every(Object.isFrozen));
      prior.push(...round);
      for(const source of original){
        const spent=prior.filter(p=>p.sourceKey===source.sourceKey)
          .reduce((sum,p)=>sum+p.amountCents,0);
        assert.ok(spent<=source.amountCents,
          source.sourceKey+' over-refunded '+spent+'/'+source.amountCents);
      }
    }
    assert.equal(cents(prior),cash+credit);
    assert.throws(()=>allocate(original,prior,1),
      'fully refunded invoice must not pay even one additional poisha');
  }
});
