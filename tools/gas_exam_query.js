/**
 * 即測即評測驗日期查詢 GAS 後端
 *
 * 部署步驟：
 * 1. 開啟 Google Apps Script (https://script.google.com)
 * 2. 新建專案，貼入此程式碼
 * 3. 修改下方 CONFIG：填入 Google Drive 資料夾 ID
 * 4. 部署為「網頁應用程式」，存取權限選「任何人」
 * 5. 複製部署網址，貼到 exam-site/js/exam-query.js 的 API_URL
 *
 * 資料來源（Google Drive，用 tools/convert.py 轉檔後上傳）：
 * - 報檢資料.csv（術科報檢資料，來自 xxx報檢資料.xlsx）
 * - 學科報檢資料.csv（來自 xxx學科報檢資料.xlsx）
 *
 * 使用方式：
 * - POST 請求，body: {"action": "examQuery", "idno": "A123456789"}
 * - 回傳: {"success": true, "data": [{...}]}
 */

// ======== 設定區 ========
var CONFIG = {
  DRIVE_FOLDER_ID: '1m25N871mzri19gvM63FD1cYDoyQvp2rl', // Google Drive 資料夾 ID
  DEBUG_TOKEN: 'ZmBIGjWRJXn3R2ejc-XE6A', // 除錯 token（僅開發者知道）
  CACHE_TTL: 300, // 查詢結果快取 5 分鐘
  RATE_LIMIT: 30, // 每分鐘每個 idno 最多 30 次
  GLOBAL_RATE_LIMIT: 300, // 全站每分鐘最多 300 次（防止 idno 輪替攻擊）
};

// 學科考場名稱常數
var DEFAULT_WRITTEN_ROOM = '龍井教室 2 樓即測即評學科電腦教室';

// 職類代碼對照
var PNO_MAP = {
  '00400': '男子西服', '00700': '女子服裝', '02000': '餐飲服務',
  '03100': '美容', '06000': '一般車床',
  '06100': '固定式起重機操作', '06200': '移動式起重機操作',
  '07400': '氣銲', '07700': '建築物室內配線',
  '09900': '鍋爐操作', '11800': '特定氣體熔接',
  '15100': '堆高機操作', '18201': '製茶', '22200': '食品'
};

// ======== 主入口 ========
function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action || 'examQuery';

    if (action !== 'examQuery') {
      return jsonResponse({ success: false, error: 'Invalid action' });
    }

    var idno = String(params.idno || '').toUpperCase().trim();
    if (!validateIdno(idno)) {
      return jsonResponse({ success: false, error: '身分證字號格式錯誤' });
    }

    // Rate limit（含全域 + 單一 idno 雙層保護）
    if (!checkRateLimit(idno)) {
      return jsonResponse({ success: false, error: '查詢過於頻繁，請稍後再試' });
    }

    var result = queryByIdno(idno);
    return jsonResponse({ success: true, data: result });

  } catch (err) {
    // 記錄完整錯誤於 server，但對外只回泛用訊息（避免洩漏內部檔名/ID）
    var errId = 'E' + new Date().getTime().toString(36);
    Logger.log('[' + errId + '] ' + err.toString() + '\n' + (err.stack || ''));
    return jsonResponse({ success: false, error: '系統暫時無法處理，請稍後再試', errorId: errId });
  }
}

function doGet(e) {
  // 除錯模式：需要 debug token（只有開發者知道）
  if (e && e.parameter && e.parameter.debug === CONFIG.DEBUG_TOKEN) {
    return debugInfo();
  }
  return jsonResponse({ success: true, message: '即測即評查詢 API 運作中' });
}

// 除錯函式：需要正確 token 才能呼叫（僅顯示筆數、不顯示內容）
function debugInfo() {
  var info = {
    success: true,
    folder_name: '',
    files_count: 0,
    registrations_count: 0,
    written_count: 0,
    errors: []
  };

  try {
    var folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    info.folder_name = folder.getName();
    var iter = folder.getFiles();
    while (iter.hasNext()) { iter.next(); info.files_count++; }
  } catch (e) {
    info.errors.push('Folder: ' + e.message);
  }

  try {
    info.registrations_count = loadRegistrations().length;
  } catch (e) {
    info.errors.push('Registrations: ' + e.message);
  }

  try {
    var wi = loadWrittenIndex();
    info.written_count = Object.keys(wi).length;
  } catch (e) {
    info.errors.push('Written: ' + e.message);
  }

  return jsonResponse(info);
}

