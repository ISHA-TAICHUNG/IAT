import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

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
async function request(action, params = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = config.GAS_URL + '?' + new URLSearchParams({
        ...params, action, token: config.API_TOKEN, clientId
      });
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data?.error) throw new Error('API rejected snapshot request');
      return data;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 3000 * (attempt + 1)));
    }
  }
}
const categories = await request('categories');
if (!context.validCategories(categories)) throw new Error('Invalid categories');
const before = await request('bankRevisions');
if (!before.revisions || Object.keys(before.revisions).length !== categories.length) {
  throw new Error('Missing source revisions');
}
const banks = {};
const publicFields = ['id', 'q', 'options', 'answer', 'multi', 'type', 'subject', 'image', 'optionImages'];
await mkdir(output); // 必須是新目錄，避免其他舊檔被一起發布
await mkdir(resolve(output, 'banks'));
let next = 0;
async function downloadWorker() {
  while (next < categories.length) {
    const cat = categories[next++];
    const raw = await request('questions', { cat: cat.id, full: '1' });
    if (!context.validQuestions(raw) || raw.length !== cat.total) {
      throw new Error('Bank validation failed: ' + cat.id);
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
}
await Promise.all([downloadWorker(), downloadWorker()]);
const after = await request('bankRevisions');
const latestCategories = await request('categories');
if (JSON.stringify(categories) !== JSON.stringify(latestCategories) ||
    categories.some(cat => before.revisions[cat.id] !== after.revisions?.[cat.id])) {
  throw new Error('Source changed during snapshot build; no deployment allowed');
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
