import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { ProductThumb } from '../components/ProductThumb';
import { StatusBadge } from '../components/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/Table';
import { canUseModule, useBackendSession } from './BackendGate';
import { getBootstrap, type BackendProduct } from './banijjApi';

type StockFilter = 'all' | 'low' | 'out';
const qty = (n: number) => Number(n || 0).toLocaleString('en-BD');
const price = (n: number) => '৳' + Number(n || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 });

export function LiveProductsPage() {
  const user = useBackendSession();
  const permitted = canUseModule(user, 'products');
  const [products, setProducts] = useState<BackendProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [showBarcode, setShowBarcode] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!permitted) return;
    let active = true;
    setLoading(true); setError('');
    getBootstrap().then(result => {
      if (active) setProducts(Array.isArray(result.products) ? result.products : []);
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load products');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [permitted, reload]);
  const categories = useMemo(() => ['All', ...new Set(products.map(p => p.category).filter(Boolean))], [products]);
  const active = useMemo(() => products.filter(p => p.status !== 'Inactive'), [products]);
  const low = useMemo(() => active.filter(p => Number(p.sellableStock ?? p.currentStock) > 0 &&
    Number(p.sellableStock ?? p.currentStock) <= Number(p.minimumStock || 0)), [active]);
  const out = useMemo(() => active.filter(p => Number(p.sellableStock ?? p.currentStock) <= 0), [active]);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return products.filter(p => {
      const stock = Number(p.sellableStock ?? p.currentStock);
      if (category !== 'All' && p.category !== category) return false;
      if (stockFilter === 'low' && (stock <= 0 || stock > Number(p.minimumStock || 0))) return false;
      if (stockFilter === 'out' && stock > 0) return false;
      return !term || [p.productName, p.displayName, p.brand, p.category, p.barcode, p.unit]
        .some(v => String(v || '').toLocaleLowerCase().includes(term));
    });
  }, [products, category, stockFilter, query]);
  if (!permitted) return <section className="rounded-xl border border-danger bg-danger-bg p-4 text-sm text-danger" role="alert">
    You do not have permission to view products. · পণ্য দেখার অনুমতি নেই
  </section>;
  return <section className="mx-auto max-w-[1440px] space-y-4" data-live-products>
    <PageHeader title="Products" titleBn="পণ্য" description="Real stock and selling prices from BanijjIQ."
      actions={<div className="flex items-center gap-2">
        <StatusBadge tone="teal">Live · Read only</StatusBadge>
        <Button variant="outline" size="sm" onClick={() => setReload(n => n + 1)} disabled={loading}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>} />
    <div className="grid grid-cols-3 gap-2">
      {([
        { key: 'all' as StockFilter, title: 'Products', bn: 'মোট পণ্য', count: active.length },
        { key: 'low' as StockFilter, title: 'Low stock', bn: 'কম স্টক', count: low.length },
        { key: 'out' as StockFilter, title: 'Out of stock', bn: 'স্টক শেষ', count: out.length }
      ]).map(s => <button key={s.key} type="button" onClick={() => setStockFilter(s.key)}
        aria-pressed={stockFilter === s.key}
        className={'rounded-xl border p-3 text-left transition-colors ' +
          (stockFilter === s.key ? 'border-teal-400 bg-teal-50' : 'border-border bg-card hover:border-teal-200')}>
        <span className="block text-xl font-semibold text-ink">{qty(s.count)}</span>
        <span className="block text-xs text-ink-700">{s.title}</span>
        <span className="block font-bn text-[11px] text-ink-500">{s.bn}</span>
      </button>)}
    </div>
    <div className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-card">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[190px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-teal-600" />
          <Input value={query} onChange={event => setQuery(event.target.value)}
            aria-label="Search real products" placeholder="Search product, brand, category or barcode…"
            className="h-9 w-full pl-8 pr-9" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}
            className="absolute right-2 top-1.5 rounded p-1 text-ink-500 hover:bg-ink-50"><X className="size-4"/></button>}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-600">
          Category <select value={category} onChange={e => setCategory(e.target.value)}
            className="h-9 max-w-[170px] rounded-md border border-border bg-card px-2 text-sm text-ink">
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-600">
          <input type="checkbox" checked={showBarcode} onChange={e => setShowBarcode(e.target.checked)}/>
          Barcode
        </label>
      </div>
      <p className="text-xs text-ink-500">{visible.length} records · No edits, sales or stock changes are made from this screen.</p>
      {error && <p className="rounded-md bg-danger-bg p-3 text-sm text-danger" role="alert">{error}</p>}
      {loading && <p className="p-5 text-center text-sm text-ink-500" role="status">Loading live products…</p>}
      {!loading && !error && <div className="overflow-x-auto">
        <Table scrollRegionLabel="Live product inventory" className="w-full min-w-[680px]">
          <TableHeader><TableRow>
            <TableHead>Product · পণ্য</TableHead><TableHead>Category</TableHead><TableHead>Unit</TableHead>
            <TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Selling</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>{visible.map(p => {
            const stock = Number(p.sellableStock ?? p.currentStock);
            const isLow = stock > 0 && stock <= Number(p.minimumStock || 0);
            return <TableRow key={p.productId}>
              <TableCell><div className="flex min-w-0 items-center gap-2">
                <ProductThumb size={34}/><div className="min-w-0">
                  <div className="max-w-[250px] truncate text-[13px] font-medium text-ink">{p.displayName || p.productName}</div>
                  <span className="text-[11px] text-ink-500">{p.brand || '—'}{showBarcode && p.barcode ? ' · '+p.barcode : ''}</span>
                </div></div></TableCell>
              <TableCell className="text-xs text-ink-600">{p.category || '—'}</TableCell>
              <TableCell className="text-xs">{p.unit || 'Pcs'}</TableCell>
              <TableCell className="text-right text-[13px]">{qty(stock)}</TableCell>
              <TableCell className="text-right text-[13px]">{price(p.sellingPrice)}</TableCell>
              <TableCell className="text-right"><StatusBadge tone={p.status === 'Inactive' ? 'neutral' : stock <= 0 ? 'danger' : isLow ? 'warning' : 'success'}>
                {p.status === 'Inactive' ? 'Inactive' : stock <= 0 ? 'Out' : isLow ? 'Low' : 'In stock'}
              </StatusBadge></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
        {!visible.length && <p className="p-5 text-center text-sm text-ink-500">No products found · কোনো পণ্য পাওয়া যায়নি</p>}
      </div>}
    </div>
    <p className="text-xs text-ink-500">Product creation, edits, stock adjustments and lot operations will be enabled after their backend forms and validations are integrated.</p>
  </section>;
}
