import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';

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

const appPath = join(web, 'src/App.tsx');
let app = readFileSync(appPath, 'utf8');
const importAnchor = "const Dashboard = lazy(() => import('./pages/Dashboard')";
const posAnchor = '<Route path="pos" element={<Pos />} />';
const productsAnchor = '<Route path="products" element={<Products />} />';
if (![importAnchor, posAnchor, productsAnchor].every(anchor => app.includes(anchor))) {
  throw new Error('HisabIQ upstream routes changed; review the API integration before rebuilding');
}
app = app.replace(importAnchor, [
  "const LiveProducts = lazy(() => import('./integration/LiveProductsPage').then(module => ({ default: module.LiveProductsPage })));",
  "const LivePos = lazy(() => import('./integration/LivePosPage').then(module => ({ default: module.LivePosPage })));",
  "const LiveSalesReturns = lazy(() => import('./integration/LiveSalesReturnsPage').then(module => ({ default: module.LiveSalesReturnsPage })));",
  importAnchor
].join('\n'));
app = app.replace(posAnchor,
  '<Route path="pos" element={<LivePos />} />\n          <Route path="live-sales-returns" element={<LiveSalesReturns />} />\n          <Route path="pos-design-preview" element={<Pos />} />');
app = app.replace(productsAnchor,
  '<Route path="products" element={<LiveProducts />} />\n          <Route path="products-design-preview" element={<Products />} />\n          <Route path="live-products" element={<LiveProducts />} />');
writeFileSync(appPath, app);
console.log('Prepared isolated React build copy from pinned HisabIQ_UI source with real backend auth + live Products, tracked POS and live Returns integration.');
