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
const routeAnchor = '<Route path="dashboard" element={<Dashboard />} />';
if (!app.includes(importAnchor) || !app.includes(routeAnchor)) {
  throw new Error('HisabIQ upstream routing changed; review the API integration before rebuilding');
}
app = app.replace(importAnchor,
  "const LiveProducts = lazy(() => import('./integration/LiveProductsPage').then(module => ({ default: module.LiveProductsPage })));\n"+importAnchor);
app = app.replace(routeAnchor, routeAnchor+'\n          <Route path="live-products" element={<LiveProducts />} />');
writeFileSync(appPath, app);
console.log('Prepared isolated React build copy from pinned HisabIQ_UI source with real backend auth + read-only Products.');
