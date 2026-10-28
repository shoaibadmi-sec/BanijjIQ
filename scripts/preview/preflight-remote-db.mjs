/** Fail closed unless the remote D1 UUID belongs to the exact preview-only database name. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config=JSON.parse(readFileSync('wrangler.hisabiq-preview.generated.jsonc','utf8'));
const account=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim();
assert.match(account,/^[a-f0-9]{32}$/i,'Valid Cloudflare account ID required');
assert.ok(token,'Cloudflare API token required');
const binding=config.d1_databases?.[0];
assert.equal(config.name,'banijjiq-hisabiq-react-preview');
assert.equal(binding.database_name,'banijjiq-hisabiq-react-preview-db');
assert.equal(binding.database_id,(process.env.HISABIQ_PREVIEW_D1_ID||'').trim());
const response=await fetch(
  'https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+encodeURIComponent(binding.database_id),
  {headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)}
);
assert.equal(response.ok,true,'Cloudflare D1 metadata lookup failed: HTTP '+response.status);
const payload=await response.json();
assert.equal(payload.success,true,'Cloudflare D1 metadata call was unsuccessful');
assert.equal(payload.result?.uuid?.toLowerCase(),binding.database_id.toLowerCase(),
  'Remote D1 UUID does not match the configured preview binding');
assert.equal(payload.result?.name,binding.database_name,
  'REFUSING: Remote D1 database name is not the dedicated HisabIQ preview database');
console.log('PASS: remote D1 UUID/name match dedicated preview database. No migration applied yet.');
