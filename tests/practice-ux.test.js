const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const languages = ['zh-TW', 'vi', 'id', 'th', 'en', 'fil'];
const sampleQuestions = [
  { id: 1, q: '測試單選', options: ['甲', '乙'], answer: 0 },
  { id: 2, q: '測試複選', options: ['甲', '乙', '丙'], answer: [0, 2] },
];

function browser(page = 'exam', mode = 'normal', review = false) {
  const nodes = new Map();
  const values = new Map();
  const sessionValues = new Map();
  const handlers = new Map();
  const beacons = [];
  const clearedTimers = [];
  const document = {
    readyState: 'loading', hidden: false,
    addEventListener() {},
    getElementById: id => nodes.get(id) || null,
    querySelector: selector => selector === '.site-header' ? nodes.get('site-header') : null,
    querySelectorAll: selector => selector === '.fontsize-btn' ? [nodes.get('font')] : [],
  };
  function element(tag = 'div') {
    const classes = new Set();
    return {
      tagName: tag.toUpperCase(), children: [], attributes: {}, hidden: false,
      style: { setProperty() {} },
      classList: { add: c => classes.add(c), remove: c => classes.delete(c),
        contains: c => classes.has(c), toggle() {} },
      setAttribute(name, value) {
        this.attributes[name] = value;
        if (name === 'id') this.id = value;
      },
      getAttribute(name) { return this.attributes[name]; },
      set textContent(value) { this.text = value; this.children = []; },
      get textContent() { return this.text || ''; },
      appendChild(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); },
      after(child) { document.body.appendChild(child); },
      getBoundingClientRect: () => ({ height: 64 }),
      focus() { document.activeElement = this; },
    };
  }
  document.createElement = element;
  document.documentElement = element('html');
  document.body = element('body');
  for (const id of ['font', 'site-header', 'btn-home', 'home-cancel', 'home-confirm',
    'home-confirm-modal', 'home-confirm-body', 'home-save-error', 'feedback-modal',
    'end-confirm-modal', 'select-wrap', 'major-updates', 'major-updates-list']) {
    nodes.set(id, element(id.includes('cancel') || id === 'btn-home' ? 'button' : 'div'));
  }
  nodes.get('major-updates').hidden = true;
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const context = {
    document, localStorage: storage,
    sessionStorage: { getItem: key => sessionValues.get(key) || null,
      setItem: (key, value) => sessionValues.set(key, value) },
    navigator: { sendBeacon: (...args) => beacons.push(args) },
    location: { search: '?cat=test&examMode=' + mode + (review ? '&mode=review' : ''),
      href: page + '.html', protocol: 'https:', pathname: '/' + page + '.html', reload() {} },
    CONFIG: { DEFAULT_MODE: 'normal', MODES: { normal: { time: 80 },
      speed: { time: 20 }, mock: { time: 80 } } },
    URLSearchParams, Intl, Date, AbortController,
    setTimeout() {}, clearTimeout() {}, setInterval: () => 7,
    clearInterval: id => clearedTimers.push(id),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    loadCategoryData: () => new Promise(() => {}),
  };
  context.window = context;
  context.addEventListener = (name, callback) => {
    if (!handlers.has(name)) handlers.set(name, []);
    handlers.get(name).push(callback);
  };
  context.dispatchEvent = event => (handlers.get(event.type) || []).forEach(fn => fn(event));
  vm.createContext(context);
  function run(code) { return vm.runInContext(code, context); }
  for (const file of ['i18n', 'utils']) {
    run(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'));
  }
  if (page === 'exam') {
    run(fs.readFileSync(path.join(root, 'js/exam.js'), 'utf8').replace(/\ninit\(\);\s*$/, '\n'));
  } else {
    run(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'));
  }
  function ready() {
    run('questions = ' + JSON.stringify(sampleQuestions) + ';' +
      'answers = [{chosen: 0, hinted: false}, {chosen: [0, 2], hinted: false}];' +
      'current = 1; catName = "測試職類"; timerSeconds = 120; timerInterval = 7;');
  }
  return { context, run, ready, nodes, storage, values, sessionValues, beacons, clearedTimers };
}

test('字體大小立即生效並循環，無須先取得題庫', () => {
  const { context, nodes, run, values } = browser();
  for (const size of ['large', 'xlarge', 'normal']) {
    context.cycleFontSize();
    assert.equal(context.document.documentElement.attributes['data-fontsize'], size);
    assert.equal(values.get('fontsize_pref'), size);
  }
  assert.equal(nodes.get('font').textContent, 'A');
  assert.equal(run('questions.length'), 0);
});

test('髒的字體設定回到標準，儲存權限失敗仍能切換文字和語言', () => {
  const { context, values, storage } = browser();
  values.set('fontsize_pref', 'invalid');
  assert.equal(context.getFontSizePref(), 'normal');
  storage.getItem = storage.setItem = () => { throw new Error('Storage blocked'); };
  context.setLang('vi');
  context.cycleFontSize();
  context.cycleFontSize();
  assert.equal(context.getLang(), 'vi');
  assert.equal(context.getFontSizePref(), 'xlarge');
  assert.equal(context.document.documentElement.attributes['data-fontsize'], 'xlarge');
});

test('首頁提早讀存檔時，髒資料不能中斷載入，也不刪除原檔', () => {
  const { context, values } = browser('index');
  const invalid = ['{', '{}', '{"answers":[]}', JSON.stringify({ catId: 'test', catName: 'Test',
    examMode: 'normal', questions: sampleQuestions, answers: [null, null], current: 0, timerSeconds: 60 })];
  for (const value of invalid) {
    values.set('exam_save', value);
    assert.equal(context.loadProgress(), null);
    context.renderResumeBanner();
    assert.equal(values.get('exam_save'), value);
  }
});

test('首頁存檔提示的已答數與 normal/mock 複選規則一致', () => {
  const { context, nodes, values } = browser('index');
  nodes.set('resume-banner', context.document.createElement('div'));
  const saved = { catId: 'test', catName: 'Test', examMode: 'normal', questions: sampleQuestions,
    answers: [{ chosen: 0, hinted: false }, { chosen: [0, 2], hinted: false }], current: 1,
    timerSeconds: 60, savedAt: new Date().toISOString() };
  for (const [mode, chosen, submitted, count] of [
    ['normal', [0, 2], false, 1], ['normal', [0, 2], true, 2],
    ['mock', [0, 2], false, 2], ['mock', [], false, 1],
  ]) {
    saved.examMode = mode;
    saved.answers[1] = { chosen, hinted: false, submitted };
    values.set('exam_save', JSON.stringify(saved));
    context.renderResumeBanner();
    const text = nodes.get('resume-banner').children[0].children[1].textContent;
    assert.ok(text.includes(count + '/2'), text);
  }
});

test('所有新控制項與提示均有中文及五種外語，不靠中文 fallback', () => {
  const { run, context, nodes } = browser();
  const keys = ['font.size', 'font.normal', 'font.large', 'font.xlarge', 'font.next',
    'updates.title', 'exam.home', 'exam.multi', 'exam.submit.multi', 'exam.choices',
    'exam.image', 'exam.option', 'home.title', 'home.body', 'home.review.body',
    'home.cancel', 'home.save', 'home.save.error', 'update.ready', 'update.exam', 'update.reload'];
  for (const lang of languages) {
    for (const key of keys) {
      assert.equal(run('typeof I18N[' + JSON.stringify(key) + '][' + JSON.stringify(lang) + ']'), 'string');
    }
    context.setLang(lang);
    assert.ok(nodes.get('font').attributes['aria-label'].startsWith(context.t('font.size')));
  }
});

test('空字串翻譯是有效值，英文及菲律賓介面不會多出中文「題」', () => {
  const { context } = browser();
  for (const lang of ['en', 'fil']) {
    context.setLang(lang);
    assert.equal(context.t('exam.q.unit'), '');
  }
});

for (const mode of ['normal', 'speed', 'mock']) {
  test(mode + ' 返回首頁保留複選答案、題序和時間，不交卷或送統計', () => {
    const { context, ready, values, run, beacons, sessionValues, clearedTimers } = browser('exam', mode);
    ready();
    values.set('feedback_queue', '[{"test":true}]');
    context.requestGoHome();
    assert.equal(context.location.href, 'exam.html');
    context.confirmGoHome();
    const saved = JSON.parse(values.get('exam_save'));
    assert.deepEqual(saved.questions, sampleQuestions);
    assert.deepEqual(saved.answers[1].chosen, [0, 2]);
    assert.equal(saved.current, 1);
    assert.equal(saved.timerSeconds, 120);
    assert.equal(saved.examMode, mode);
    assert.equal(context.location.href, 'index.html');
    context.finishExam();
    assert.equal(run('isFinishing'), false);
    assert.equal(beacons.length, 0);
    assert.equal(sessionValues.has('examResult'), false);
    assert.equal(values.get('feedback_queue'), '[{"test":true}]');
    assert.deepEqual(clearedTimers, [7]);
  });
}

test('存檔失敗或讀回不符都禁止離開，保留計時器及原始反饋佇列', () => {
  for (const fail of [() => { throw new Error('Quota exceeded'); }, () => {}]) {
    const { context, ready, values, storage, nodes, clearedTimers } = browser();
    ready();
    values.set('feedback_queue', 'preserved');
    context.requestGoHome();
    storage.setItem = fail;
    context.confirmGoHome();
    assert.equal(context.location.href, 'exam.html');
    assert.equal(nodes.get('home-save-error').hidden, false);
    assert.equal(nodes.get('home-confirm-modal').classList.contains('open'), true);
    assert.equal(values.get('feedback_queue'), 'preserved');
    assert.deepEqual(clearedTimers, []);
  }
});

test('取消返回及 modal 的 Enter 不會偷偷前進題目，Escape 還原按鈕焦點', () => {
  const { context, ready, run, nodes, values } = browser();
  ready();
  context.requestGoHome();
  context.handleKey({ key: 'Enter', target: nodes.get('home-cancel') });
  assert.equal(run('current'), 1);
  let prevented = false;
  context.handleHomeDialogKey({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(nodes.get('home-confirm-modal').classList.contains('open'), false);
  assert.equal(context.document.activeElement, nodes.get('btn-home'));
  assert.equal(values.has('exam_save'), false);
});

test('返回對話框的 Tab 焦點不跑到背後的答題按鈕', () => {
  const { context, ready, nodes } = browser();
  ready();
  context.requestGoHome();
  context.handleHomeDialogKey({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(context.document.activeElement, nodes.get('home-confirm'));
  context.handleHomeDialogKey({ key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(context.document.activeElement, nodes.get('home-cancel'));
});

test('選項有焦點時仍可用方向鍵換題，不攔截按鈕的原生 Enter', () => {
  const { context, ready, run } = browser();
  ready();
  const option = { tagName: 'BUTTON' };
  let previous = 0;
  context.prevQ = () => previous++;
  context.handleKey({ key: 'ArrowLeft', target: option });
  assert.equal(previous, 1);
  context.handleKey({ key: 'Enter', target: option });
  assert.equal(run('current'), 1);
});

test('BFCache 恢復已返回首頁的作答頁時，從存檔重新啟動', () => {
  const { context, ready } = browser();
  let reloads = 0;
  context.location.reload = () => reloads++;
  context.dispatchEvent({ type: 'pageshow', persisted: true });
  assert.equal(reloads, 0);
  ready();
  context.confirmGoHome();
  context.dispatchEvent({ type: 'pageshow', persisted: false });
  assert.equal(reloads, 0);
  context.dispatchEvent({ type: 'pageshow', persisted: true });
  assert.equal(reloads, 1);
});

test('題庫仍在載入時可以直接回首頁，不產生成績', () => {
  const { context, beacons } = browser();
  context.requestGoHome();
  assert.equal(context.location.href, 'index.html');
  assert.equal(beacons.length, 0);
});

test('錯題複習返回首頁不覆蓋另一份未完成的正常測驗', () => {
  const { context, ready, values, nodes, beacons } = browser('exam', 'normal', true);
  ready();
  values.set('exam_save', 'original normal exam');
  context.requestGoHome();
  assert.equal(nodes.get('home-confirm-body').textContent, context.t('home.review.body'));
  context.confirmGoHome();
  assert.equal(values.get('exam_save'), 'original normal exam');
  assert.equal(context.location.href, 'index.html');
  assert.equal(beacons.length, 0);
});

test('公告預設隱藏，只顯示日期有效且六語完整的已驗證重大更新', () => {
  const { context, run, nodes } = browser('index');
  assert.equal(nodes.get('major-updates').hidden, true);
  const translations = Object.fromEntries(languages.map(code => [code, 'Test ' + code]));
  const good = { publishedOn: '2020-01-01', major: true, verified: true,
    title: translations, summary: translations };
  const entries = [good, { ...good, verified: false }, { ...good, major: false },
    { ...good, publishedOn: '2999-01-01' }, { ...good, publishedOn: '2020-02-31' },
    { ...good, summary: { 'zh-TW': 'Incomplete' } }];
  run('MAJOR_UPDATES.push(...' + JSON.stringify(entries) + ');');
  for (const lang of languages) {
    context.setLang(lang);
    assert.equal(nodes.get('major-updates').hidden, false);
    const list = nodes.get('major-updates-list');
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].children[1].textContent, 'Test ' + lang);
  }
});

test('公告不使用 HTML 渲染，最多列出最新三則', () => {
  const { context, run, nodes } = browser('index');
  const strings = Object.fromEntries(languages.map(code => [code, '<img src=x onerror=alert(1)>']));
  const entries = [1, 2, 3, 4].map(day => ({ publishedOn: '2020-01-0' + day,
    major: true, verified: true, title: strings, summary: strings }));
  run('MAJOR_UPDATES.push(...' + JSON.stringify(entries) + ');');
  context.renderMajorUpdates();
  const list = nodes.get('major-updates-list');
  assert.equal(list.children.length, 3);
  assert.equal(list.children[0].children[0].textContent, '2020-01-04');
  assert.equal(list.children[0].children[2].textContent, strings['zh-TW']);
  assert.equal(list.children[0].children[2].children.length, 0);
});

test('PWA 作答頁新版提示沒有重整按鈕，不會觸發交卷', () => {
  const { context, nodes, beacons } = browser();
  context.showSiteUpdateNotice();
  context.showSiteUpdateNotice();
  const notices = context.document.body.children.filter(node => node.id === 'site-update-notice');
  assert.equal(notices.length, 1);
  assert.equal(nodes.get('site-update-notice').children.length, 1);
  assert.equal(context.location.href, 'exam.html');
  assert.equal(beacons.length, 0);
});

test('PWA 首頁提供使用者主動重整，沒有自動 reload', () => {
  const { context, nodes } = browser('index');
  let reloads = 0;
  context.location.reload = () => reloads++;
  context.showSiteUpdateNotice();
  assert.equal(reloads, 0);
  const button = nodes.get('site-update-notice').children[1];
  assert.equal(button.textContent, context.t('update.reload'));
  button.onclick();
  assert.equal(reloads, 1);
});
