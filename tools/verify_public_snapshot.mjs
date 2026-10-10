import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createSnapshotReader, PublicationError, reportPublicationFailure } from './snapshot-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const context = {};
vm.createContext(context);
vm.runInContext(await readFile(resolve(root, 'js/config.js'), 'utf8') + '\nglobalThis.config=CONFIG;', context);
const config = context.config;
const expected = JSON.parse(await readFile(resolve(process.argv[2], 'banks/manifest.json'), 'utf8'));
const reader = createSnapshotReader({ gasUrl: config.GAS_URL, token: config.API_TOKEN,
  clientId: 'c_verify_snapshot_20260930' });
async function revisions() {
  return (await reader.readGas('bankRevisions'))?.revisions;
}
function compare(actual) {
  if (!actual || Object.keys(actual).length !== expected.categories.length ||
      expected.categories.some(cat => actual[cat.id] !== expected.banks[cat.id].sourceUpdatedAt)) {
    throw new PublicationError('SOURCE_CHANGED', true);
  }
}
async function verify() {
  compare(await revisions());
  if (process.argv.includes('--public')) {
    const manifest = await reader.readPublic(config.PUBLIC_BANKS_URL + 'manifest.json?verify=' + Date.now(),
      { deadline: 20000 });
    if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new PublicationError('PUBLIC_MANIFEST_MISMATCH', true);
    let next = 0;
    let failed = false;
    async function verifyWorker() {
      try {
        while (!failed && next < expected.categories.length) {
          const cat = expected.categories[next++];
          const entry = expected.banks[cat.id];
          const bytes = await reader.readPublic(config.PUBLIC_BANKS_URL + entry.file, { cat: cat.id, format: 'bytes' });
          if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
            throw new PublicationError('PUBLIC_BANK_CHECKSUM_MISMATCH');
          }
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
    const results = await Promise.allSettled([verifyWorker(), verifyWorker()]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    compare(await revisions());
  }
  console.log('Snapshot revision and publication verification: PASS');
}
await verify().catch(async error => {
  await reportPublicationFailure(error);
  process.exitCode = 1;
});
