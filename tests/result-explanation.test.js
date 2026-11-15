// 結果頁 AI 解析區塊：用最小假 DOM 載入 result.js，不連網、不碰正式題庫。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

function loadResult(questions, answers) {
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
  };
  context.window = context;
  context.addEventListener = () => {};
  vm.createContext(context);
  for (const file of ['i18n', 'utils', 'result']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), context);
  }
  return { context, area: nodes.get('result-area'), select };
}

const withExplanation = {
  id: 20, q: '有解析的題', options: ['甲', '乙', '丙', '丁'], answer: 3,
  explanation: '解析本文',
  legalBasis: [
    { law: '危險性工作場所審查及檢查辦法', article: '第13條', url: LAW + '13' },
    { law: '危險性工作場所審查及檢查辦法', article: '第6條', url: LAW + '6' },
    { law: '職業安全衛生法', article: '第3-1條', url: 'javascript:alert(1)' },
  ],
};
const withoutExplanation = { id: 2, q: '沒有解析的題', options: ['甲', '乙'], answer: 0 };

test('解析附法規依據：同法規合成一行、依條號排序、只連 law.moj.gov.tw', () => {
  const { area } = loadResult([withExplanation, withoutExplanation],
    [{ chosen: 0 }, { chosen: 1 }]);
  const groups = byClass(area, 'wi-law-group');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].textContent, '危險性工作場所審查及檢查辦法 第6條↗、第13條↗');
  const links = byClass(area, 'wi-law-ref');
  assert.deepEqual(links.map(l => [l.tagName, l.href || null]),
    [['A', LAW + '6'], ['A', LAW + '13'], ['SPAN', null]]);
  assert.ok(links.slice(0, 2).every(l => l.target === '_blank' && l.rel === 'noopener noreferrer'));
  assert.equal(links[2].textContent, '第3-1條');
});

test('但書整頁只顯示一次，不在每題解析內重複', () => {
  const second = { ...withExplanation, id: 21, legalBasis: [] };
  const { area } = loadResult([withExplanation, second], [{ chosen: 0 }, { chosen: 0 }]);
  assert.equal(byClass(area, 'wl-ai-note').length, 1);
  assert.equal(byClass(area, 'wi-explanation').length, 2);
  assert.match(byClass(area, 'wl-ai-note')[0].textContent, /全國法規資料庫.*解析有誤/);
  for (const body of byClass(area, 'wi-explanation-body')) assert.doesNotMatch(body.textContent, /※/);
  assert.equal(byClass(area, 'wi-law').length, 1, '沒有法規依據的題不顯示空的法規列');
});

test('題庫沒有解析時，畫面不出現解析、但書與法規列', () => {
  const { area } = loadResult([withoutExplanation], [{ chosen: 1 }]);
  for (const name of ['wl-ai-note', 'wi-explanation', 'wi-law']) {
    assert.equal(byClass(area, name).length, 0, name);
  }
});

test('「解析有誤」只在有解析的題出現，切到沒有解析的題時移除並重設選取', () => {
  const { context, select } = loadResult([withExplanation, withoutExplanation],
    [{ chosen: 0 }, { chosen: 1 }]);
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

test('壞資料不丟例外：legalBasis 非陣列或元素錯誤時略過，不產生空的法規列', () => {
  for (const legalBasis of ['x', 5, null, {}, [null, 5, 'x', { law: '' }, { law: '   ' }, { law: 7 }]]) {
    const q = { ...withExplanation, legalBasis };
    const { area } = loadResult([q], [{ chosen: 0 }]);
    assert.equal(byClass(area, 'wi-explanation').length, 1, JSON.stringify(legalBasis));
    assert.equal(byClass(area, 'wi-law').length, 0, JSON.stringify(legalBasis));
  }
});

test('假冒 law.moj.gov.tw 的網址只顯示文字，不做成連結', () => {
  const evil = ['https://law.moj.gov.tw.evil.com/x', 'https://law.moj.gov.tw@evil.com/',
    'HTTPS://LAW.MOJ.GOV.TW/x', '//law.moj.gov.tw/x', ' https://law.moj.gov.tw/x',
    'http://law.moj.gov.tw/x', 'javascript:alert(1)//https://law.moj.gov.tw/'];
  const q = { ...withExplanation,
    legalBasis: evil.map((url, i) => ({ law: '職業安全衛生法', article: '第' + (i + 1) + '條', url })) };
  const { area } = loadResult([q], [{ chosen: 0 }]);
  const refs = byClass(area, 'wi-law-ref');
  assert.equal(refs.length, evil.length);
  assert.ok(refs.every(r => r.tagName === 'SPAN' && r.href === undefined));
});

test('條號：數字轉字串、「之」與「-」同樣排序、同條去重', () => {
  const q = { ...withExplanation, legalBasis: [
    { law: '職業安全衛生法', article: '第3條之1', url: LAW + '3-1' },
    { law: '職業安全衛生法', article: 6, url: LAW + '6' },
    { law: '職業安全衛生法', article: '第3條', url: LAW + '3' },
    { law: '職業安全衛生法', article: '第3條', url: LAW + '3' },
    { law: '職業安全衛生法', article: '第6條', url: LAW + '6' },
    { law: '職業安全衛生法', article: '第13條之1', url: LAW + '13-1' },
    { law: '職業安全衛生法', article: '第13條2項', url: LAW + '13' },
  ] };
  const { area } = loadResult([q], [{ chosen: 0 }]);
  assert.equal(byClass(area, 'wi-law-group')[0].textContent,
    '職業安全衛生法 第3條↗、第3條之1↗、第6條↗、第13條2項↗、第13條之1↗');
});
