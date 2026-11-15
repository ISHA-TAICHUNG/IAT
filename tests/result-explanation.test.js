// 結果頁 AI 解析區塊：用最小假 DOM 載入 result.js；解析來自網站獨立檔（假 fetch），不連網、不碰正式題庫。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const LAW = 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0070019&flno=';

function element(tag) {
  const classes = new Set();
  return {
    tagName: String(tag).toUpperCase(), children: [], attributes: {}, className: '',
    style: { setProperty() {} }, getBoundingClientRect: () => ({ height: 64 }),
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    insertBefore(child, ref) {
      child.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
      return child;
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      this.parentNode = null;
    },
    set textContent(value) { this.text = String(value); this.children = []; },
    get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(''); },
  };
}

function all(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) all(child, predicate, out);
  return out;
}
const byClass = (node, name) => all(node, n => String(n.className).split(' ').includes(name));

function loadResult(questions, answers, { fetch, crypto = globalThis.crypto } = {}) {
  const nodes = new Map();
  const select = element('select');
  for (const value of ['題目有誤', '答案有誤', '選項有誤', '其他']) {
    const opt = element('option');
    opt.value = value;
    select.appendChild(opt);
  }
  // 模擬 <select>：selectedIndex／value 跟著 option 的 selected 走
  Object.defineProperty(select, 'selectedIndex', {
    get() { return this.children.findIndex(o => o.selected); },
    set(i) { this.children.forEach((o, j) => { o.selected = j === i; }); },
  });
  Object.defineProperty(select, 'value', {
    get() { const o = this.children.find(c => c.selected); return o ? o.value : ''; },
    set(v) { this.children.forEach(o => { o.selected = o.value === v; }); },
  });
  select.selectedIndex = 0;
  select.querySelector = sel => {
    const m = sel.match(/^option\[value="(.+)"\]$/);
    return m ? select.children.find(o => o.value === m[1]) || null : null;
  };
  nodes.set('result-fb-type', select);
  nodes.set('result-fb-modal', element('div'));
  nodes.set('result-area', element('main'));
  const session = new Map([['examResult', JSON.stringify({
    catId: 'C', catName: '測試職類', questions, answers, elapsed: 60, examMode: 'normal',
  })]]);
  const local = new Map();
  const document = {
    getElementById: id => nodes.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: element,
    createTextNode: text => ({ textContent: String(text), children: [] }),
    addEventListener() {},
    documentElement: element('html'),
    body: element('body'),
  };
  const context = {
    document,
    sessionStorage: { getItem: k => session.get(k) || null, setItem: (k, v) => session.set(k, v) },
    localStorage: { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, v),
      removeItem: k => local.delete(k) },
    location: { replace() { throw new Error('不應離開結果頁'); }, search: '', href: 'result.html' },
    navigator: {},
    CONFIG: { MODES: { normal: { time: 80 } }, PASS_SCORE: 60 },
    Option: function Option(text, value) {
      const opt = element('option');
      opt.textContent = text;
      opt.value = value;
      return opt;
    },
    URLSearchParams, Intl, Date, setTimeout() {}, clearTimeout() {},
    TextEncoder, encodeURIComponent, fetch, crypto,
  };
  context.window = context;
  context.addEventListener = () => {};
  vm.createContext(context);
  for (const file of ['i18n', 'utils', 'result']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), context);
  }
  return { context, area: nodes.get('result-area'), select };
}

// 與 tools/ai_explain 的 site_fp 同一公式
const fpOf = q => nodeCrypto.createHash('sha256')
  .update(JSON.stringify([q.q, q.options, q.answer]), 'utf8').digest('hex').slice(0, 16);
const settle = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));

const base = { id: 20, q: '有解析的題', options: ['甲', '乙', '丙', '丁'], answer: 3 };
const withoutExplanation = { id: 2, q: '沒有解析的題', options: ['甲', '乙'], answer: 0 };
const basis = [
  { law: '危險性工作場所審查及檢查辦法', article: '第13條', url: LAW + '13' },
  { law: '危險性工作場所審查及檢查辦法', article: '第6條', url: LAW + '6' },
  { law: '職業安全衛生法', article: '第3-1條', url: 'javascript:alert(1)' },
];
// 網站解析檔的一筆（指紋預設依題目算出）
const entry = (q, extra = {}) => ({ fp: fpOf(q), explanation: '解析本文', legalBasis: basis, ...extra });
const siteFile = items => ({ schema: 1, cat: 'C', count: Object.keys(items).length, items });

// 假 fetch：記錄請求路徑，回傳指定內容
function fakeFetch(body, { ok = true, rejects = false, badJson = false } = {}) {
  const calls = [];
  const fn = url => {
    calls.push(url);
    if (rejects) return Promise.reject(new Error('network'));
    return Promise.resolve({
      ok,
      json: () => (badJson ? Promise.reject(new SyntaxError('bad json')) : Promise.resolve(body)),
    });
  };
  fn.calls = calls;
  return fn;
}

