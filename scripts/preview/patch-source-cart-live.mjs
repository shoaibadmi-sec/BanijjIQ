/** Add a real-data input seam to the exact upstream HisabIQ CartTable, without rewriting JSX. */
export function patchSourceCartForLive(source){
 const edit=(before,after)=>{
  if(source.split(before).length!==2)throw new Error('CartTable upstream contract changed: '+before.slice(0,60));
  source=source.replace(before,after);
 };
 edit('type CartTableProps = {',`type CartTableProps = {\n  liveCatalog?:Product[];
  liveSymbols?:Record<string,Record<string,string>>;\n  onLiveSerial?:(id:string)=>void;\n  onLiveShortage?:(id:string)=>void;`);
 edit('onMove, searchRef }: CartTableProps)',`onMove, searchRef, liveCatalog, liveSymbols, onLiveSerial, onLiveShortage }: CartTableProps)`);
 edit('const catalog=usePreviewCatalog();','const previewCatalog=usePreviewCatalog();\n  const catalog=liveCatalog??previewCatalog;');
 edit('const soldSerials = useMemo(() => salesInvoices.flatMap((invoice) => invoice.lines.flatMap((line) => line.serials ?? [])), []);',
  'const soldSerials = useMemo(() => liveCatalog ? [] : salesInvoices.flatMap((invoice) => invoice.lines.flatMap((line) => line.serials ?? [])), [liveCatalog]);');
 edit("const shortage = l.product.kind==='Bundle'?0:Math.max(0,baseQty-(allocations.find(a=>a.key===l.key)?.ownBaseQty??0));",
  "const shortage = l.product.kind==='Bundle'?0:liveCatalog?Math.max(0,baseQty-l.product.stock):Math.max(0,baseQty-(allocations.find(a=>a.key===l.key)?.ownBaseQty??0));");
 edit('quantities={saleLineQuantities(l)}', 'quantities={saleLineQuantities(l)} symbols={liveSymbols?.[l.product.id]}');
 edit('value={l.price}', 'disabled={Boolean(liveCatalog&&l.unitQuantities)} value={l.price}');
 edit('data-pos-cost-eye', 'data-pos-cost-eye disabled={Boolean(liveCatalog)}');
 edit('onClick={() => setSerialLine(l)}','onClick={() => onLiveSerial?onLiveSerial(l.product.id):setSerialLine(l)}');
 edit('onClick={() => setShortageLine(l)}','onClick={() => onLiveShortage?onLiveShortage(l.product.id):setShortageLine(l)}');
 edit("l.product.expiry?.enabled ? ` · ${word('sellable')} ${formatStock({ ...l.product, stock: productStockBreakdown(l.product, stockLots).sellable })}`",
  "l.product.expiry?.enabled ? ` · ${word('sellable')} ${formatStock({ ...l.product, stock: liveCatalog ? l.product.stock : productStockBreakdown(l.product, stockLots).sellable })}`");
 return source;
}

/** Preserve upstream joined-control markup, overriding only symbol lookup for server-managed units. */
export function patchJoinedUnitSymbolsForLive(source){
 const edit=(before,after)=>{if(source.split(before).length!==2)throw new Error('MultiUnitQuantityInput upstream contract changed: '+before);source=source.replace(before,after);};
 edit('invalid?:boolean;','invalid?:boolean;\n  symbols?:Record<string,string>;');
 edit('unitOrder,label,invalid}:{','unitOrder,label,invalid,symbols}:{');
 edit('unitSymbol(unit)', 'symbols?.[unit]??unitSymbol(unit)');
 return source;
}
