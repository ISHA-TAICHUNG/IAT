import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const context = {};
vm.createContext(context);
vm.runInContext(await readFile(resolve(root, 'js/config.js'), 'utf8') + '\nglobalThis.config=CONFIG;', context);
const config = context.config;
const expected = JSON.parse(await readFile(resolve(process.argv[2], 'banks/manifest.json'), 'utf8'));
async function revisions() {
  const response = await fetch(config.GAS_URL + '?' + new URLSearchParams({
    action: 'bankRevisions', token: config.API_TOKEN, clientId: 'c_verify_snapshot_20260930'
  }), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Source revision check failed');
  return (await response.json()).revisions;
}
function compare(actual) {
  if (!actual || Object.keys(actual).length !== expected.categories.length ||
      expected.categories.some(cat => actual[cat.id] !== expected.banks[cat.id].sourceUpdatedAt)) {
    throw new Error('SOURCE_CHANGED');
  }
}
compare(await revisions());
if (process.argv.includes('--public')) {
  const response = await fetch(config.PUBLIC_BANKS_URL + 'manifest.json?verify=' + Date.now(), {
    signal: AbortSignal.timeout(20000), cache: 'no-store'
  });
  const manifest = await response.json();
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error('Published manifest mismatch');
  let next = 0;
  async function verifyWorker() {
    while (next < expected.categories.length) {
      const cat = expected.categories[next++];
      const entry = expected.banks[cat.id];
      const res = await fetch(config.PUBLIC_BANKS_URL + entry.file, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('Published bank missing: ' + cat.id);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
        throw new Error('Published bank checksum mismatch: ' + cat.id);
      }
    }
  }
  await Promise.all([verifyWorker(), verifyWorker()]);
  compare(await revisions());
}
console.log('Snapshot revision and publication verification: PASS');
