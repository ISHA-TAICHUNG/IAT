// sw.js 對 explanations/*.json 的 network-first 分支：線上回寫快取、離線讀快取
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const URL_JSON = 'https://example.test/IAT/explanations/C.json';

function loadSw({ fetchImpl }) {
  const handlers = new Map();
  const store = new Map();
  const cache = {
    put: async (req, res) => { store.set(req.url, res); },
    match: async req => store.get(req.url),
  };
  const context = {
    self: { addEventListener: (name, h) => handlers.set(name, h), skipWaiting() {}, clients: { claim() {} } },
    URL, Request: class {}, Response: { error: () => ({ error: true }) },
    caches: { open: async () => cache, match: async req => store.get(req.url), keys: async () => [] },
    fetch: fetchImpl, crypto: globalThis.crypto,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  return { handlers, store };
}

async function dispatch(handlers, url) {
  const waits = [];
  let responded;
  handlers.get('fetch')({
    request: { method: 'GET', url },
    respondWith: p => { responded = p; },
    waitUntil: p => { waits.push(p); },
  });
  const response = await responded;
  await Promise.all(waits);
  return response;
}

test('線上：回傳網路結果並寫入快取（waitUntil 內完成）', async () => {
  const net = { ok: true, tag: 'net', clone() { return { ok: true, tag: 'copy' }; } };
  const { handlers, store } = loadSw({ fetchImpl: async () => net });
  const res = await dispatch(handlers, URL_JSON);
  assert.equal(res, net);
  assert.equal(store.get(URL_JSON).tag, 'copy');
});

test('離線：fetch 失敗時回傳上次的快取；沒有快取則回錯誤回應', async () => {
  let online = true;
  const net = { ok: true, tag: 'net', clone() { return { ok: true, tag: 'copy' }; } };
  const { handlers } = loadSw({ fetchImpl: async () => { if (online) return net; throw new Error('offline'); } });
  await dispatch(handlers, URL_JSON);
  online = false;
  assert.equal((await dispatch(handlers, URL_JSON)).tag, 'copy');
  const fresh = loadSw({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await dispatch(fresh.handlers, URL_JSON)).error, true);
});

test('HTTP 錯誤回應不寫入快取', async () => {
  const net = { ok: false, clone() { throw new Error('不該被 clone'); } };
  const { handlers, store } = loadSw({ fetchImpl: async () => net });
  assert.equal(await dispatch(handlers, URL_JSON), net);
  assert.equal(store.size, 0);
});
