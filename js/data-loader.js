// 公開題庫讀取：即時 API 優先，通過校驗的快照與職類清單才可備援。
const CATEGORY_CACHE_KEY = 'exam_categories_v1'; // gitleaks:allow - localStorage 名稱，非憑證
const SNAPSHOT_MAX_AGE = 24 * 60 * 60 * 1000;
var _categoryRequest = null;

function validCategories(value) {
  return Array.isArray(value) && value.length > 0 && value.every(function(cat) {
    return cat && typeof cat.id === 'string' && /^[\u4e00-\u9fff\w]+$/.test(cat.id) &&
      typeof cat.name === 'string' && typeof cat.group === 'string' &&
      Number.isInteger(cat.total) && cat.total > 0;
  });
}

function validQuestions(value) {
  return Array.isArray(value) && value.length > 0 && value.every(function(q) {
    if (!q || typeof q.q !== 'string' || !Array.isArray(q.options) ||
        q.options.length < 2 || !q.options.every(function(opt) { return typeof opt === 'string'; })) return false;
    if (!(Number.isInteger(q.id) || (typeof q.id === 'string' && q.id.length > 0))) return false;
    if (q.image && typeof q.image !== 'string') return false;
    if (q.optionImages && (!Array.isArray(q.optionImages) ||
        q.optionImages.length > q.options.length || !q.optionImages.every(function(image) {
          return image == null || typeof image === 'string';
        }))) return false;
    if ((q.type === 'multi' || q.multi === true) && !Array.isArray(q.answer)) return false;
    var answer = Array.isArray(q.answer) ? q.answer : [q.answer];
    return answer.length > 0 && answer.every(function(index) {
      return Number.isInteger(index) && index >= 0 && index < q.options.length;
    });
  });
}

function readCategoryCache() {
  try {
    var saved = JSON.parse(localStorage.getItem(CATEGORY_CACHE_KEY));
    var age = saved ? Date.now() - saved.savedAt : NaN;
    if (saved && saved.version === 1 && age >= 0 && age < SNAPSHOT_MAX_AGE &&
        validCategories(saved.data)) return saved;
  } catch (_) { }
  return null;
}

function saveCategoryCache(data, savedAt) {
  try {
    localStorage.setItem(CATEGORY_CACHE_KEY, JSON.stringify({
      version: 1, savedAt: savedAt || Date.now(), data: data
    }));
  } catch (_) { } // 儲存空間受限不阻擋線上載入
}

async function fetchPublicJson(url, timeoutMs, validate) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  try {
    var response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var data = await response.json();
    if (data && data.error) {
      var error = new Error(data.error);
      error.rateLimited = data.error.indexOf('過於頻繁') >= 0;
      throw error;
    }
    if (!validate(data)) throw new Error('Invalid data format');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(t('error.timeout'));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadStaticSnapshot(action, params) {
  var base = CONFIG.PUBLIC_BANKS_URL;
  var manifest = await fetchPublicJson(base + 'manifest.json', 5000, function(value) {
    var age = value ? Date.now() - Date.parse(value.generatedAt) : NaN;
    return value && value.schema === 1 && age >= -60000 && age < SNAPSHOT_MAX_AGE &&
      validCategories(value.categories) && value.banks && typeof value.banks === 'object';
  });
  if (action === 'categories') {
    saveCategoryCache(manifest.categories, Date.parse(manifest.generatedAt));
    return manifest.categories;
  }
  var entry = manifest.banks[params.cat];
  if (!entry || !/^[a-f0-9]{64}\.json$/.test(entry.file) ||
      entry.sha256 !== entry.file.slice(0, -5)) throw new Error('Invalid snapshot entry');
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, 12000);
  try {
    var response = await fetch(base + entry.file, { signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var bytes = await response.arrayBuffer();
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    var hash = Array.from(new Uint8Array(digest)).map(function(b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
    if (hash !== entry.sha256) throw new Error('Snapshot checksum mismatch');
    var data = JSON.parse(new TextDecoder().decode(bytes));
    if (!validQuestions(data) || data.length !== entry.total) throw new Error('Invalid snapshot bank');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function loadPublicData(action, params) {
  params = params || {};
  var query = new URLSearchParams(Object.assign({}, params, {
    action: action, token: CONFIG.API_TOKEN, clientId: getOrCreateClientId()
  }));
  var url = CONFIG.GAS_URL + '?' + query;
  var validate = action === 'categories' ? validCategories : validQuestions;
  var timeout = action === 'categories' ? 8000 : 12000;
  var firstError;
  try {
    var data = await fetchPublicJson(url, timeout, validate);
    if (action === 'categories') saveCategoryCache(data);
    return data;
  } catch (error) { firstError = error; }
  try {
    var backup = await loadStaticSnapshot(action, params);
    showToast(t('load.backup'), 5000);
    return backup;
  } catch (_) { }
  // 限流不立即重送；網路暫時失敗只多試一次，避免重試風暴。
  if (!firstError.rateLimited) {
    await new Promise(function(resolve) { setTimeout(resolve, 500 + Math.random() * 500); });
    try {
      var retry = await fetchPublicJson(url, timeout, validate);
      if (action === 'categories') saveCategoryCache(retry);
      return retry;
    } catch (_) { }
  }
  if (action === 'categories') {
    var saved = readCategoryCache();
    if (saved) { showToast(t('load.backup'), 5000); return saved.data; }
  }
  throw firstError;
}

function loadCategoryData(force) {
  var saved = readCategoryCache();
  if (!force && saved && Date.now() - saved.savedAt < 15 * 60 * 1000) {
    return Promise.resolve(saved.data);
  }
  if (!_categoryRequest) {
    _categoryRequest = loadPublicData('categories').finally(function() { _categoryRequest = null; });
  }
  return _categoryRequest;
}

function appendLoadRetry(container, retry) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-start';
  button.style.marginTop = '16px';
  button.textContent = t('load.retry');
  button.onclick = function() { button.disabled = true; retry(); };
  container.appendChild(button);
}
