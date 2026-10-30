import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchReportsNav, patchReportsPage } from '../../scripts/preview/patch-reports-two-tabs.mjs';

const source = path => readFileSync(new URL('../../apps/hisabiq-web/' + path, import.meta.url), 'utf8');

test('top-level Reports navigation shows only Dashboard and Report Library', () => {
  const nav = patchReportsNav(source('src/components/reports/ReportsNav.tsx'));
  assert.match(nav, /const primaryScreens = reportScreens\.filter\(/);
  assert.match(nav, /item\.id === 'overview' \|\| item\.id === 'library'/);
  assert.match(nav, /primaryScreens\.map\(/);
  assert.match(nav, /primaryScreens\.length/);
  assert.match(nav, /text\('Dashboard', 'ড্যাশবোর্ড'\)/);
  assert.match(nav, /text\('Report Library', 'রিপোর্ট লাইব্রেরি'\)/);
  assert.doesNotMatch(nav, /reportScreens\.map\(/);
  assert.doesNotMatch(nav, /reportScreens\[next\]/);
});

test('legacy advisor, sales, stock, and other deep links become Report Library, not extra tabs', () => {
  const page = patchReportsPage(source('src/pages/Reports.tsx'));
  assert.match(page, /const screen=requestedScreen==='overview'\?'overview':'library';/);
  assert.match(page, /const allowedScreen=nextScreen==='overview'\?'overview':'library';/);
  assert.match(page, /reportKeyForScreen\(nextScreen\)/);
  assert.match(page, /paramsForReportScreen\(allowedScreen,next\.id/);
  assert.match(page, /<ReportsNav value=\{screen\} onChange=\{selectScreen\}\/>/);
  assert.match(page, /screen==='library'&&<ReportToolbar/);
  assert.match(page, /screen==='library'&&liveStatus!=='unavailable'&&liveStatus!=='loading'&&<ReportResults/);
  assert.match(page, /useLiveReportResult\(definition\.id,filters,refresh\)/);
  assert.doesNotMatch(page, /useReportData\(refresh\)/);
  assert.match(page, /screen==='overview'/);
});

test('patch fails closed if pinned Reports JSX changes; original source stays unmodified', () => {
  assert.throws(() => patchReportsNav('other content'), /source anchor/);
  assert.throws(() => patchReportsPage('other content'), /source anchor/);
  const origNav=source('src/components/reports/ReportsNav.tsx');
  assert.match(origNav,/reportScreens\.map\(/,'pinned source is not edited');
});