// ======== 查詢邏輯 ========
function queryByIdno(idno) {
  // 查詢結果用 cache（單筆結果小，不會超過 100KB）
  var cache = CacheService.getScriptCache();
  var cached = cache.get('query_' + idno);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { }
  }

  // 讀取報檢資料
  var registrations = loadRegistrations();

  // 過濾該身分證的資料
  var myRecords = registrations.filter(function (r) {
    return r.idno === idno;
  });

  if (myRecords.length === 0) return [];

  // 讀取學科報檢資料並建 AENO → 學科場次 的索引（首選資料源：直接精確）
  var writtenIndex = loadWrittenIndex();

  // 組合結果
  var results = myRecords.map(function (reg) {
    var dstngClean = (reg.dstng || '').trim();
    var isExemptPractical = (dstngClean === 'B'); // DSTNG='B' = 免術科（只考學科）

    var result = {
      studentName: reg.name,
      idno: maskIdno(reg.idno),
      certNumber: reg.aeno,
      pno: reg.pno,
      occupation: PNO_MAP[reg.pno] || reg.pno,
      egr: reg.egr,
      exemption: dstngClean, // 'B' = 免術科（僅考學科）
    };

    // 術科資訊：免術科者沒有術科日期時間
    if (!isExemptPractical) {
      result.practicalDate = reg.opexdt;
      result.practicalTime = reg.opextime;
    }

    // 學科資訊：所有人（含免術科者）都要考學科 → 讀學科報檢資料
    var wr = writtenIndex[reg.aeno] || null;
    if (wr && wr.exdate && wr.extime) {
      result.writtenDate = wr.exdate;
      result.writtenTime = wr.extime;
      result.writtenRoom = wr.room || DEFAULT_WRITTEN_ROOM;
      if (wr.distid) result.writtenSession = wr.distid;
    } else if (!isExemptPractical && reg.opextime) {
      // Fallback：學科報檢資料缺此人 → 用上下午互補推算（僅需考術科者可推算，
      // 因免術科者無術科時間可參照）
      var pTime = String(reg.opextime);
      var isPracticalMorning = /^0[6-9]|^1[0-2]/.test(pTime);
      result.writtenDate = reg.opexdt;
      result.writtenTime = isPracticalMorning ? '13:20-15:00' : '10:20-12:00';
      result.writtenRoom = DEFAULT_WRITTEN_ROOM;
    }

    return result;
  });

  // 快取單筆結果並追蹤 key（供 clearCache 清除）
  var cacheKey = 'query_' + idno;
  cache.put(cacheKey, JSON.stringify(results), CONFIG.CACHE_TTL);
  trackQueryKey(cacheKey);
  return results;
}

// 追蹤所有 query_* cache key（存到 PropertiesService，資料量小）
function trackQueryKey(key) {
  try {
    var props = PropertiesService.getScriptProperties();
    var existing = props.getProperty('query_keys');
    var set = existing ? JSON.parse(existing) : [];
    if (set.indexOf(key) < 0) {
      set.push(key);
      // 只保留最近 1000 個避免無限成長
      if (set.length > 1000) set = set.slice(-1000);
      props.setProperty('query_keys', JSON.stringify(set));
    }
  } catch (e) { /* 非關鍵錯誤，忽略 */ }
}

// ======== 資料載入 ========
// 依「檔名含 keyword + 副檔名」找檔案，若有多個則取最新修改的
// exclude: 排除檔名含此字串的檔案（避免關鍵字衝突，如「報檢資料」誤 match「學科報檢資料」）
function findLatestFile(keyword, ext, exclude) {
  var folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  var iter = folder.getFiles();
  var matches = [];
  while (iter.hasNext()) {
    var f = iter.next();
    var name = f.getName();
    if (name.indexOf(keyword) >= 0 && name.toLowerCase().endsWith(ext.toLowerCase())) {
      if (exclude && name.indexOf(exclude) >= 0) continue;
      matches.push(f);
    }
  }
  if (matches.length === 0) return null;
  // 按最後更新時間排序，取最新
  matches.sort(function (a, b) {
    return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
  });
  return matches[0];
}

