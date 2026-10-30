import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiRequest } from '../server/core/handler.ts';
import type { SherDatabase } from '../server/db/types.ts';

test('unexpected API failures must not expose internal database errors to clients', async () => {
  const internalDetail = 'SQLITE_ERROR: no such table: app_users -- internal schema detail';
  let databaseAccessed = false;
  const db: SherDatabase = {
    prepare: () => {
      databaseAccessed = true;
      throw new Error(internalDetail);
    },
    batch: async () => {
      throw new Error('Unexpected batch invocation');
    },
  };

  const response = await handleApiRequest(new Request('http://isolated.invalid/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '01000000001', password: 'dummy-password' }),
  }), db);
  const body = await response.json() as { ok?: boolean; error?: string };

  assert.equal(databaseAccessed, true, 'test must exercise the failing database boundary');
  assert.equal(response.status, 500);
  assert.deepEqual(body, { ok: false, error: 'Unexpected server error' });
  assert.equal(JSON.stringify(body).includes(internalDetail), false);
});
