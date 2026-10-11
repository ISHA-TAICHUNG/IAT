import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createSnapshotReader, PublicationError, reportPublicationFailure,
  reportPublishedSnapshotAge, snapshotFreshness } from './snapshot-publication.mjs';

// 題庫只进入部署產物；公開檔案採白名單，避免夾帶 tools、xlsx 與管理資料。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || '/tmp/iat-public-site');
if (output === root || root.startsWith(output + '/')) throw new Error('Invalid output path');
const context = {};
vm.createContext(context);
vm.runInContext(await readFile(resolve(root, 'js/config.js'), 'utf8') + '\nglobalThis.config = CONFIG;', context);
vm.runInContext(await readFile(resolve(root, 'js/data-loader.js'), 'utf8'), context);
const config = context.config;
const clientId = 'c_' + randomUUID().replaceAll('-', '');
const reader = createSnapshotReader({ gasUrl: config.GAS_URL, token: config.API_TOKEN, clientId });
const request = reader.readGas;
const publicFields = ['id', 'q', 'options', 'answer', 'multi', 'type', 'subject', 'image', 'optionImages'];

async function loadReuseManifest() {
  try {
    const manifest = await reader.readPublic(config.PUBLIC_BANKS_URL + 'manifest.json?reuse=' + Date.now());
    if (snapshotFreshness(manifest).state === 'expired' || !context.validCategories(manifest.categories) ||
        !manifest.banks || Array.isArray(manifest.banks) ||
        Object.keys(manifest.banks).length !== manifest.categories.length ||
        manifest.categories.some(cat => !Object.hasOwn(manifest.banks, cat.id))) {
      throw new PublicationError('INVALID_REUSE_MANIFEST');
    }
    return manifest;
  } catch {
    console.log(JSON.stringify({ event: 'snapshot_reuse_unavailable' }));
    return null;
  }
}

async function readReusableBank(manifest, cat, sourceUpdatedAt) {
  if (!manifest) return null;
  const previous = manifest.categories.find(item => item.id === cat.id);
  const entry = manifest.banks[cat.id];
  if (JSON.stringify(previous) !== JSON.stringify(cat) || !entry ||
      entry.sourceUpdatedAt !== sourceUpdatedAt || entry.total !== cat.total) return null;
  try {
    if (typeof entry.file !== 'string' || !/^[a-f0-9]{64}\.json$/.test(entry.file) ||
        entry.sha256 !== entry.file.slice(0, -5)) throw new PublicationError('INVALID_REUSE_ENTRY');
    const content = await reader.readPublic(config.PUBLIC_BANKS_URL + entry.file, { cat: cat.id, format: 'bytes' });
    if (createHash('sha256').update(content).digest('hex') !== entry.sha256) {
      throw new PublicationError('INVALID_REUSE_CHECKSUM');
    }
    const questions = JSON.parse(content.toString('utf8'));
    if (!context.validQuestions(questions) || questions.length !== cat.total ||
        questions.some(question => Object.keys(question).some(field => !publicFields.includes(field)))) {
      throw new PublicationError('INVALID_REUSE_BANK');
    }
    return content;
  } catch {
    // 備援損壞時只能重抓來源；來源失敗仍阻擋發布，不放行舊檔。
    console.log(JSON.stringify({ event: 'snapshot_reuse_rejected', cat: cat.id }));
    return null;
  }
}

async function build() {
  await reportPublishedSnapshotAge(config.PUBLIC_BANKS_URL);
  const categories = await request('categories');
  if (!context.validCategories(categories)) throw new PublicationError('INVALID_CATEGORIES');
  const before = await request('bankRevisions');
  if (!before?.revisions || Object.keys(before.revisions).length !== categories.length ||
      categories.some(cat => typeof before.revisions[cat.id] !== 'string' || !before.revisions[cat.id])) {
    throw new PublicationError('MISSING_SOURCE_REVISIONS');
  }
  // 必須先取得即時來源版本，公開快照不能取代來源權威檢查。
  const reuseManifest = await loadReuseManifest();
  const banks = {};
  let reusedBanks = 0;
  let fetchedBanks = 0;
  await mkdir(output); // 必須是新目錄，避免其他舊檔被一起發布
  await mkdir(resolve(output, 'banks'));
  let next = 0;
  let failed = false;
  async function downloadWorker() {
    try {
      while (!failed && next < categories.length) {
        const cat = categories[next++];
        let content = await readReusableBank(reuseManifest, cat, before.revisions[cat.id]);
        const reused = content !== null;
        if (failed) return;
        if (!reused) {
          const raw = await request('questions', { cat: cat.id, full: '1' });
          if (failed) return;
          if (!context.validQuestions(raw) || raw.length !== cat.total) {
            throw new PublicationError('INVALID_BANK');
          }
          const questions = raw.map(question => Object.fromEntries(
            publicFields.filter(field => Object.hasOwn(question, field)).map(field => [field, question[field]])
          ));
          content = JSON.stringify(questions);
        }
        const sha256 = createHash('sha256').update(content).digest('hex');
        const file = sha256 + '.json';
        await writeFile(resolve(output, 'banks', file), content);
        banks[cat.id] = { file, sha256, total: cat.total, sourceUpdatedAt: before.revisions[cat.id] };
        if (reused) reusedBanks++;
        else fetchedBanks++;
        console.log(cat.id + ': ' + cat.total + ' questions, ' + Buffer.byteLength(content) + ' bytes, ' +
          (reused ? 'verified reuse' : 'source download'));
      }
    } catch (error) {
      failed = true;
      throw error;
    }
  }
  const results = await Promise.allSettled([downloadWorker(), downloadWorker()]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const after = await request('bankRevisions');
  const latestCategories = await request('categories');
  if (JSON.stringify(categories) !== JSON.stringify(latestCategories) ||
      !after?.revisions || Object.keys(after.revisions).length !== categories.length ||
      categories.some(cat => before.revisions[cat.id] !== after.revisions[cat.id])) {
    throw new PublicationError('SOURCE_CHANGED', true);
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0');
  const allowedRoot = new Set(['index.html', 'exam.html', 'result.html', 'query.html',
    'exam-query.html', 'sw.js', 'manifest.json', 'og-image.png']);
  for (const file of tracked) {
    if (!allowedRoot.has(file) && !/^(js|css|icons|images)\//.test(file)) continue;
    await mkdir(dirname(resolve(output, file)), { recursive: true });
    await writeFile(resolve(output, file), await readFile(resolve(root, file)));
  }
  await writeFile(resolve(output, 'banks/manifest.json'), JSON.stringify({
    schema: 1, generatedAt: new Date().toISOString(), categories, banks
  }));
  await writeFile(resolve(output, '.nojekyll'), '');
  console.log(JSON.stringify({ event: 'snapshot_bank_sources', reusedBanks, fetchedBanks }));
  console.log('Snapshot ready: ' + categories.length + ' banks, public files only');
}
await build().catch(async error => {
  await reportPublicationFailure(error);
  process.exitCode = 1;
});