function loadRegistrations() {
  // CacheService 值限制 100KB，報檢資料可能超過，改用 PropertiesService（9KB/key，分段）或乾脆不快取
  // 這裡不快取整份資料；若要優化可改成按 IDNO 建立索引再分段快取
  // 排除「學科」字樣，避免誤讀到學科報檢資料.csv
  var csvFile = findLatestFile('報檢資料', '.csv', '學科');
  if (!csvFile) throw new Error('找不到報檢資料 CSV（請用資料轉檔工具產生後上傳）');

  var content = csvFile.getBlob().getDataAsString('UTF-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.substring(1); // 去 BOM
  var rows = Utilities.parseCsv(content);
  if (rows.length < 3) throw new Error('CSV 資料不足');

  // 第 1 行中文標題，第 2 行英文欄位名
  var fieldRow = rows[1].map(function (h) { return String(h).toLowerCase().trim(); });
  var data = [];
  for (var i = 2; i < rows.length; i++) {
    var row = {};
    for (var j = 0; j < fieldRow.length; j++) {
      row[fieldRow[j]] = rows[i][j];
    }
    if (row.idno) {
      // 清理關鍵欄位避免末尾空格影響 join
      row.idno = String(row.idno).trim().toUpperCase();
      if (row.aeno) row.aeno = String(row.aeno).trim();
      if (row.dstng) row.dstng = String(row.dstng).trim().toUpperCase();
      data.push(row);
    }
  }

  return data;
}

// 讀取學科報檢資料 CSV 並建 AENO → 學科資訊索引
// 這是唯一的學科資料源（xlsx 直接提供 AENO + 日期 + 時間）
function loadWrittenIndex() {
  var csvFile = findLatestFile('學科報檢資料', '.csv');
  if (!csvFile) return {};

  var content = csvFile.getBlob().getDataAsString('UTF-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.substring(1); // 去 BOM
  var rows = Utilities.parseCsv(content);
  if (rows.length < 3) return {};

  // 第 1 行中文標題，第 2 行英文欄位名
  var fieldRow = rows[1].map(function (h) { return String(h).toLowerCase().trim(); });
  var aenoIdx = fieldRow.indexOf('aeno');
  if (aenoIdx < 0) return {};

  var index = {};
  for (var i = 2; i < rows.length; i++) {
    var aeno = rows[i][aenoIdx];
    if (!aeno) continue;
    aeno = String(aeno).trim(); // 對齊 registrations 的 trim
    var row = {};
    for (var j = 0; j < fieldRow.length; j++) row[fieldRow[j]] = rows[i][j];
    index[aeno] = row;
  }
  return index;
}

// ======== 工具函式 ========
function validateIdno(idno) {
  if (!idno || idno.length !== 10) return false;
  if (!/^[A-Z][12]\d{8}$/.test(idno)) return false;
  // 驗證檢查碼
  var letterMap = 'ABCDEFGHJKLMNPQRSTUVXYWZIO';
  var letterValues = [10, 11, 12, 13, 14, 15, 16, 17, 34, 18, 19, 20, 21, 22, 35, 23, 24, 25, 26, 27, 28, 29, 32, 30, 31, 33];
  var idx = letterMap.indexOf(idno.charAt(0));
  if (idx < 0) return false;
  var n = letterValues[idx];
  var sum = Math.floor(n / 10) + (n % 10) * 9;
  for (var i = 1; i < 9; i++) sum += parseInt(idno.charAt(i), 10) * (9 - i);
  sum += parseInt(idno.charAt(9), 10);
  return sum % 10 === 0;
}

function maskIdno(idno) {
  if (!idno || idno.length !== 10) return idno;
  return idno.substring(0, 2) + '****' + idno.substring(6);
}

function checkRateLimit(idno) {
  var cache = CacheService.getScriptCache();

  // 全域計數（防止攻擊者輪替不同 idno 繞過單一 idno 限制）
  var globalKey = 'rl_global';
  var globalCount = parseInt(cache.get(globalKey) || '0', 10);
  if (globalCount >= CONFIG.GLOBAL_RATE_LIMIT) return false;

  // 單一 idno 計數
  var key = 'rl_' + idno;
  var count = parseInt(cache.get(key) || '0', 10);
  if (count >= CONFIG.RATE_LIMIT) return false;

  cache.put(key, String(count + 1), 60);
  cache.put(globalKey, String(globalCount + 1), 60);
  return true;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ======== 手動測試用 ========
function testQuery() {
  var result = queryByIdno('A123456789');
  Logger.log(JSON.stringify(result, null, 2));
}

// 清除所有已追蹤的 query 快取（資料更新後手動呼叫）
function clearCache() {
  var cache = CacheService.getScriptCache();
  var props = PropertiesService.getScriptProperties();
  var keysJson = props.getProperty('query_keys');
  var keys = keysJson ? JSON.parse(keysJson) : [];

  // 分批清除（CacheService.removeAll 上限 1000 個 key）
  while (keys.length > 0) {
    var batch = keys.splice(0, 500);
    try { cache.removeAll(batch); } catch (e) { Logger.log('Clear batch failed: ' + e); }
  }
  props.deleteProperty('query_keys');
  Logger.log('快取已清除');
}
