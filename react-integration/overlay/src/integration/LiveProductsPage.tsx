import { useEffect, useMemo, useState } from 'react';
import { getBootstrap, type BackendProduct } from './banijjApi';

/** First API-backed HisabIQ screen. All records are read-only until write workflows are verified. */
export function LiveProductsPage() {
  const [products, setProducts] = useState<BackendProduct[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getBootstrap().then(result => { if (active) setProducts(result.products || []); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load products'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return products.filter(p => !term || [p.productName,p.displayName,p.brand,p.category,p.barcode,p.unit]
      .some(v => String(v || '').toLocaleLowerCase().includes(term)));
  }, [products, query]);
  return <section className="mx-auto max-w-[1440px] space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-ink">Products · Live data</h1>
        <p className="font-bn text-xs text-ink-500">সরাসরি BanijjIQ API থেকে পণ্য তালিকা · শুধু দেখার জন্য</p></div>
      <span className="rounded-md bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
        Real API · Read only
      </span>
    </header>
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <label htmlFor="live-products-search" className="sr-only">Search real products</label>
      <input id="live-products-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="Search name, brand, barcode, category…" className="h-9 w-full rounded-lg border border-border px-3 text-sm text-ink focus:outline-teal-500" />
      <p className="mt-2 text-xs text-ink-500">{visible.length} products · No stock or price changes are made here.</p>
    </div>
    {busy && <p role="status" className="text-sm text-ink-500">Loading real products…</p>}
    {error && <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</p>}
    {!busy && !error && <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
      <table className="w-full min-w-[660px] text-left text-sm text-ink">
        <thead className="bg-ink-50 text-xs text-ink-500"><tr>
          <th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium">Brand / category</th>
          <th className="px-3 py-2 font-medium">Unit</th><th className="px-3 py-2 text-right font-medium">Stock</th>
          <th className="px-3 py-2 text-right font-medium">Selling price</th></tr></thead>
        <tbody className="divide-y divide-border">
          {visible.map(p => <tr key={p.productId} className="hover:bg-teal-50/30">
            <td className="px-3 py-2"><strong className="font-medium">{p.productName}</strong><span className="block text-xs text-ink-500">{p.barcode}</span></td>
            <td className="px-3 py-2 text-ink-600">{[p.brand,p.category].filter(Boolean).join(' · ')}</td>
            <td className="px-3 py-2">{p.unit}</td>
            <td className="px-3 py-2 text-right">{Number(p.sellableStock ?? p.currentStock).toLocaleString()}</td>
            <td className="px-3 py-2 text-right">৳{Number(p.sellingPrice).toLocaleString('en-BD',{maximumFractionDigits:2})}</td>
          </tr>)}
        </tbody>
      </table>
      {!visible.length && <p className="p-5 text-center text-sm text-ink-500">No products found.</p>}
    </div>}
  </section>;
}
