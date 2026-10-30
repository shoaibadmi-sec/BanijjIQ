import {createHash} from 'node:crypto';

const SOURCE_BLOB='d149a698fa49e5bf4a3b263651707dca59f1dee7';
const hash=source=>createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex');

function once(source,before,after,label) {
  const pos=source.indexOf(before);
  if(pos<0 || source.indexOf(before,pos+1)>=0)throw new Error('Pinned original POS mismatch: '+label);
  return source.slice(0,pos)+after+source.slice(pos+before.length);
}

/** This changes only API data/handlers, never the original POS JSX/CSS. */
export function patchOriginalPosApiCatalog(source) {
  if(hash(source)!==SOURCE_BLOB)throw new Error('Unknown original Pos.tsx revision; manual review required.');
  let next=once(source,"import { products } from '../data/products';\n",'','remove seed import');
  next=once(next,"const quickItems = products.filter((p) => p.active && (p.kind === 'Service' || !p.expiry?.enabled || productStockBreakdown(p, stockLots).sellable > 0)).slice(0, 8);\n",'','remove static quick items');
  next=once(next,'  const cart = usePosCart();','  const cart = usePosCart(() => []);','empty demo cart');
  next=once(next,
    '  const previewCatalog=usePreviewCatalog();',
    "  const previewCatalog=usePreviewCatalog();\n  const quickItems = previewCatalog.filter(p=>p.active && (p.kind === 'Service' || !p.expiry?.enabled || productStockBreakdown(p, stockLots).sellable > 0)).slice(0,8);",
    'live quick items');
  next=once(next,'  const complete = () => {',
    "  const complete = () => {\n    toast.error('Original POS API preview: invoice posting is disabled until backend integration is complete.');\n    return;",
    'prevent demo posting');
  return next;
}