async function render(questions, answers, file, fetchOpts) {
  const fetch = fakeFetch(file, fetchOpts);
  const view = loadResult(questions, answers, { fetch });
  await settle();
  return { ...view, fetch };
}

test('解析附法規依據：同法規合成一行、依條號排序、只連 law.moj.gov.tw', async () => {
  const { area, fetch } = await render([base, withoutExplanation], [{ chosen: 0 }, { chosen: 1 }],
    siteFile({ 20: entry(base) }));
  assert.deepEqual(fetch.calls, ['explanations/C.json'], '路徑要 encodeURIComponent(catId)');
  const groups = byClass(area, 'wi-law-group');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].textContent, '危險性工作場所審查及檢查辦法 第6條↗、第13條↗');
  const links = byClass(area, 'wi-law-ref');
  assert.deepEqual(links.map(l => [l.tagName, l.href || null]),
    [['A', LAW + '6'], ['A', LAW + '13'], ['SPAN', null]]);
  assert.ok(links.slice(0, 2).every(l => l.target === '_blank' && l.rel === 'noopener noreferrer'));
  assert.equal(links[2].textContent, '第3-1條');
});

test('解析區塊插在「💬 反饋」按鈕之前，且只掛在指紋相符的題', async () => {
  const { area } = await render([base, withoutExplanation], [{ chosen: 0 }, { chosen: 1 }],
    siteFile({ 20: entry(base) }));
  const items = byClass(area, 'wrong-item');
  assert.equal(items.length, 2);
  const kids = items[0].children.map(c => String(c.className));
  assert.ok(kids.indexOf('wi-explanation') > 0);
  assert.equal(kids.indexOf('wi-explanation') + 1, kids.indexOf('btn btn-feedback'));
  assert.equal(byClass(items[1], 'wi-explanation').length, 0);
});

test('指紋相符才顯示：答案被改、題幹被改、選項被改都不顯示', async () => {
  for (const changed of [{ answer: 1 }, { q: '被改過的題幹' }, { options: ['甲', '乙', '丙', '戊'] }]) {
    const q = { ...base, ...changed };
    const { area } = await render([q], [{ chosen: 0 }], siteFile({ 20: entry(base) }));
    for (const name of ['wi-explanation', 'wl-ai-note', 'wi-law']) {
      assert.equal(byClass(area, name).length, 0, JSON.stringify(changed) + name);
    }
    assert.equal(byClass(area, 'wrong-item').length, 1, '原本的錯題清單照常顯示');
  }
});

test('複選題（答案為陣列）也以指紋比對', async () => {
  const q = { id: 7, q: '複選', options: ['a', 'b', 'c'], answer: [0, 2] };
  const { area } = await render([q], [{ chosen: [0] }], siteFile({ 7: entry(q) }));
  assert.equal(byClass(area, 'wi-explanation').length, 1);
});

test('但書整頁只顯示一次，不在每題解析內重複', async () => {
  const second = { ...base, id: 21 };
  const { area } = await render([base, second], [{ chosen: 0 }, { chosen: 0 }],
    siteFile({ 20: entry(base), 21: entry(second, { legalBasis: [] }) }));
  assert.equal(byClass(area, 'wl-ai-note').length, 1);
  assert.equal(byClass(area, 'wi-explanation').length, 2);
  assert.match(byClass(area, 'wl-ai-note')[0].textContent, /全國法規資料庫.*解析有誤/);
  for (const body of byClass(area, 'wi-explanation-body')) assert.doesNotMatch(body.textContent, /※/);
  assert.equal(byClass(area, 'wi-law').length, 1, '沒有法規依據的題不顯示空的法規列');
  const wl = byClass(area, 'wrong-list')[0];
  assert.equal(wl.children[1].className, 'wl-ai-note', '但書在標題之後、第一題之前');
});

test('沒有任何一題顯示解析時，不出現但書', async () => {
  const { area } = await render([base], [{ chosen: 0 }], siteFile({ 99: entry(base) }));
  assert.equal(byClass(area, 'wl-ai-note').length, 0);
});

test('沒有解析檔內容時，畫面不出現解析、但書與法規列', async () => {
  const { area } = await render([withoutExplanation], [{ chosen: 1 }], siteFile({}));
  for (const name of ['wl-ai-note', 'wi-explanation', 'wi-law']) {
    assert.equal(byClass(area, name).length, 0, name);
  }
});

test('全對時不去抓解析檔', async () => {
  const { fetch } = await render([withoutExplanation], [{ chosen: 0 }], siteFile({}));
  assert.equal(fetch.calls.length, 0);
});

