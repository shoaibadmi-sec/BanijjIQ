import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = resolve(process.cwd());
const web = join(root, 'apps/hisabiq-web');
const overlay = join(root, 'react-integration/overlay');
if (!existsSync(join(web, 'src/App.tsx')) || !existsSync(join(web, 'package.json'))) {
  throw new Error('Missing pinned HisabIQ React source. Run git submodule update --init apps/hisabiq-web');
}
function copyDirectory(from, to) {
  for (const item of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, item.name);
    const destination = join(to, item.name);
    if (item.isDirectory()) { mkdirSync(destination, { recursive: true }); copyDirectory(source, destination); }
    else if (item.isFile()) { mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination); }
  }
}
// The original HisabIQ design remains an unmodified, pinned Git submodule.
// Integration overlays are applied to the build worktree only.
copyDirectory(overlay, web);

const path = join(web, 'src/App.tsx');
let app = readFileSync(path, 'utf8');
const importAnchor = "const Dashboard = lazy(() => import('./pages/Dashboard')";
const routeAnchor = '<Route path="dashboard" element={<Dashboard />} />';
if (!app.includes(importAnchor) || !app.includes(routeAnchor)) {
  throw new Error('HisabIQ upstream routing changed; review the API integration before rebuilding');
}
app = app.replace(importAnchor,
  "const LiveProducts = lazy(() => import('./integration/LiveProductsPage').then(module => ({ default: module.LiveProductsPage })));\n"+importAnchor);
app = app.replace(routeAnchor, routeAnchor+'\n          <Route path="live-products" element={<LiveProducts />} />');
writeFileSync(path, app);
console.log('Pinned HisabIQ UI prepared with BanijjIQ authentication + read-only product integration.');
