import {createHash} from 'node:crypto';

const EXPECTED_BLOB='07e390deaabee98d137579b5cdb03ff59d6d6f5b';
const exact=(source,from,to,label)=>{
 const at=source.indexOf(from);
 if(at<0||source.indexOf(from,at+1)!==-1)throw new Error('Pinned ProductSettings source mismatch: '+label);
 return source.slice(0,at)+to+source.slice(at+from.length);
};
/** Patch only a generated build copy; original HisabIQ_UI JSX is authoritative. */
export function patchLiveProductSettings(source){
 const sha=createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex');
 if(sha!==EXPECTED_BLOB)throw new Error('Original ProductSettings source changed; refuse unknown JSX.');
 let output=exact(source,
  "import React, { useState } from 'react';",
  "import React, { useState, useEffect } from 'react';",'React hooks');
 output=exact(output,
  "import {\n  availableProductCategories, availableProductBrands, availableProductUnits,\n  createPreviewProductCategory, createPreviewProductBrand, createPreviewProductUnit\n} from '../../data/erpDemoStore';",
  "import {loadProductSettingsLookups,createProductSettingsLookup,setProductSettingsLookupStatus,deleteProductSettingsLookup} from '../../integration/products/productSettingsApi';\nimport type {LookupKind} from '../../integration/products/productSettingsApi';",
  'D1 lookup transport');
 const examples=output.indexOf('const initialCategories: NamedSetting[] = [');
 const actions=output.indexOf('function SettingActions({',examples);
 if(examples<0||actions<examples)throw new Error('Source preview settings arrays changed');
 output=output.slice(0,examples)+output.slice(actions);
 const start=output.indexOf('export function ProductSettings() {');
 const end=output.indexOf('  const tabs: Array<[SettingsTab, string, React.ElementType]> = [',start);
 if(start<0||end<=start)throw new Error('Pinned ProductSettings controller changed');

 const controller="export function ProductSettings() {\n  const {language}=useUiCopy();\n  const pl=(english:string)=>productFormLabel(language,english);\n  const [searchParams] = useSearchParams();\n  const { state } = useTenantSettings();\n  const [tab, setTab] = useState<SettingsTab>(() => ['categories','units','brands'].includes(searchParams.get('tab') || '') ? searchParams.get('tab') as SettingsTab : 'categories');\n  const [categories, setCategories] = useState<NamedSetting[]>([]);\n  const [units, setUnits] = useState<UnitSetting[]>([]);\n  const [brands, setBrands] = useState<NamedSetting[]>([]);\n  const [newName, setNewName] = useState('');\n  const [newBn, setNewBn] = useState('');\n  const [newSymbol, setNewSymbol] = useState('');\n  const [loading,setLoading] = useState(true);\n  const [pending,setPending] = useState(false);\n\n  const refreshLookups=async()=>{\n    const data=await loadProductSettingsLookups();\n    setCategories(data.categories);\n    setBrands(data.brands);\n    setUnits(data.units);\n  };\n  useEffect(()=>{\n    let active=true;\n    loadProductSettingsLookups()\n      .then(data=>{if(active){setCategories(data.categories);setBrands(data.brands);setUnits(data.units);}})\n      .catch(error=>{if(active)toast.error(error instanceof Error?error.message:'Could not read live product settings');})\n      .finally(()=>{if(active)setLoading(false);});\n    return()=>{active=false;};\n  },[]);\n  const clearNew=()=>{\n    setNewName('');\n    setNewBn('');\n    setNewSymbol('');\n  };\n  const apply=async(action:()=>Promise<void>,success:string,onSuccess?:()=>void)=>{\n    if(loading||pending)return;\n    setPending(true);\n    try{\n      await action();\n      await refreshLookups();\n      onSuccess?.();\n      toast.success(success);\n    }catch(error){\n      toast.error(error instanceof Error?error.message:'D1 settings change not confirmed');\n    }finally{\n      setPending(false);\n    }\n  };\n  const addNamed=()=>{\n    if(!newName.trim()||loading||pending)return;\n    const kind:LookupKind=tab==='categories'?'category':tab==='brands'?'brand':'unit';\n    void apply(()=>createProductSettingsLookup({\n      kind,name:newName.trim(),\n      ...(kind==='unit'?{symbol:newSymbol.trim()||newName.trim()}:{nameBn:newBn.trim()})\n    }),newName.trim()+' added to product settings',clearNew);\n  };\n  const toggleNamed=(kind:LookupKind,item:NamedSetting)=>{\n    void apply(()=>setProductSettingsLookupStatus(kind,item.id,item.active?'Inactive':'Active'),\n      item.name+' status updated');\n  };\n  const removeNamed=(kind:LookupKind,item:NamedSetting)=>{\n    if(item.usage>0){toast.error(item.name+' is used by products');return;}\n    void apply(()=>deleteProductSettingsLookup(kind,item.id),item.name+' removed');\n  };\n";

 output=output.slice(0,start)+controller+output.slice(end);
 const changes=[
  ["onToggle={() => setCategories((items) => items.map((value) => value.id === item.id ? { ...value, active: !value.active } : value))}","onToggle={() => toggleNamed('category', item)}"],
  ["onDelete={() => item.usage > 0 ? toast.error(pl('Category is used by products')) : setCategories((items) => items.filter((value) => value.id !== item.id))}","onDelete={() => removeNamed('category', item)}"],
  ["onToggle={() => setUnits((items) => items.map((value) => value.id === item.id ? { ...value, active: !value.active } : value))}","onToggle={() => toggleNamed('unit', item)}"],
  ["onDelete={() => item.usage > 0 ? toast.error(pl('Unit is used by products')) : setUnits((items) => items.filter((value) => value.id !== item.id))}","onDelete={() => removeNamed('unit', item)}"],
  ["onToggle={() => setBrands((items) => items.map((value) => value.id === item.id ? { ...value, active: !value.active } : value))}","onToggle={() => toggleNamed('brand', item)}"],
  ["onDelete={() => item.usage > 0 ? toast.error(pl('Brand is used by products')) : setBrands((items) => items.filter((value) => value.id !== item.id))}","onDelete={() => removeNamed('brand', item)}"]
 ];
 for(const [from,to] of changes)output=exact(output,from,to,'original lookup action');
 output=exact(output,
  '<Button size="sm" onClick={addNamed} disabled={!newName.trim()}>',
  '<Button size="sm" onClick={addNamed} disabled={!newName.trim()||pending||loading}>',
  'wait for server before write');
 for(const forbidden of ['initialCategories','initialUnits','initialBrands','availableProductCategories','createPreviewProductCategory','createPreviewProductBrand','createPreviewProductUnit'])
  if(output.includes(forbidden))throw new Error('Unsafe preview settings remain: '+forbidden);
 return output;
}
