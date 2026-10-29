import {createHash} from 'node:crypto';

/** Exact reviewed HisabIQ Products.tsx blob; never patch an unknown upstream revision. */
const SOURCE_BLOB='ffd429f0b65eaee8146ed7089cb9412a78f0e975';
function replaceOnce(input,from,to,label) {
  const start=input.indexOf(from);
  if(start<0 || input.indexOf(from,start+1)>=0)
    throw new Error('Pinned Products source mismatch: '+label);
  return input.slice(0,start)+to+input.slice(start+from.length);
}
function exactSource(source) {
  const sha=createHash('sha1')
    .update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex');
  if(sha!==SOURCE_BLOB)throw new Error('Pinned Products source blob mismatch. Refuse to patch unknown JSX.');
}
const header=String.raw`import {useModuleColumns} from '../settings/useModuleColumns';
import { MotionTabList, MotionTabIndicator } from '../motion/MotionTabList';
import {matchesSearch as fuzzyMatch} from '../utils/fuzzySearch';
import { useSearchParams } from 'react-router-dom';
import { useMemo, useState, useEffect } from 'react';
import { Check, ChevronDown, Download, Upload, Plus, Search } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { ProductThumb } from '../components/ProductThumb';
import { StatusBadge, type StatusTone } from '../components/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/Table';
import { FloatingPanel } from '../components/layout/FloatingPanel';
import type { Product } from '../types/erp';
import { formatStock, stockStatus, type StockStatus } from '../utils/units';
import { taka } from '../utils/currency';
import { downloadReport } from '../utils/reportOutput';
import { useUiCopy } from '../i18n/useUiCopy';
import { productLabel } from '../i18n/productsCopy';
import { canUseModule, useBackendSession } from '../integration/BackendGate';
import { useLiveProducts } from '../integration/products/useLiveProducts';
import { toProductView } from '../integration/products/productContracts';
import { MohimProductEditor } from '../integration/products/MohimProductEditor';
import { MohimProductActions as ProductActions } from '../integration/products/MohimProductActions';

`;
const controller=String.raw`type ProductView = 'list' | 'lots' | 'history' | 'settings';

export function Products() {
  const {language,showHelper}=useUiCopy();
  const pl=(english:string)=>productLabel(language,english);
  const user=useBackendSession();
  const permitted=canUseModule(user,'products','view');
  const canAdd=canUseModule(user,'products','add');
  const canEdit=canUseModule(user,'products','edit');
  const {items,lookups,stockValueByProduct,loading,error,refresh,create,edit,
    adjustStock,setStatus,loadLots,loadHistory,pendingOperation}=useLiveProducts(permitted);
  const list=useMemo<Product[]>(()=>items.map(toProductView),[items]);
  const byId=useMemo(()=>new Map(items.map(p=>[p.productId,p])),[items]);
  const [searchParams,setSearchParams]=useSearchParams();
  const routeQuery=searchParams.get('q')??'';
  const [query,setQuery]=useState(routeQuery);
  useEffect(()=>setQuery(routeQuery),[routeQuery]);
  const [category,setCategory]=useState('All');
  const [stockFilter,setStockFilter]=useState<StockFilter>('all');
  const [view,setView]=useState<ProductView>('list');
  const chooseView=(next:ProductView)=>{if(next==='list'){setView('list');
    setSearchParams(old=>{const params=new URLSearchParams(old);params.delete('view');return params;},{replace:true});}};
  const [editing,setEditing]=useState<undefined|null|typeof items[number]>(undefined);
  const [notice,setNotice]=useState('');
  const {columns:visibleColumns,setColumns:setVisibleColumns}=
    useModuleColumns('products',columnStorageKey,defaultVisibleColumns);
  const toggleColumn=(column:ProductColumn)=>setVisibleColumns(current=>({...current,[column]:!current[column]}));
  const getStatus=(product:Product):StockStatus=>{
    const source=byId.get(product.id);
    return stockStatus({...product,stock:source?.sellableStock??product.stock});
  };
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return list.filter(p=>{
      if(category!=='All'&&p.category!==category)return false;
      const state=getStatus(p);
      if(stockFilter==='low'&&state!=='low')return false;
      if(stockFilter==='out'&&state!=='out')return false;
      return !q||fuzzyMatch(q,[p.name,p.nameBn,p.sku,p.brand,p.category,p.unit]);
    });
  },[list,query,category,stockFilter,byId]);
  const valuations=list.map(p=>stockValueByProduct[p.id]??null);
  const stockValue=valuations.every(v=>v!==null)
    ?valuations.reduce<number>((sum,value)=>sum+(value??0),0):null;
  const lowCount=list.filter(p=>getStatus(p)==='low').length;
  const outCount=list.filter(p=>getStatus(p)==='out').length;
  const summary=[
    {label:'Products',value:String(list.length),sub:String(list.filter(p=>p.active).length)+' '+pl('active')},
    {label:'Stock value',value:stockValue===null?'—':taka(stockValue),sub:'D1 stock valuation'},
    {label:'Low stock',value:String(lowCount),sub:'Below minimum',tone:'text-warning'},
    {label:'Out of stock',value:String(outCount),sub:'Needs reorder',tone:'text-danger'}
  ];
  if(editing!==undefined)return <MohimProductEditor key={editing?.productId??'new'}
    product={editing} lookups={lookups} onCreate={create} onEdit={edit}
    onCancel={()=>setEditing(undefined)}
    onSaved={productId=>{setEditing(undefined);setNotice('Product saved to BanijjIQ · '+productId);}}/>;
  if(!permitted)return <section role="alert" className="rounded-xl border border-danger bg-danger-bg p-4 text-sm text-danger">
    You do not have permission to view products. · পণ্য দেখার অনুমতি নেই
  </section>;

`;
export function patchLiveProducts(source) {
  if(typeof source!=='string')throw new Error('Pinned Products source must be text');
  exactSource(source);
  const blockStart=source.indexOf('const statusMeta:');
  const actionStart=source.indexOf('function ProductActions(');
  const pageStart=source.indexOf('export function Products() {');
  const jsxStart=source.indexOf('  return (\n    <div className="mx-auto max-w-[1440px] space-y-4">',pageStart);
  const afterList=source.indexOf("\n       {view === 'lots'",jsxStart);
  if([blockStart,actionStart,pageStart,jsxStart,afterList].some(n=>n<0)
     ||!(blockStart<actionStart&&actionStart<pageStart&&pageStart<jsxStart&&jsxStart<afterList))
    throw new Error('Pinned Products source JSX anchors changed');
  // Keep original column picker, status badges, table classes, tabs and list JSX intact.
  const primitives=source.slice(blockStart,actionStart);
  let jsx=source.slice(jsxStart,afterList);
  jsx=replaceOnce(jsx,
    '    <div className="mx-auto max-w-[1440px] space-y-4">',
    '    <div className="mx-auto max-w-[1440px] space-y-4" data-live-products>','live root');
  jsx=replaceOnce(jsx,
    '      <PageHeader',
    `      {notice&&<p role="status" className="rounded-lg bg-success-bg p-2 text-xs text-success">{notice}</p>}
      {error&&<p role="alert" className="rounded-lg bg-danger-bg p-2 text-xs text-danger">{error}</p>}
      {loading&&<p role="status" className="p-2 text-xs text-ink-500">Loading live products…</p>}
      <PageHeader`,'live fetch state');
  jsx=replaceOnce(jsx,
    "onClick={() => setImportOpen(true)}",
    'disabled title="Import is disabled until the live D1 import workflow is verified"','unsafe import');
  jsx=replaceOnce(jsx,
    'onClick={()=>{setBundleEditorProduct(null);setCreatingBundle(true);}}',
    'disabled title="Bundle creation is not enabled in this React migration"','unsafe bundle create');
  jsx=replaceOnce(jsx,
    'onClick={() => { setEditingProduct(null); setDialogOpen(true); }}',
    'disabled={!canAdd||pendingOperation!==null} onClick={()=>setEditing(null)}','live Add product');
  jsx=replaceOnce(jsx,
    "onClick={() => chooseView(id)}",
    `disabled={id!=='list'} title={id!=='list'?'Use a product row Actions menu for real lots and history; settings are not connected.':undefined}
             onClick={() => chooseView(id)}`,'deferred tabs');
  jsx=replaceOnce(jsx,
    "availableProductCategories().map((c) =>",
    "['All',...new Set([...lookups.categories.map(c=>c.name),...list.map(p=>p.category).filter(Boolean)])].map((c) =>",
    'API category tabs');
  jsx=replaceOnce(jsx,
    "const projection = p.kind==='Bundle' ? (getBundleVersion(p.id) ? getBundleProjection(getBundleVersion(p.id)!,list,lots) : null) : null;",
    "// Non-integrated bundles are rejected by the catalog adapter.",
    'preview bundle projection');
  jsx=replaceOnce(jsx,
    "const s = p.kind==='Bundle' ? (!p.active?'inactive':(projection?.availableSets ?? 0)>0?'in':'out') : stockStatus(p);",
    'const s = getStatus(p);','live stock status');
  jsx=replaceOnce(jsx,
    'const rowStockValue = bundleInventoryValue(p);',
    'const rowStockValue = stockValueByProduct[p.id]??null;','genuine D1 stock valuation');
  jsx=replaceOnce(jsx,
    "p.kind==='Bundle' ? (projection?.availableSets??0)+' Set' : formatStock(p)",
    'formatStock(p)','display current D1 stock');
  jsx=replaceOnce(jsx,
    "p.kind === 'Service' || p.kind === 'Bundle' ? '—' : taka(rowStockValue, rowStockValue % 1 ? 2 : 0)",
    "rowStockValue===null ? '—' : taka(rowStockValue,rowStockValue%1?2:0)",
    'nullable D1 valuation');
  const rowActionStart=jsx.indexOf('                    <ProductActions\n');
  const actionEnd=jsx.indexOf('\n                    />',rowActionStart);
  if(rowActionStart<0||actionEnd<0)throw new Error('Pinned Products row action block missing');
  const safeActions=String.raw`                    <ProductActions
                      product={byId.get(p.id)!}
                      compact
                      canEdit={canEdit}
                      onEdit={()=>setEditing(byId.get(p.id)!)}
                      onChanged={()=>setNotice('Product updated · '+p.name)}
                      onAdjustStock={adjustStock} onSetStatus={setStatus}
                      loadLots={loadLots} loadHistory={loadHistory}`;
  jsx=jsx.slice(0,rowActionStart)+safeActions+jsx.slice(actionEnd);
  const compiled=header+primitives+controller+jsx+"\n    </div>);\n}\n";
  const forbidden=[
    'availableProducts(', 'availableProductCategories(', 'availableStockLots(',
    'availableStockMovements(', 'salesInvoices', 'upsertProductPreview',
    'upsertBundlePreview','commitProductImportPreview','setList(',
    'getBundleVersion(', 'bundleInventoryValue(', 'ImportWizard',
    'StockLotDialog','ManageOffersDialog','productOffers as seedOffers'
  ];
  for(const key of forbidden)if(compiled.includes(key))
    throw new Error('Generated live Products still refers to unsafe preview state: '+key);
  for(const key of ['      <PageHeader','      <MotionTabList className=',
    '            <ProductColumnPicker visible={visibleColumns} onToggle={toggleColumn} />',
    '                    <ProductActions', '                <TableRow key={p.id} className="text-[13px]">'])
    if(!compiled.includes(key))throw new Error('Protected Products JSX was lost: '+key);
  return compiled;
}
