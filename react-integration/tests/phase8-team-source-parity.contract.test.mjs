import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Phase 8 Team presentation must import original pinned HisabIQ TeamSettings',()=>{
  const adapter=src('../overlay/src/integration/LiveTeamSettingsPage.tsx');
  const originalTeam=src('../../apps/hisabiq-web/src/settings/TeamSettings.tsx');
  const originalDirectory=src('../../apps/hisabiq-web/src/settings/EmployeeDirectory.tsx');
  assert.match(adapter,/import\s*\{\s*TeamSettings\s*\}\s*from\s*['"]\.\.\/settings\/TeamSettings['"]/,
    'integration must render original TeamSettings, not a separately designed replacement');
  assert.match(adapter,/<TeamSettings\s/,'source TeamSettings must own the screen content');
  assert.match(originalTeam,/import\s*\{\s*EmployeeDirectory\s*\}/,
    'original team page must render EmployeeDirectory');
  assert.match(originalDirectory,/Employee rows per page/);
  assert.match(originalDirectory,/Employee columns/);
  assert.match(originalDirectory,/Search employees/);
  assert.doesNotMatch(adapter,/<table\b|<thead\b|<tbody\b|<fieldset\b|<SettingsDialog\b/,
    'API data adapter may not reimplement the team table, filters or form UI');
  assert.doesNotMatch(adapter,/localStorage|sessionStorage/,
    'employee and role business data must come from real authenticated API');
});

test('Phase 8 Team writes stay disabled until original multi-role and metadata contract is complete',()=>{
  const adapter=src('../overlay/src/integration/LiveTeamSettingsPage.tsx');
  assert.match(adapter,/disabled=\{true\}/,
    'original team editor must not persist only a subset of its fields');
  assert.doesNotMatch(adapter,/method:\s*['"](?:POST|PUT|DELETE)['"]/,
    'do not pretend the missing original backend workflow exists');
});
