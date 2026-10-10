// 使用隔離瀏覽器與假題庫驗證 UI/PWA，不呼叫生產 GAS 或寫入學員資料。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
// 固定發布前基準，避免提交新版後 HEAD 跟著移動而失去舊版升級測試。
const baselineRef = 'efbad62ac97d03f6825335d0220b967c6619a0c7';
const currentVersion = fs.readFileSync(path.join(root, 'sw.js'), 'utf8')
  .match(/exam-v(\d{8}[a-z])/)[1];
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'iat-practice-ux-'));
const languages = ['zh-TW', 'vi', 'id', 'th', 'en', 'fil'];
const suffixes = ['本籍', '越南', '印尼', '泰國', '英文', '菲律賓'];
const categories = suffixes.map(suffix => ({ id: '堆高機_' + suffix,
  name: '堆高機操作人員（' + suffix + '）', group: '即測即評', total: 2 }));
const questions = [
  { id: 1, q: 'UI verification: single-choice question', options: ['One', 'Two', 'Three'], answer: 0 },
  { id: 2, q: 'UI verification: multiple-choice question',
    options: ['One', 'Two', 'Three'], answer: [0, 2], type: 'multi', multi: true },
];
let stage = 'new';
let apiDelay = 0;
const apiCalls = [];
const sources = new Map();
const errors = [];
const results = [];
const pwaOnly = process.argv.includes('--pwa-only');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png' };

function source(file) {
  const key = stage + ':' + file;
  if (sources.has(key)) return sources.get(key);
  let value = stage === 'old'
    ? execFileSync('git', ['show', baselineRef + ':' + file], { cwd: root })
    : fs.readFileSync(path.join(root, file));
  if (file === 'js/config.js') {
    value = Buffer.from(value.toString().replace(/GAS_URL:\s*["'][^"']+["']/,
      "GAS_URL: '/api'").replace(/API_TOKEN:\s*["'][^"']+["']/, "API_TOKEN: 'ui-test'"));
  }
  if (stage === 'next' && file === 'sw.js') {
    value = Buffer.from(value.toString().replace(/exam-v\d{8}[a-z]/, 'exam-v' + currentVersion + '-ui-next'));
  }
  sources.set(key, value);
  return value;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api') {
    const action = url.searchParams.get('action');
    apiCalls.push({ action, method: request.method });
    if (apiDelay) await new Promise(resolve => setTimeout(resolve, apiDelay));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(action === 'categories' ? categories : questions));
    return;
  }
  const file = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
  if (!/^(?:index|exam|result|query|exam-query)\.html$|^sw\.js$|^manifest\.json$|^(?:js|css|images|icons)\/[\w.-]+$/.test(file)) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(source(file));
  } catch (_) { response.writeHead(404).end(); }
});

function snapshot(lang, mode = 'normal') {
  return { catId: categories[languages.indexOf(lang)].id, catName: 'UI verification category',
    examMode: mode, questions, current: 1, timerSeconds: 120,
    answers: [{ chosen: 0, hinted: false }, { chosen: [0, 2], hinted: false }],
    savedAt: new Date().toISOString() };
}

