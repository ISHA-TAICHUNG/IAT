import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createSnapshotReader, PublicationError, reportPublicationFailure,
  reportPublishedSnapshotAge } from './snapshot-publication.mjs';

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
const request = createSnapshotReader({ gasUrl: config.GAS_URL, token: config.API_TOKEN, clientId }).readGas;
async function build() {
  await reportPublishedSnapshotAge(config.PUBLIC_BANKS_URL);
  const categories = await request('categories');
  if (!context.validCategories(categories)) throw new PublicationError('INVALID_CATEGORIES');
  const before = await request('bankRevisions');
  if (!before?.revisions || Object.keys(before.revisions).length !== categories.length ||
      categories.some(cat => typeof before.revisions[cat.id] !== 'string' || !before.revisions[cat.id])) {
    throw new PublicationError('MISSING_SOURCE_REVISIONS');
  }
  const banks = {};
  const publicFields = ['id', 'q', 'options', 'answer', 'multi', 'type', 'subject', 'image', 'optionImages'];
  await mkdir(output); // 必須是新目錄，避免其他舊檔被一起發布
  await mkdir(resolve(output, 'banks'));
  let next = 0;
  let failed = false;
  async function downloadWorker() {
    try {
      while (!failed && next < categories.length) {
        const cat = categories[next++];
        const raw = await request('questions', { cat: cat.id, full: '1' });
        if (failed) return;
        if (!context.validQuestions(raw) || raw.length !== cat.total) {
          throw new PublicationError('INVALID_BANK');
        }
        const questions = raw.map(question => Object.fromEntries(
          publicFields.filter(field => Object.hasOwn(question, field)).map(field => [field, question[field]])
        ));
        const content = JSON.stringify(questions);
        const sha256 = createHash('sha256').update(content).digest('hex');
        const file = sha256 + '.json';
        await writeFile(resolve(output, 'banks', file), content);
        banks[cat.id] = { file, sha256, total: raw.length, sourceUpdatedAt: before.revisions[cat.id] };
        console.log(cat.id + ': ' + raw.length + ' questions, ' + Buffer.byteLength(content) + ' bytes');
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
  console.log('Snapshot ready: ' + categories.length + ' banks, public files only');
}
await build().catch(async error => {
  await reportPublicationFailure(error);
  process.exitCode = 1;
});
