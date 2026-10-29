import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { PageHeader } from '../../components/PageHeader';
import type { BackendProduct, BasicProductInput, ProductCatalogEdit } from '../banijjApi';
import { BackendRequestError } from '../banijjApi';
import type { Lookup } from './productContracts';
import { createPayload, draftFromProduct, editPayload, type ProductDraft, type ProductField } from './productForm';
import { LiveProductUnitSettings } from './LiveProductUnitSettings';

type Lookups={categories:Lookup[];brands:Lookup[];units:Lookup[]};
type Props={
  product:BackendProduct|null; lookups:Lookups;onCancel:()=>void;onSaved:(id:string)=>void;
  onCreate:(payload:BasicProductInput)=>Promise<{ok:true;productId:string}>;
  onEdit:(id:string,payload:ProductCatalogEdit)=>Promise<{ok:true;productId:string}>;
};
const fields:Array<{key:ProductField;label:string;bn:string;type?:'number';optional?:boolean;hint?:string}>=[
  {key:'productName',label:'Product name',bn:'পণ্যের নাম'},
  {key:'brand',label:'Brand',bn:'ব্র্যান্ড',optional:true},
  {key:'category',label:'Category',bn:'ধরন'},
  {key:'unit',label:'Base unit',bn:'একক'},
  {key:'purchasePrice',label:'Purchase price',bn:'কেনা দাম',type:'number'},
  {key:'sellingPrice',label:'Selling price',bn:'বিক্রির দাম',type:'number'},
  {key:'currentStock',label:'Opening stock',bn:'শুরুর মজুদ',type:'number'},
  {key:'minimumStock',label:'Minimum stock',bn:'সর্বনিম্ন মজুদ',type:'number'},
  {key:'barcode',label:'Barcode',bn:'বারকোড',optional:true}
];
export function MohimProductEditor({product,lookups,onCancel,onSaved,onCreate,onEdit}:Props){
  const [draft,setDraft]=useState<ProductDraft>(()=>draftFromProduct(product));
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [outcomeUnknown,setOutcomeUnknown]=useState(false);
  const savingRef=useRef(false);
  const original=useRef(draftFromProduct(product));
  const dirty=JSON.stringify(original.current)!==JSON.stringify(draft);
  useEffect(()=>{
    if(!dirty)return;
    const handler=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',handler);
    return()=>window.removeEventListener('beforeunload',handler);
  },[dirty]);
  const cancel=()=>{
    if(savingRef.current)return;
    if(dirty&&!window.confirm('Discard unsaved product changes? · পরিবর্তন বাতিল করবেন?'))return;
    onCancel();
  };
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    if(savingRef.current||outcomeUnknown)return;
    let input:BasicProductInput|ProductCatalogEdit;
    try{input=product?editPayload(product,draft):createPayload(draft);}
    catch(err){setError(err instanceof Error?err.message:'Check product fields');return;}
    savingRef.current=true;setSaving(true);setError('');
    try{
      const result=product
        ?await onEdit(product.productId,input as ProductCatalogEdit)
        :await onCreate(input as BasicProductInput);
      // onSaved only after the hook has awaited the actual API and the refreshed catalog.
      original.current=draft;
      onSaved(result.productId);
    } catch(err){
      let message=err instanceof Error?err.message:'Could not save product.';
      if(err instanceof BackendRequestError&&(err.status===null||err.status>=500)){
        setOutcomeUnknown(true);
        message='Save status unknown. Return to Products and check for this record before any new save. '+message;
      }
      if(product&&err instanceof BackendRequestError&&err.status===409)
        message='Another change was saved. Refresh the product before editing. '+message;
      setError(message);
    }finally{savingRef.current=false;setSaving(false);}
  };
  const change=(key:ProductField,value:string)=>setDraft(p=>({...p,[key]:value}));
  return <section className="mx-auto max-w-[1080px] space-y-4" data-live-product-editor data-mohim-editor>
    <PageHeader title={product?'Edit product':'Add product'} titleBn={product?'পণ্য সংশোধন':'নতুন পণ্য'}
      description="Product details, prices and stock · পণ্যের তথ্য"
      actions={<Button variant="outline" size="sm" disabled={saving} onClick={cancel}>
        <ArrowLeft className="size-4"/>Back to products</Button>}/>
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {fields.map(field=>{
          const locked=Boolean(product&&(field.key==='unit'||field.key==='currentStock'));
          const choices=field.key==='category'?lookups.categories
            :field.key==='brand'?lookups.brands:field.key==='unit'?lookups.units:[];
          const listId=choices.length?'product-lookup-'+field.key:undefined;
          return <label key={field.key} className={field.key==='productName'?'sm:col-span-2 block':'block'}>
            <span className="mb-1 flex items-baseline gap-1.5 text-[13px] font-medium text-ink-700">
              {field.label}{!field.optional&&<span aria-hidden="true" className="text-danger">*</span>}
              <span className="font-bn text-[11px] font-normal text-ink-500">{field.bn}</span>
            </span>
            <Input name={field.key} aria-label={field.label}
              type={field.type??'text'} inputMode={field.type?'decimal':undefined}
              step={field.type?'0.0001':undefined} min={field.type?'0':undefined}
              list={listId} required={!field.optional} readOnly={locked} disabled={saving}
              value={draft[field.key]}
              onChange={e=>change(field.key,e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] font-normal text-ink focus-visible:ring-2 focus-visible:ring-teal-500/30"/>
            {listId&&<datalist id={listId}>{choices.map(item=>
              <option key={item.id} value={item.name}/>)}</datalist>}
            {locked&&<span className="mt-1 block text-[11px] font-normal text-ink-500">
              {field.key==='currentStock'?'Current stock is read-only. Use Adjust Stock from Actions.':'Base unit cannot change after product creation.'}
            </span>}
          </label>;
        })}
      </div>
            {product&&<p className="mt-3 text-xs text-ink-500">
        Editing prices never changes existing stock lots or sale history.
      </p>}
      <p className="mt-3 text-xs text-ink-500">
        Multiple selling units are configured below after saving the product. Bundle, warranty, serial and expiry setup are not available in this form.
      </p>
      {error&&<div role="alert" className="mt-3 rounded-lg border border-danger/20 bg-danger-bg p-2.5 text-sm text-danger">{error}</div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" disabled={saving} onClick={cancel}>Cancel</Button>
        <Button type="submit" disabled={saving||outcomeUnknown} aria-label={product?'Save changes':'Save product'}>
          {saving?<Loader2 className="size-4 animate-spin"/>:<Save className="size-4"/>}
          {saving?'Saving…':product?'Save changes':'Save product'}
        </Button>
      </div>
    </form>
    {product
      ? <LiveProductUnitSettings product={product} units={lookups.units}/>
      : <p className="text-xs text-ink-500">Save the product first, then open Edit Product to configure 2–4 selling units.</p>}
  </section>;
}