async function noOverflow(page, label) {
  const layout = await page.evaluate(() => ({ viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    header: document.querySelector('.site-header').getBoundingClientRect().toJSON(),
    exam: document.querySelector('.exam-header')?.getBoundingClientRect().toJSON(),
    nav: document.querySelector('.q-nav-wrap')?.getBoundingClientRect().toJSON() }));
  assert.ok(layout.width <= layout.viewport + 1, label + ': horizontal overflow ' + JSON.stringify(layout));
  if (layout.exam && layout.nav) {
    assert.ok(layout.exam.top >= layout.header.bottom - 1, label + ': header overlap');
    assert.ok(layout.nav.top >= layout.exam.bottom - 1, label + ': question navigation overlap');
  }
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ headless: true,
    ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  try {
    for (const width of pwaOnly ? [] : [1280, 360]) {
      for (const lang of languages) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
        await context.route('https://**/*', route => route.abort());
        await context.addInitScript(lang => {
          if (!localStorage.getItem('lang')) {
            localStorage.setItem('lang', lang);
            localStorage.setItem('lang_schema', '2');
          }
          sessionStorage.setItem('notice_seen', '1');
        }, lang);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        await page.locator('#cat-select').waitFor();
        assert.equal(await page.locator('#major-updates').isVisible(), false);
        const sizes = [];
        for (const size of ['normal', 'large', 'xlarge']) {
          if (size !== 'normal') await page.locator('.site-header .fontsize-btn').click();
          assert.equal(await page.locator('html').getAttribute('data-fontsize'), size);
          sizes.push(await page.locator('.select-label').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)));
        }
        assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], 'Home font: ' + lang);
        const fontButton = page.locator('.site-header .fontsize-btn');
        for (const theme of ['light', 'dark']) {
          await page.evaluate(theme => applyTheme(theme), theme);
          await fontButton.hover();
          const colors = await fontButton.evaluate(el => ({
            text: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor,
          }));
          assert.equal(colors.text, 'rgb(255, 255, 255)', 'Header font text: ' + theme);
          assert.equal(colors.background, 'rgba(255, 255, 255, 0.12)', 'Header font hover: ' + theme);
        }
        await page.evaluate(() => applyTheme('light'));
        await page.evaluate(saved => localStorage.setItem('exam_save', JSON.stringify(saved)), snapshot(lang));
        await page.goto(base + 'exam.html?cat=' + encodeURIComponent(snapshot(lang).catId));
        await page.locator('.option-btn').first().waitFor();
        assert.equal(await page.locator('#exam-title').textContent(), 'UI verification category');
        assert.equal(await page.locator('.multi-badge').textContent(), await page.evaluate(() => t('exam.multi')));
        await page.waitForTimeout(100);
        await noOverflow(page, lang + '/' + width);
        if ((lang === 'zh-TW' && width === 1280) || (lang === 'th' && width === 360)) {
          await page.screenshot({ path: path.join(output, 'exam-' + lang + '-' + width + '.png'), fullPage: true, animations: 'disabled' });
        }
        await page.locator('#btn-home').focus();
        await page.keyboard.press('Enter');
        await page.locator('#home-confirm-modal.open').waitFor();
        assert.equal(await page.evaluate(() => current), 1);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'home-cancel');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'home-confirm');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'home-cancel');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-home');
        await page.locator('#btn-home').click();
        await noOverflow(page, 'dialog/' + lang + '/' + width);
        if (lang === 'fil' && width === 360) {
          await page.screenshot({ path: path.join(output, 'home-dialog-fil-360.png'), fullPage: true, animations: 'disabled' });
        }
        await page.locator('#home-confirm').click();
        await page.waitForURL('**/index.html');
        await page.locator('#resume-banner').waitFor();
        assert.ok((await page.locator('#resume-banner .resume-info').textContent()).includes('1/2'));
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('exam_save')));
        assert.deepEqual(saved.answers[1].chosen, [0, 2]);
        assert.equal(saved.current, 1);
        assert.ok(saved.timerSeconds <= 120 && saved.timerSeconds > 110);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('examResult')), null);
        if (lang === 'zh-TW' && width === 1280) {
          await page.goBack();
          await page.locator('.option-btn').first().waitFor();
          assert.equal(await page.evaluate(() => isLeaving), false);
          await page.locator('#btn-home').click();
          await page.locator('#home-confirm').click();
          await page.waitForURL('**/index.html');
          await page.locator('#resume-banner').waitFor();
        }
        await page.locator('#resume-banner .btn-primary').click();
        await page.locator('.option-btn').first().waitFor();
        assert.deepEqual(await page.evaluate(() => answers[1].chosen), [0, 2]);
        assert.equal(await page.evaluate(() => current), 1);
        results.push({ test: 'font-home-resume-layout', lang, width, status: 'PASS' });
        await context.close();
      }
    }

    if (!pwaOnly) {
    const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
    await context.route('https://**/*', route => route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    apiDelay = 1500;
    await page.goto(base);
    await page.locator('#notice-modal .fontsize-btn').click();
    const normal = await page.locator('#notice-modal p').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await page.locator('#notice-modal .fontsize-btn').click();
    const large = await page.locator('#notice-modal p').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(large > normal);
    await page.locator('#notice-confirm').click();
    await noOverflow(page, 'first-visit/font/320');
    await page.locator('#cat-select').waitFor();
    apiDelay = 0;
    await page.evaluate(saved => localStorage.setItem('exam_save', JSON.stringify(saved)), snapshot('zh-TW', 'mock'));
    await page.goto(base + 'exam.html?cat=' + encodeURIComponent(snapshot('zh-TW').catId) + '&examMode=mock');
    await page.locator('.option-btn').first().waitFor();
    await page.evaluate(() => {
      localStorage.setItem('feedback_queue', '[]');
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'exam_save') throw new Error('QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await page.locator('#btn-home').click();
    await page.locator('#home-confirm').click();
    assert.equal(await page.locator('#home-save-error').isVisible(), true);
    assert.ok(page.url().includes('exam.html'));
    await page.keyboard.press('Escape');
    await page.goto(base + 'query.html');
    await page.locator('.query-title').waitFor();
    await noOverflow(page, 'query/320');
    await page.goto(base + 'exam-query.html');
    await noOverflow(page, 'exam-query/320');
    await page.evaluate(result => sessionStorage.setItem('examResult', JSON.stringify(result)),
      { ...snapshot('zh-TW'), elapsed: 20 });
    await page.goto(base + 'result.html');
    await page.locator('.site-header .fontsize-btn').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-fontsize'), 'xlarge');
    await noOverflow(page, 'result/320');
    await context.close();
    results.push({ test: 'first-visit-loading-storage-denied-query-layout', status: 'PASS' });
    }

    // 真正安裝舊 Service Worker，再更新其快取版本；不是只模擬 controllerchange。
    stage = 'old';
    const pwa = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    await pwa.route('https://**/*', route => route.abort());
    const app = await pwa.newPage();
    app.on('pageerror', error => errors.push(error.message));
    await app.goto(base);
    await app.evaluate(async () => { await navigator.serviceWorker.ready; });
    await app.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.ok((await app.evaluate(() => caches.keys())).includes('exam-v20260930a'));
    await app.evaluate(() => { sessionStorage.setItem('notice_seen', '1'); window.noReloadMarker = 'kept'; });
    stage = 'new';
    await app.evaluate(async () => {
      window.nextController = new Promise(resolve =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
      await window.nextController;
    });
    await app.waitForFunction(async version => (await caches.keys()).includes('exam-v' + version) &&
      !(await caches.keys()).includes('exam-v20260930a'), currentVersion);
    assert.equal(await app.evaluate(() => window.noReloadMarker), 'kept');
    await app.reload();
    await app.locator('#cat-select').waitFor();
    const versions = await app.evaluate(async () => ({
      page: document.querySelector('link[rel="stylesheet"]').getAttribute('href'),
      caches: await Promise.all((await caches.keys()).map(async name => ({ name,
        root: ((await (await caches.open(name)).match('./')) &&
          (await (await (await caches.open(name)).match('./')).text()).match(/style\.css\?v=\d+[a-z]/)?.[0]) }))),
    }));
    assert.equal(await app.locator('link[href="css/style.css?v=' + currentVersion + '"]').count(), 1,
      'PWA version trace: ' + JSON.stringify(versions));
    await app.evaluate(saved => localStorage.setItem('exam_save', JSON.stringify(saved)), snapshot('zh-TW', 'mock'));
    await app.goto(base + 'exam.html?cat=' + encodeURIComponent(snapshot('zh-TW').catId) + '&examMode=mock');
    await app.locator('.option-btn').first().waitFor();
    await app.evaluate(() => { window.noReloadMarker = 'exam-kept'; });
    stage = 'next';
    await app.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    await app.locator('#site-update-notice').waitFor();
    assert.equal(await app.evaluate(() => window.noReloadMarker), 'exam-kept');
    assert.equal(await app.locator('#site-update-notice button').count(), 0);
    assert.deepEqual(await app.evaluate(() => answers[1].chosen), [0, 2]);
    await app.locator('#btn-home').click();
    await app.locator('#home-confirm').click();
    await app.waitForURL('**/index.html');
    await app.locator('#resume-banner').waitFor();
    assert.deepEqual(await app.evaluate(() => JSON.parse(localStorage.getItem('exam_save')).answers[1].chosen), [0, 2]);
    await app.screenshot({ path: path.join(output, 'pwa-updated-home-390.png'), fullPage: true });
    await pwa.setOffline(true);
    await app.reload();
    await app.locator('#resume-banner').waitFor();
    assert.equal(await app.locator('link[href="css/style.css?v=' + currentVersion + '"]').count(), 1);
    await pwa.close();
    results.push({ test: 'pwa-old-new-live-exam-offline', status: 'PASS' });
    assert.deepEqual(errors, []);
    assert.equal(apiCalls.filter(call => call.method === 'POST').length, 0);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ results,
      runtimeErrors: errors, productionRequests: 0, simulatedApiCalls: apiCalls.length }, null, 2));
    console.log(JSON.stringify({ output, passed: results.length, runtimeErrors: errors.length,
      productionRequests: 0, status: 'PASS' }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
