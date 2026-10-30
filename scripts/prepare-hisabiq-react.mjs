import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { patchLiveProducts } from './preview/patch-live-products.mjs';
import { patchReportsNav, patchReportsPage } from './preview/patch-reports-two-tabs.mjs';

const root = resolve(process.cwd());
const sourceWeb = join(root, 'apps/hisabiq-web');
const web = join(root, '.generated/hisabiq-web');
const overlay = join(root, 'react-integration/overlay');
if (!existsSync(join(sourceWeb, 'src/App.tsx')) || !existsSync(join(sourceWeb, 'package.json'))) {
  throw new Error('Missing pinned HisabIQ source. Run git submodule update --init apps/hisabiq-web');
}
// Always construct a clean build worktree: never patch or overwrite the pinned original source.
rmSync(web, { recursive: true, force: true });
mkdirSync(dirname(web), { recursive: true });
cpSync(sourceWeb, web, {
  recursive: true,
  filter: path => {
    const name = relative(sourceWeb, path);
    return !name.split(sep).some(part => ['.git','node_modules','dist','.wrangler'].includes(part));
  }
});
function copyDirectory(from, to) {
  for (const item of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, item.name);
    const destination = join(to, item.name);
    if (item.isDirectory()) { mkdirSync(destination, { recursive: true }); copyDirectory(source, destination); }
    else if (item.isFile()) { mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination); }
  }
}
copyDirectory(overlay, web);
const sourceProductsPath=join(sourceWeb,'src/pages/Products.tsx');
const generatedProductsPath=join(web,'src/pages/Products.tsx');
// Pinned source never changes; the build-copy transform fails closed on unknown JSX.
writeFileSync(generatedProductsPath,patchLiveProducts(readFileSync(sourceProductsPath,'utf8')));

// Phase 5: simplify generated Reports navigation without touching the pinned React source.
const reportsNavPath=join(web,'src/components/reports/ReportsNav.tsx');
const reportsPagePath=join(web,'src/pages/Reports.tsx');
writeFileSync(reportsNavPath,patchReportsNav(readFileSync(reportsNavPath,'utf8')));
writeFileSync(reportsPagePath,patchReportsPage(readFileSync(reportsPagePath,'utf8')));


const appPath = join(web, 'src/App.tsx');
let app = readFileSync(appPath, 'utf8');
const importAnchor = "const Dashboard = lazy(() => import('./pages/Dashboard')";
const settingsRouteAnchor = '<Route path="settings/:section" element={<TenantSettingsPage />} />';
const posAnchor = '<Route path="pos" element={<Pos />} />';
const productsAnchor = '<Route path="products" element={<Products />} />';
const reportsAnchor = '<Route path="reports" element={<Reports />} />';
const purchasesAnchor = '<Route path="purchases" element={<Purchases />} />';
const purchaseEditorAnchor = '<Route path="purchases/new" element={<PurchaseEditor />} />';
if (![importAnchor, posAnchor, productsAnchor, reportsAnchor, purchasesAnchor, purchaseEditorAnchor, settingsRouteAnchor].every(anchor => app.includes(anchor))) {
  throw new Error('HisabIQ upstream routes changed; review the API integration before rebuilding');
}
app = app.replace(importAnchor, [
  "const LiveBusinessSettingsPage = lazy(() => import('./integration/LiveBusinessSettingsPage').then(module => ({ default: module.LiveBusinessSettingsPage })));",
  "const LiveTeamSettingsPage = lazy(() => import('./integration/LiveTeamSettingsPage').then(module => ({ default: module.LiveTeamSettingsPage })));",
  "const LiveProducts = lazy(() => import('./integration/LiveProductsPage').then(module => ({ default: module.LiveProductsPage })));",
  "const LivePos = lazy(() => import('./integration/LivePosPage').then(module => ({ default: module.LivePosPage })));",
  "const LiveSalesReturns = lazy(() => import('./integration/LiveSalesReturnsPage').then(module => ({ default: module.LiveSalesReturnsPage })));",
  "const LiveReports = lazy(() => import('./integration/LiveReportsPage').then(module => ({ default: module.LiveReportsPage })));",
  "const LivePurchases = lazy(() => import('./integration/LivePurchasesPage').then(m => ({ default: m.LivePurchasesPage })));",
  "const LivePurchaseEditor = lazy(() => import('./integration/LivePurchasesPage').then(m => ({ default: m.LivePurchaseEditorPage })));",
  importAnchor
].join('\n'));
// Keep the pinned Settings design and submodule untouched; replace only live Business route.
app = app.replace(settingsRouteAnchor,
  ['<Route path="settings/business" element={<LiveBusinessSettingsPage />} />', '<Route path="settings/team" element={<LiveTeamSettingsPage />} />', settingsRouteAnchor].join('\n'));
app = app.replace(posAnchor,
  '<Route path="pos" element={<LivePos />} />\n          <Route path="live-sales-returns" element={<LiveSalesReturns />} />\n          <Route path="pos-design-preview" element={<Pos />} />');
app = app.replace(productsAnchor,
  '<Route path="products" element={<Products />} />\n          <Route path="products-design-preview" element={<Products />} />\n          <Route path="live-products" element={<LiveProducts />} />');
app = app.replace(reportsAnchor,
  '<Route path="reports" element={<LiveReports />} />\n          <Route path="reports-design-preview" element={<Reports />} />');
app = app.replace(purchasesAnchor, '<Route path="purchases" element={<LivePurchases />} />\\n          <Route path="purchases-design-preview" element={<Purchases />} />'.replace('\\n','\n'));
app = app.replace(purchaseEditorAnchor, '<Route path="purchases/new" element={<LivePurchaseEditor />} />\\n          <Route path="purchase-editor-design-preview" element={<PurchaseEditor />} />'.replace('\\n','\n'));
writeFileSync(appPath, app);
console.log('Prepared isolated React build: real Products, POS and two-tab Reports route; unreconciled report figures remain unavailable.');
