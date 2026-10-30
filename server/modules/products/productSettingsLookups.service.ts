import type {SherDatabase} from '../../db/types.js';

type LookupRow={id:string;name:string;status:string;symbol?:string};
type ProductRow={productId:string;category:string;brand:string;unit:string};
type ProfileRow={productId:string;profileJson:string};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8'}
});
const key=(value:string)=>value.trim().toLocaleLowerCase('en');

function parseProfile(row:ProfileRow,baseUnit:string):string[] {
  let profile:unknown;
  try{profile=JSON.parse(row.profileJson);}catch{return [];}
  if(!profile||typeof profile!=='object'||!('units' in profile)||
      !Array.isArray(profile.units)||profile.units.length<2||profile.units.length>4)
    return [];
  const names=profile.units.map((u:unknown)=>u&&typeof u==='object'&&'unit' in u?(u as {unit:unknown}).unit:null);
  if(names.some((name:unknown)=>typeof name!=='string'||!name.trim())||
      new Set(names.map((name)=>key(String(name)))).size!==names.length||
      !names.some((name)=>key(String(name))===key(baseUnit))||
      !('baseUnit' in profile)||typeof profile.baseUnit!=='string'||key(profile.baseUnit)!==key(baseUnit))
    return [];
  return names as string[];
}

/**
 * Read-only D1 source for the original ProductSettings Categories/Units/Brands rows.
 * Missing or corrupted saved unit chains are errors, not fake zero usage.
 */
export async function getProductSettingsLookupsRoute(db:SherDatabase):Promise<Response>{
  const [categories,brands,units,products,profiles]=await Promise.all([
    db.prepare("SELECT category_id AS id,category_name AS name,status FROM product_categories ORDER BY category_name COLLATE NOCASE,id").all<LookupRow>(),
    db.prepare("SELECT brand_id AS id,brand_name AS name,status FROM product_brands ORDER BY brand_name COLLATE NOCASE,id").all<LookupRow>(),
    db.prepare("SELECT unit_id AS id,unit_name AS name,status,symbol FROM product_units ORDER BY unit_name COLLATE NOCASE,id").all<LookupRow>(),
    db.prepare("SELECT product_id AS productId,category,brand,unit FROM products WHERE is_deleted=0").all<ProductRow>(),
    db.prepare("SELECT up.product_id AS productId,up.profile_json AS profileJson FROM product_unit_profiles up JOIN products p ON p.product_id=up.product_id WHERE p.is_deleted=0").all<ProfileRow>()
  ]);
  const active=products.results??[];
  const profileById=new Map((profiles.results??[]).map(p=>[p.productId,p]));
  const categoryUsage=new Map<string,number>(),brandUsage=new Map<string,number>();
  const unitUsage=new Map<string,number>(),multiUnitNames=new Set<string>();
  const increment=(map:Map<string,number>,v:string)=>{
    const normalized=key(v);
    if(normalized)map.set(normalized,(map.get(normalized)??0)+1);
  };
  for(const product of active){
    increment(categoryUsage,product.category);
    increment(brandUsage,product.brand);
    const saved=profileById.get(product.productId);
    const unitNames=saved?parseProfile(saved,product.unit):[product.unit];
    if(!unitNames.length)return json({ok:false,error:'A saved product unit profile cannot be reconciled.'},409);
    for(const unit of new Set(unitNames.map(key))){
      increment(unitUsage,unit);
      if(saved)multiUnitNames.add(unit);
    }
  }
  const rows=(input:LookupRow[],usage:Map<string,number>)=>input.map(item=>({
    id:item.id,name:item.name,active:item.status==='Active',usage:usage.get(key(item.name))??0
  }));
  return json({ok:true,
    categories:rows(categories.results??[],categoryUsage),
    brands:rows(brands.results??[],brandUsage),
    units:(units.results??[]).map(item=>({
      id:item.id,name:item.name,symbol:item.symbol||item.name,
      active:item.status==='Active',usage:unitUsage.get(key(item.name))??0,
      kind:multiUnitNames.has(key(item.name))?'Compound-ready':'Base'
    }))
  });
}
