const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const loader = fs.readFileSync(path.join(root, 'js/data-loader.js'), 'utf8');
const gasPath = path.join(root, 'tools/gas_backend.js');
const gas = fs.existsSync(gasPath) ? fs.readFileSync(gasPath, 'utf8') : '';
const categories = [{ id: '測試', name: '測試職類', group: '即測即評', total: 2 }];
const questions = [
  { id: 1, q: '圖表用途', options: ['甲', '乙'], answer: 0 },
  { id: 2, q: '複選題', options: ['甲', '乙', '丙'], answer: [0, 2], type: 'multi' },
];
const bytes = Buffer.from(JSON.stringify(questions));
const hash = createHash('sha256').update(bytes).digest('hex');
function manifest(age = 0) {
  return { schema: 1, generatedAt: new Date(Date.now() - age).toISOString(), categories,
    banks: { '測試': { file: hash + '.json', sha256: hash, total: 2 } } };
}
function frontend(fetch) {
  const storage = new Map();
  const notices = [];
  const context = { CONFIG: { GAS_URL: 'https://api.test/exec', API_TOKEN: 'test',
    PUBLIC_BANKS_URL: 'https://static.test/banks/' }, fetch, AbortController,
    URLSearchParams, TextDecoder, Uint8Array, crypto: webcrypto, setTimeout, clearTimeout,
    getOrCreateClientId: () => 'c_test_client', t: key => key,
    showToast: message => notices.push(message),
    localStorage: { getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value) },
  };
  vm.createContext(context);
  vm.runInContext(loader, context);
  return { context, storage, notices };
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status }); }

test('健康的 API 資料優先於快照，職類快取避免重複請求', async () => {
  let calls = 0;
  const { context } = frontend(async () => { calls++; return json(categories); });
  await context.loadCategoryData(false);
  await context.loadCategoryData(false);
  assert.equal(calls, 1);
  await context.loadCategoryData(true);
  assert.equal(calls, 2);
});
test('髒值與舊 schema 不會被當成有效職類快取', () => {
  const { context, storage } = frontend(async () => json(categories));
  for (const value of ['broken', JSON.stringify({ version: 2, savedAt: Date.now(), data: categories }),
    JSON.stringify({ version: 1, savedAt: Date.now() + 60000, data: categories }),
    JSON.stringify({ version: 1, savedAt: Date.now(), data: { error: 'bad' } })]) {
    storage.set('exam_categories_v1', value);
    assert.equal(context.readCategoryCache(), null);
  }
});
test('API 限流時只呼叫一次並以校驗過的完整快照載入複選題', async () => {
  let apiCalls = 0;
  const { context, notices } = frontend(async url => {
    if (url.startsWith('https://api.test')) { apiCalls++; return json({ error: '請求過於頻繁' }); }
    return url.endsWith('manifest.json') ? json(manifest()) : new Response(bytes);
  });
  const data = await context.loadPublicData('questions', { cat: '測試', full: '1' });
  assert.equal(JSON.stringify(data), JSON.stringify(questions));
  assert.equal(apiCalls, 1);
  assert.deepEqual(notices, ['load.backup']);
});
test('過期快照不能接手，限流不會立刻重試', async () => {
  let apiCalls = 0;
  const { context } = frontend(async url => {
    if (url.startsWith('https://api.test')) { apiCalls++; return json({ error: '請求過於頻繁' }); }
    return json(manifest(25 * 3600000));
  });
  await assert.rejects(context.loadPublicData('questions', { cat: '測試' }), /過於頻繁/);
  assert.equal(apiCalls, 1);
});
test('篡改 hash 題庫與路徑穿越索引都會被拒絕', async () => {
  const { context } = frontend(async url => url.endsWith('manifest.json') ? json(manifest()) : json([]));
  await assert.rejects(context.loadStaticSnapshot('questions', { cat: '測試' }), /checksum/);
  const bad = manifest(); bad.banks['測試'].file = '../../private.json';
  const second = frontend(async () => json(bad));
  await assert.rejects(second.context.loadStaticSnapshot('questions', { cat: '測試' }), /entry/);
});
test('逾時計時涵蓋 response body，而不是收到 headers 就停止', async () => {
  const { context } = frontend(async (url, options) => ({ ok: true, json: () =>
    new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    })) }));
  await assert.rejects(context.fetchPublicJson('https://api.test', 5, () => true), /error.timeout/);
});
test('缺 ID、錯誤圖片欄位與錯誤複選答案結構都不能進入 renderer', () => {
  const { context } = frontend(async () => json(questions));
  assert.equal(context.validQuestions(questions), true);
  for (const patch of [{ id: undefined }, { image: {} }, { optionImages: {} },
    { optionImages: [42] }, { type: 'multi', answer: 0 }, { multi: true, answer: 0 }]) {
    assert.equal(context.validQuestions([{ ...questions[0], ...patch }]), false);
  }
});

