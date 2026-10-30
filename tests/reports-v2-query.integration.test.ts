import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveReportQuery } from '../server/modules/reporting/live/query.ts';

test('v2 reporting query validates dates, pagination and sort', () => {
  const url = (params: string) => new URL('https://local.test/api/reports/v2/rows?' + params);
  const valid = parseLiveReportQuery(url('report=sales&from=2026-10-01&to=2026-10-30&page=2&pageSize=100&sort=date&direction=asc'));
  assert.deepEqual({report:valid.report, from:valid.from, to:valid.to, page:valid.page, pageSize:valid.pageSize, sort:valid.sort, direction:valid.direction},
    {report:'sales',from:'2026-10-01',to:'2026-10-30',page:2,pageSize:100,sort:'date',direction:'asc'});
  for (const invalid of ['report=sales&from=2026-02-30&to=2026-03-01','report=sales&from=2026-10-30&to=2026-10-01',
    'report=sales&from=2024-01-01&to=2025-12-31','report=sales&page=0','report=sales&page=1.5','report=sales&pageSize=500',
    'report=sales&sort=invalid','report=sales&direction=up','report=unknown']) {
    assert.throws(() => parseLiveReportQuery(url(invalid)), Error, invalid);
  }
});