test('fetch 失敗、HTTP 錯誤、JSON 壞掉、格式不對：安靜略過、不丟例外、畫面不變', async () => {
  const good = siteFile({ 20: entry(base) });
  const cases = [
    { file: good, opts: { rejects: true } },
    { file: good, opts: { ok: false } },
    { file: good, opts: { badJson: true } },
    { file: null, opts: {} },
    { file: { schema: 2, items: good.items }, opts: {} },
    { file: { schema: 1, items: [] }, opts: {} },
    { file: siteFile({ 20: null }), opts: {} },
    { file: siteFile({ 20: { fp: fpOf(base) } }), opts: {} },
  ];
  const rejections = [];
  const onRejection = e => rejections.push(e);
  process.on('unhandledRejection', onRejection);
  try {
    for (const { file, opts } of cases) {
      const { area } = await render([base], [{ chosen: 0 }], file, opts);
      assert.equal(byClass(area, 'wi-explanation').length, 0, JSON.stringify(opts));
      assert.equal(byClass(area, 'wl-ai-note').length, 0);
      assert.equal(byClass(area, 'wrong-item').length, 1);
    }
    await settle();
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  assert.deepEqual(rejections, []);
});

test('沒有 fetch 或 crypto.subtle（例如非 https 環境）：不顯示也不報錯', () => {
  for (const opts of [{ fetch: undefined }, { fetch: fakeFetch(siteFile({})), crypto: {} },
    { fetch: fakeFetch(siteFile({})), crypto: undefined }]) {
    const { area } = loadResult([base], [{ chosen: 0 }], opts);
    assert.equal(byClass(area, 'wrong-item').length, 1);
    assert.equal(byClass(area, 'wi-explanation').length, 0);
  }
});

test('「解析有誤」只在顯示了解析的題出現，切到沒有解析的題時移除並重設選取', async () => {
  const { context, select } = await render([base, withoutExplanation],
    [{ chosen: 0 }, { chosen: 1 }], siteFile({ 20: entry(base) }));
  context.openResultFeedback(0);
  assert.deepEqual(select.children.map(o => o.value).slice(-1), ['解析有誤']);
  select.value = '解析有誤';
  context.openResultFeedback(1);
  assert.equal(select.children.some(o => o.value === '解析有誤'), false);
  assert.equal(select.value, '題目有誤');
  context.openResultFeedback(0);
  context.openResultFeedback(0);
  assert.equal(select.children.filter(o => o.value === '解析有誤').length, 1, '重複開啟不重複加入');
});

test('指紋不符的題不出現「解析有誤」', async () => {
  const { context, select } = await render([{ ...base, answer: 0 }], [{ chosen: 1 }],
    siteFile({ 20: entry(base) }));
  context.openResultFeedback(0);
  assert.equal(select.children.some(o => o.value === '解析有誤'), false);
});

test('壞資料不丟例外：legalBasis 非陣列或元素錯誤時略過，不產生空的法規列', async () => {
  for (const legalBasis of ['x', 5, null, {}, [null, 5, 'x', { law: '' }, { law: '   ' }, { law: 7 }]]) {
    const { area } = await render([base], [{ chosen: 0 }], siteFile({ 20: entry(base, { legalBasis }) }));
    assert.equal(byClass(area, 'wi-explanation').length, 1, JSON.stringify(legalBasis));
    assert.equal(byClass(area, 'wi-law').length, 0, JSON.stringify(legalBasis));
  }
});

test('假冒 law.moj.gov.tw 的網址只顯示文字，不做成連結', async () => {
  const evil = ['https://law.moj.gov.tw.evil.com/x', 'https://law.moj.gov.tw@evil.com/',
    'HTTPS://LAW.MOJ.GOV.TW/x', '//law.moj.gov.tw/x', ' https://law.moj.gov.tw/x',
    'http://law.moj.gov.tw/x', 'javascript:alert(1)//https://law.moj.gov.tw/'];
  const legalBasis = evil.map((url, i) => ({ law: '職業安全衛生法', article: '第' + (i + 1) + '條', url }));
  const { area } = await render([base], [{ chosen: 0 }], siteFile({ 20: entry(base, { legalBasis }) }));
  const refs = byClass(area, 'wi-law-ref');
  assert.equal(refs.length, evil.length);
  assert.ok(refs.every(r => r.tagName === 'SPAN' && r.href === undefined));
});

test('條號：數字轉字串、「之」與「-」同樣排序、同條去重', async () => {
  const legalBasis = [
    { law: '職業安全衛生法', article: '第3條之1', url: LAW + '3-1' },
    { law: '職業安全衛生法', article: 6, url: LAW + '6' },
    { law: '職業安全衛生法', article: '第3條', url: LAW + '3' },
    { law: '職業安全衛生法', article: '第3條', url: LAW + '3' },
    { law: '職業安全衛生法', article: '第6條', url: LAW + '6' },
    { law: '職業安全衛生法', article: '第13條之1', url: LAW + '13-1' },
    { law: '職業安全衛生法', article: '第13條2項', url: LAW + '13' },
  ];
  const { area } = await render([base], [{ chosen: 0 }], siteFile({ 20: entry(base, { legalBasis }) }));
  assert.equal(byClass(area, 'wi-law-group')[0].textContent,
    '職業安全衛生法 第3條↗、第3條之1↗、第6條↗、第13條2項↗、第13條之1↗');
});