// CI 不包含私有 GAS source；本機部署前才執行 GAS 的重現與回歸案例。
if (fs.existsSync(path.join(root, 'tools/gas_backend.js'))) {
  function backend(initialQuestions = questions) {
    let now = 0;
    const values = new Map();
    const reads = [];
    let revision = 1;
    let bankQuestions = initialQuestions;
    let onRawWrite = null;
    const cache = {
      get: key => values.get(key)?.value || null,
      getAll: keys => Object.fromEntries(keys.filter(key => values.has(key)).map(key => [key, values.get(key).value])),
      put(key, value, ttl) {
        if (key.startsWith('cat_測試_raw_') && onRawWrite) {
          const hook = onRawWrite; onRawWrite = null; hook();
        }
        values.set(key, { value, ttl });
      },
      putAll(entries, ttl) { Object.entries(entries).forEach(([key, value]) => this.put(key, value, ttl)); },
    };
    const context = { CACHE: cache, CACHE_TTL: 21600, Date: { now: () => now },
      READ_RATE_LIMIT: 60, WRITE_RATE_LIMIT: 20, GLOBAL_READ_RATE_LIMIT: 1000,
      GLOBAL_WRITE_RATE_LIMIT: 200, RATE_WINDOW: 60,
      Utilities: { newBlob: value => ({ getBytes: () => Buffer.from(value) }) },
      getFileByName: name => ({ getLastUpdated: () => ({ getTime: () => revision }),
        getBlob: () => { reads.push(name); return { getDataAsString: () => JSON.stringify({ questions: bankQuestions }) }; } }),
    };
    vm.createContext(context);
    vm.runInContext(gas.slice(gas.indexOf('function checkRateLimit('), gas.indexOf('// 與前端')), context);
    const begin = gas.indexOf('// ─────────────────────────── 題庫快取');
    vm.runInContext(gas.slice(begin, gas.indexOf('// ─────────────────────────── 反饋寫入', begin)), context);
    return { context, reads, values, setTime: value => { now = value; },
      setRawHook: hook => { onRawWrite = hook; },
      updateBank() { revision++; bankQuestions = initialQuestions.map(q => ({ ...q, q: '新版' + q.q })); } };
  }
  test('持續低流量不再累積到被擋，全域與單人額度每分鐘獨立', () => {
    const { context, setTime } = backend();
    for (let i = 0; i < 1100; i++) {
      setTime(i * 2000);
      assert.equal(context.checkRateLimit('same-client', 'read'), true);
    }
  });
  test('單分鐘限制與讀寫分桶仍有效，次分鐘恢復', () => {
    const { context, setTime } = backend();
    for (let i = 0; i < 60; i++) assert.equal(context.checkRateLimit('same', 'read'), true);
    assert.equal(context.checkRateLimit('same', 'read'), false);
    assert.equal(context.checkRateLimit('same', 'write'), true);
    assert.equal(context.checkRateLimit('other', 'read'), true);
    setTime(60000);
    assert.equal(context.checkRateLimit('same', 'read'), true);
  });
  test('raw 整庫快取保留完整答案，清主鍵後會讀新版原檔', () => {
    const { context, reads, values } = backend();
    assert.equal(JSON.stringify(context.getQuestions('測試', 80, true)), JSON.stringify(questions));
    assert.equal(JSON.stringify(context.getQuestions('測試', 80, true)), JSON.stringify(questions));
    assert.equal(reads.length, 1);
    values.delete('cat_測試');
    assert.equal(JSON.stringify(context.getQuestions('測試', 80, true)), JSON.stringify(questions));
    assert.equal(reads.length, 2);
  });
  test('一般純文字題提到圖表不會觸發不必要的讀檔', () => {
    const { context, reads } = backend();
    context.getQuestions('測試', 80, false);
    context.getQuestions('測試', 80, false);
    assert.equal(reads.length, 1);
  });
  for (const rebuildNormal of [false, true]) {
    test('舊 full 晚到不能重新發布舊版，normal 重建=' + rebuildNormal, () => {
      const harness = backend();
      harness.setRawHook(() => {
        harness.updateBank();
        harness.values.delete('cat_測試');
        if (rebuildNormal) harness.context.getQuestions('測試', 80, false);
      });
      harness.context.getQuestions('測試', 80, true);
      const latest = harness.context.getQuestions('測試', 80, true);
      assert.ok(latest.every(q => q.q.startsWith('新版')));
    });
    test('大型分段索引舊 full 晚到不會蓋過新版，normal 重建=' + rebuildNormal, () => {
      const large = Array.from({ length: 1000 }, (_, i) => ({ ...questions[i % 2], id: i + 1,
        q: questions[i % 2].q + '測試內容'.repeat(50) }));
      const harness = backend(large);
      harness.setRawHook(() => {
        harness.updateBank();
        harness.values.delete('cat_測試');
        if (rebuildNormal) {
          harness.context.getQuestions('測試', 80, false);
          assert.equal(JSON.parse(harness.values.get('cat_測試').value).v, 2);
        }
      });
      harness.context.getQuestions('測試', 80, true);
      const latest = harness.context.getQuestions('測試', 80, true);
      assert.equal(JSON.stringify(latest), JSON.stringify(large.map(q => ({ ...q, q: '新版' + q.q }))));
    });
  }
  test('限流快取服務故障時唯讀降級，寫入仍拒絕', () => {
    const { context } = backend();
    context.CACHE.getAll = () => { throw new Error('Cache unavailable'); };
    assert.equal(context.checkRateLimit('client', 'read'), true);
    assert.equal(context.checkRateLimit('client', 'write'), false);
  });
}
test('Service Worker 不攔截即時 API 與 POST，錯誤資料不會進題庫快取', () => {
  const listeners = {};
  const context = { URL, self: { addEventListener: (event, fn) => { listeners[event] = fn; } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  for (const request of [new Request('https://script.google.com/exec'),
    new Request('https://example.test/post', { method: 'POST' }),
    new Request('https://example.test/banks/manifest.json')]) {
    listeners.fetch({ request, respondWith: () => assert.fail('Should not intercept') });
  }
});
test('Service Worker 不會永久快取錯誤 hash 的題庫，修好後仍能重抓', async () => {
  const listeners = {};
  let writes = 0;
  let calls = 0;
  const cache = { match: async () => null, put: async () => { writes++; } };
  const context = { URL, Uint8Array, crypto: webcrypto,
    self: { addEventListener: (event, fn) => { listeners[event] = fn; } },
    caches: { open: async () => cache },
    fetch: async () => { calls++; return calls === 1 ? json([questions[0]]) : new Response(bytes); } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  async function request() {
    let response;
    listeners.fetch({ request: new Request('https://example.test/banks/' + hash + '.json'),
      respondWith: promise => { response = promise; } });
    await response;
  }
  await request();
  assert.equal(writes, 0);
  await request();
  assert.equal(writes, 1);
  assert.equal(calls, 2);
});
