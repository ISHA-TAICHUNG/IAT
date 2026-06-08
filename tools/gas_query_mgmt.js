/**
 * =================================================================
 * Google Apps Script 後端程式碼 (版本 7.0 - 成績單簽收總表 + 身分證末2碼查詢)
 * * 功能：
 * 1. 作為 Web App 的後端，處理前端傳來的查詢請求。
 * 2. 直接從 Google Drive 的「成績單簽收總表」TXT 檔案中即時搜尋學生資料。
 * 3. 自動計算報到時間並加入回傳資料中。
 * 4. 提供手動執行的診斷功能，用以統計資料庫中的總資料筆數。
 * 5. 自動記錄所有查詢操作，以便分析與追蹤。
 * * 說明：
 * - 所有可供使用者操作的函數名稱、註解、日誌、錯誤訊息皆已中文化。
 * - 核心解析邏輯已最佳化，能應對「座號 身分證編號 姓名 期別 准考證號碼 測驗職類」格式。
 * =================================================================
 */


// =================================================================
// ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 【系統核心設定】 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
// =================================================================

// 1. 【必須】存放 TXT 檔案的 Google Drive 資料夾 ID
//    如何取得：用瀏覽器打開該資料夾，複製網址最後面的一長串亂碼。
var 資料夾_ID = '1R7boSy0nyu_SHf0uN73IUHAqyqfoP3Vc'; // 請務必替換為您的實際資料夾 ID

// 2. 【選填】用來記錄查詢日誌的 Google Sheet ID
//    如果留空，腳本會在第一次執行時自動為您創建一個全新的日誌表。
var 日誌表_ID = '1KyscXS7YdKsGuI6wijiTxiNO5EpEEOwVtQtDI066Es0'; 

// 日誌記錄在試算表中的工作表名稱
var 日誌工作表名稱 = '查詢記錄';

// 查詢節流：前端會送 getOrCreateClientId() 產生的 clientId；惡意或髒值會退回 anon。
var CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
var RATE_LIMIT = 20;
var GLOBAL_RATE_LIMIT = 200;
var RATE_WINDOW_SECONDS = 60;

// =================================================================
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ 【系統核心設定】 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
// =================================================================


// =================================================================
//                           診斷與統計功能
// =================================================================

/**
 * 【診斷與統計功能】
 * 執行此函數可遍歷所有 TXT 檔案，計算並記錄總共有多少筆學生資料。
 * * 如何使用：
 * 1. 在 Apps Script 編輯器頂部，從函數下拉選單中選擇 "統計總資料筆數"。
 * 2. 按下「▶️ 執行」按鈕。
 * 3. 執行完畢後，在下方的「執行記錄」中查看統計結果。
 */
function 統計總資料筆數() {
  Logger.log('====== 🚀 開始執行總資料筆數統計作業 ======');
  try {
    if (!資料夾_ID || 資料夾_ID.includes('YOUR_FOLDER_ID')) { 
        throw new Error('系統設定錯誤：資料夾_ID 尚未在程式碼中設定。');
    }
    
    var 資料夾 = DriveApp.getFolderById(資料夾_ID);
    var 檔案迭代器 = 資料夾.getFilesByType(MimeType.PLAIN_TEXT);
    var 總記錄數 = 0;
    var 檔案計數 = 0;
    
    if (!檔案迭代器.hasNext()) {
        Logger.log('⚠️ 警告：在指定的資料夾中沒有找到任何 .txt 純文字檔案。');
        return;
    }
    
    while (檔案迭代器.hasNext()) {
      var 檔案 = 檔案迭代器.next();
      檔案計數++;
      Logger.log('正在分析檔案 ' + 檔案計數 + ': ' + 檔案.getName());
      
      try {
        var 檔案內容 = 檔案.getBlob().getDataAsString('UTF-8');
        if (檔案內容 && 檔案內容.trim() !== '') {
          var 檔案內記錄 = _解析檔案並計數(檔案內容);
          Logger.log(' -> ✅ 於此檔案中解析到 ' + 檔案內記錄.length + ' 筆記錄。');
          總記錄數 += 檔案內記錄.length;
        } else {
          Logger.log(' -> 🟡 檔案為空，已跳過。');
        }
      } catch (檔案錯誤) {
        Logger.log(' -> ❌ 處理此檔案時發生錯誤: ' + 檔案錯誤.toString());
      }
    }
    
    Logger.log('=============================================');
    Logger.log('📊 統計完成！');
    Logger.log('總共分析了 ' + 檔案計數 + ' 個 TXT 檔案。');
    Logger.log('✅ 總共解析到 ' + 總記錄數 + ' 筆可供查詢的學生資料。');
    Logger.log('=============================================');
    
  } catch (錯誤) {
    Logger.log('❌ 執行統計作業時發生嚴重錯誤: ' + 錯誤.toString());
  }
}

/**
 * 核心解析函數的「無篩選版本」，用於統計總數。
 * @param {string} 檔案內容 - 檔案的完整文字內容。
 * @returns {Array} 解析出的記錄陣列。
 */
function _解析檔案並計數(檔案內容) {
  var 所有記錄 = [];
  var 行陣列 = 檔案內容.trim().split(/\r?\n/);
  for (var i = 0; i < 行陣列.length; i++) {
    var 單行文字 = 行陣列[i].trim();
    if (!單行文字) continue;
    if (/^\d{4}\s+[A-Z]\d{2}X{5}\d{2}\s+/.test(單行文字)) {
      所有記錄.push(單行文字); // 只需存入一個標記來計數即可
    }
  }
  return 所有記錄;
}


// =================================================================
//                      Web App 主要請求處理
// =================================================================

/**
 * 處理來自前端的 POST 請求 (當使用者按下查詢按鈕時觸發)
 * 注意：此函數名稱為 Google Apps Script 規定，請勿修改。
 */
function doPost(e) {
  var 查詢日誌資料 = {
    queryTime: new Date(),
    searchName: '',
    resultStatus: '錯誤',
    resultCount: 0,
    errorMessage: '',
    userAgent: (e && e.parameter) ? e.parameter.userAgent : '未知'
  };
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('請求參數不正確，缺少 postData。');
    }

    var 前端傳來的資料 = JSON.parse(e.postData.contents);
    var 查詢姓名 = 前端傳來的資料.name ? 前端傳來的資料.name.trim() : '';
    var 身分證末2碼 = 前端傳來的資料.last2 ? String(前端傳來的資料.last2).trim() : '';
    查詢日誌資料.searchName = 查詢姓名 + (身分證末2碼 ? ' (**' + 身分證末2碼 + ')' : '');
    
    if (!查詢姓名) {
      throw new Error('請輸入要查詢的姓名。');
    }
    if (!/^\d{2}$/.test(身分證末2碼)) {
      throw new Error('請輸入身分證末 2 碼。');
    }

    if (!檢查查詢頻率限制(取得客戶端指紋(前端傳來的資料))) {
      查詢日誌資料.resultStatus = '頻率限制';
      查詢日誌資料.errorMessage = '查詢過於頻繁，請稍後再試。';
      寫入查詢日誌(查詢日誌資料);
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: '查詢過於頻繁，請稍後再試。'
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var 查詢結果 = 在TXT檔中搜尋姓名與末2碼(查詢姓名, 身分證末2碼);
    
    // 準備記錄查詢結果
    查詢日誌資料.resultStatus = 查詢結果.success ? (查詢結果.data.length > 0 ? '查詢成功' : '查無資料') : '查詢失敗';
    查詢日誌資料.resultCount = 查詢結果.success ? 查詢結果.data.length : 0;
    查詢日誌資料.errorMessage = 查詢結果.message || 查詢結果.error || ''; // 記錄 '找不到' 的訊息或錯誤訊息
    
    寫入查詢日誌(查詢日誌資料); // 寫入日誌
    
    return ContentService
      .createTextOutput(JSON.stringify(查詢結果))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (錯誤) {
    Logger.log('處理 POST 請求時發生嚴重錯誤: ' + 錯誤.toString() + ' Stack: ' + 錯誤.stack);
    
    查詢日誌資料.errorMessage = 錯誤.message;
    寫入查詢日誌(查詢日誌資料); // 即使發生錯誤，也嘗試記錄
    
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: '伺服器處理錯誤: ' + 錯誤.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function 取得客戶端指紋(前端傳來的資料) {
  try {
    var bodyId = (前端傳來的資料 && 前端傳來的資料.clientId) ? String(前端傳來的資料.clientId).slice(0, 64) : '';
    if (bodyId && !CLIENT_ID_PATTERN.test(bodyId)) bodyId = '';

    var sessionKey = '';
    try { sessionKey = Session.getTemporaryActiveUserKey() || ''; } catch (_) {}

    var raw = bodyId || sessionKey || 'anon';
    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)
      .map(function(b) {
        return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0');
      })
      .join('')
      .substring(0, 12);
  } catch (_) {
    return 'anon';
  }
}

function 檢查查詢頻率限制(客戶端指紋) {
  try {
    var cache = CacheService.getScriptCache();
    var globalKey = 'mgmt_query_rl_global';
    var globalCount = Number(cache.get(globalKey)) || 0;
    if (globalCount >= GLOBAL_RATE_LIMIT) return false;

    var clientKey = 'mgmt_query_rl_' + (客戶端指紋 || 'anon');
    var clientCount = Number(cache.get(clientKey)) || 0;
    if (clientCount >= RATE_LIMIT) return false;

    cache.put(clientKey, String(clientCount + 1), RATE_WINDOW_SECONDS);
    cache.put(globalKey, String(globalCount + 1), RATE_WINDOW_SECONDS);
    return true;
  } catch (_) {
    // CacheService 短暫失效時不阻斷查詢；GAS 例外會進 Logger 但使用者仍可查。
    return true;
  }
}

/**
 * 處理 GET 請求 (用於從瀏覽器直接訪問 API 網址，以測試是否在線)
 * 注意：此函數名稱為 Google Apps Script 規定，請勿修改。
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      message: '查詢系統後端 API (版本 7.0) 運作中',
      timestamp: new Date().toISOString(),
      status: 'OK'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


// =================================================================
//                      核心搜尋與解析邏輯
// =================================================================

/**
 * 在資料夾中的「成績單簽收總表」TXT 檔案中搜尋指定的姓名 + 身分證末 2 碼
 * @param {string} 姓名 - 要搜尋的學生姓名。
 * @param {string} 末2碼 - 身分證遮罩末 2 碼。
 * @returns {object} 包含查詢結果的物件。
 */
function 在TXT檔中搜尋姓名與末2碼(姓名, 末2碼) {
  try {
    if (!資料夾_ID || 資料夾_ID.includes('YOUR_FOLDER_ID')) { 
        throw new Error('系統設定錯誤：資料夾_ID 尚未在程式碼中設定。');
    }
    
    var 資料夾 = DriveApp.getFolderById(資料夾_ID);
    var 檔案迭代器 = 資料夾.getFilesByType(MimeType.PLAIN_TEXT);
    var 找到的結果陣列 = [];
    
    if (!檔案迭代器.hasNext()) {
        return { success: false, message: '資料庫中沒有找到可供查詢的 TXT 檔案。' };
    }
    
    while (檔案迭代器.hasNext()) {
      var 檔案 = 檔案迭代器.next();
      if (檔案.getName().indexOf('成績單簽收') < 0) {
        Logger.log('略過非成績單簽收總表檔案: ' + 檔案.getName());
        continue;
      }
      Logger.log('正在處理檔案: ' + 檔案.getName());
      
      try {
        var 檔案內容 = 檔案.getBlob().getDataAsString('UTF-8');
        
        if (檔案內容 && 檔案內容.trim() !== '') {
          // 使用成績單簽收總表解析函數，並篩選姓名 + 身分證末 2 碼
          var 檔案內找到的記錄 = _解析內容並依姓名末2碼篩選(檔案內容, 姓名, 末2碼);
          if (檔案內找到的記錄.length > 0) {
            找到的結果陣列 = 找到的結果陣列.concat(檔案內找到的記錄);
            Logger.log(' -> ✅ 在此檔案中找到 ' + 檔案內找到的記錄.length + ' 筆關於「' + 姓名 + '」(**' + 末2碼 + ') 的記錄。');
          }
        } else {
          Logger.log(' -> 🟡 檔案為空，已跳過。');
        }
      } catch (檔案錯誤) {
        Logger.log(' -> ❌ 處理此檔案時發生錯誤: ' + 檔案錯誤.toString());
      }
    }
    
    if (找到的結果陣列.length > 0) {
      Logger.log('搜尋完成，共找到 ' + 找到的結果陣列.length + ' 筆與「' + 姓名 + '」(**' + 末2碼 + ') 相符的結果。');
      return { success: true, data: 找到的結果陣列 };
    } else {
      return { success: false, message: '在所有資料中均未找到與「' + 姓名 + '」及身分證末 2 碼相符的測驗資訊。請確認輸入是否正確。' };
    }
    
  } catch (錯誤) {
    Logger.log('搜尋過程中發生嚴重錯誤: ' + 錯誤.toString());
    return { success: false, error: '系統錯誤: ' + 錯誤.message };
  }
}

/**
 * 【核心解析函數 - 成績單簽收總表版】
 * 從單一檔案的完整文字內容中，解析出所有場次與學生資料，並篩選出符合目標姓名 + 身分證末 2 碼的記錄。
 * @param {string} 檔案內容 - 檔案的完整文字內容。
 * @param {string} 目標姓名 - 要篩選的目標姓名。
 * @param {string} 目標末2碼 - 要篩選的身分證末 2 碼。
 * @returns {Array} 包含符合目標姓名之學生資訊的物件陣列。
 */
function _解析內容並依姓名末2碼篩選(檔案內容, 目標姓名, 目標末2碼) {
  var 找到的記錄 = [];
  var 清理後的目標姓名 = 目標姓名.trim();
  var 清理後的目標末2碼 = String(目標末2碼).trim();
  
  var 行陣列 = 檔案內容.trim().split(/\r?\n/);
  var 當前場次資訊 = { testDate: '待確認', testTime: '待確認', testRoom: '待確認' };
  var 場次序號 = 0;

  function 是否續行(文字) {
    if (!文字 || !文字.trim()) return false;
    var t = 文字.trim();
    if (/^\d{4}\s+[A-Z]\d{2}X{5}\d{2}\s+/.test(t)) return false;
    if (/測驗日期\s*[:：]/.test(t)) return false;
    if (t.indexOf('座號') === 0) return false;
    if (t.indexOf('列印日期') === 0) return false;
    if (t.indexOf('職業安全衛生教育訓練結訓測驗') === 0) return false;
    if (t.indexOf('成績單簽收總表') === 0) return false;
    if (t.indexOf('中華民國工業安全衛生協會') === 0) return false;
    return true;
  }

  function 清理職類名稱(首行剩餘文字, 續行文字) {
    var 合併文字 = String(首行剩餘文字 || '') + String(續行文字 || '');
    var 代碼匹配 = 合併文字.match(/(\d{5})(?=[\u3400-\u9fff])/);
    if (!代碼匹配) return '待確認';
    var 代碼 = 代碼匹配[1];
    var 代碼位置 = 合併文字.indexOf(代碼);
    var 名稱 = 合併文字.substring(代碼位置 + 代碼.length)
      .replace(/[0-9A-Za-z\-\s]/g, '')
      .trim();
    return (代碼 + ' ' + 名稱).trim();
  }

  for (var i = 0; i < 行陣列.length; i++) {
    var 單行文字 = 行陣列[i].trim();
    if (!單行文字) continue;

    // 模式一：匹配測驗場次資訊行 (日期、時間、教室)
    var 場次資訊匹配 = 單行文字.match(/測驗日期\s*[:：]\s*([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})\s+測驗時間\s*[:：]\s*([0-9]{1,2}:[0-9]{2}\s*[~～\-]\s*[0-9]{1,2}:[0-9]{2})\s+測驗教室\s*[:：]\s*(.+?)(?:\s*$)/);
    if (場次資訊匹配) {
      場次序號++;
      當前場次資訊.testDate = 格式化日期(場次資訊匹配[1].trim());
      當前場次資訊.testTime = 場次資訊匹配[2].trim();
      當前場次資訊.testRoom = 場次資訊匹配[3].trim().replace(/^\([^)]*\)\s*/, '');
      continue;
    }

    // 模式二：匹配成績單簽收總表學生資料行
    var 匹配結果 = 單行文字.match(/^(\d{4})\s+([A-Z]\d{2}X{5}(\d{2}))\s+(\S+)\s+(.+)$/);
    if (!匹配結果) continue;

    var 座號 = 匹配結果[1].trim();
    var 身分證末2碼 = 匹配結果[3].trim();
    var 學生姓名 = 匹配結果[4].trim();
    var 剩餘文字 = 匹配結果[5] || '';
    var 續行文字 = '';

    if (i + 1 < 行陣列.length && 是否續行(行陣列[i + 1])) {
      續行文字 = 行陣列[i + 1].trim();
      i++;
    }

    if (學生姓名 === 清理後的目標姓名 && 身分證末2碼 === 清理後的目標末2碼) {
      var 測驗職類 = 清理職類名稱(剩餘文字, 續行文字);
      var 報到時間 = 計算並格式化報到時間(當前場次資訊.testTime);
      
      找到的記錄.push({
        studentName: 學生姓名,
        testDate: 當前場次資訊.testDate,
        testTime: 當前場次資訊.testTime,
        checkinTime: 報到時間,
        testRoom: 當前場次資訊.testRoom,
        testClass: 測驗職類,
        seatNumber: 座號,
        sessionNumber: 場次序號
      });
    }
  }
  return 找到的記錄;
}


// =================================================================
//                         日誌系統與輔助函數
// =================================================================

/**
 * 將查詢操作記錄到 Google Sheet
 * @param {object} 查詢日誌資料 - 包含本次查詢所有資訊的物件。
 */
function 寫入查詢日誌(查詢日誌資料) {
  try {
    var 工作表 = 取得或建立日誌工作表();
    if (!工作表) {
      Logger.log('⚠️ 無法獲取或創建日誌記錄表，本次查詢將不會被記錄。');
      return;
    }
    
    var 一列資料 = [
      查詢日誌資料.queryTime,
      查詢日誌資料.searchName,
      查詢日誌資料.resultStatus,
      查詢日誌資料.resultCount,
      查詢日誌資料.errorMessage,
      查詢日誌資料.userAgent,
      Session.getTemporaryActiveUserKey() || 'N/A'
    ];
    
    工作表.appendRow(一列資料);
    Logger.log('✍️ 成功記錄查詢日誌: ' + 查詢日誌資料.searchName + ' - ' + 查詢日誌資料.resultStatus);
    
  } catch (錯誤) {
    Logger.log('❌ 記錄查詢日誌時發生嚴重錯誤: ' + 錯誤.toString());
  }
}

/**
 * 獲取或創建一個用於記錄日誌的 Google Sheet 工作表
 * @returns {Sheet|null} 返回工作表物件，如果失敗則返回 null。
 */
function 取得或建立日誌工作表() {
  try {
    if (日誌表_ID) {
      try {
        var 試算表檔案 = SpreadsheetApp.openById(日誌表_ID);
        var 工作表 = 試算表檔案.getSheetByName(日誌工作表名稱);
        if (!工作表) {
          工作表 = 試算表檔案.insertSheet(日誌工作表名稱);
          初始化日誌表頭(工作表);
        }
        return 工作表;
      } catch (e) {
        Logger.log('⚠️ 無法開啟指定的 日誌表_ID: ' + 日誌表_ID + '。將自動創建一個新的日誌表。錯誤訊息: ' + e.toString());
      }
    }
    
    // 如果沒有提供 ID 或開啟失敗，則創建一個全新的日誌試算表
    var 新的試算表檔案 = SpreadsheetApp.create('測驗查詢系統日誌記錄 (自動創建)');
    var 新的工作表 = 新的試算表檔案.getActiveSheet();
    新的工作表.setName(日誌工作表名稱);
    初始化日誌表頭(新的工作表);
    
    var 新的ID = 新的試算表檔案.getId();
    Logger.log('🎉 已自動創建新的日誌記錄 Google Sheet。');
    Logger.log('新的日誌表 ID: ' + 新的ID);
    Logger.log('新的日誌表網址: ' + 新的試算表檔案.getUrl());
    Logger.log('💡 建議: 將此新 ID 更新到程式碼中的「日誌表_ID」變數，以供後續使用。');
    
    // 將新 ID 更新到變數中，供本次執行後續使用
    日誌表_ID = 新的ID;

    return 新的工作表;
    
  } catch (錯誤) {
    Logger.log('❌ 獲取或創建日誌記錄表時發生嚴重錯誤: ' + 錯誤.toString());
    return null;
  }
}

/**
 * 初始化日誌記錄工作表的表頭與格式
 * @param {Sheet} 工作表 - 要進行初始化的工作表物件。
 */
function 初始化日誌表頭(工作表) {
  if (!工作表) return;
  try {
    工作表.setFrozenRows(1);
    var 表頭 = [
      '查詢時間', '查詢姓名', '查詢狀態', '結果數量', '錯誤或備註訊息', '使用者代理 (User Agent)', '匿名使用者ID'
    ];
    var 表頭範圍 = 工作表.getRange(1, 1, 1, 表頭.length);
    表頭範圍.setValues([表頭]);
    表頭範圍.setFontWeight('bold').setBackground('#4a86e8').setFontColor('white');
    工作表.setColumnWidths(1, 1, 180); // 查詢時間
    工作表.setColumnWidths(2, 2, 120); // 查詢姓名
    工作表.setColumnWidths(3, 2, 100); // 查詢狀態, 結果數量
    工作表.setColumnWidths(5, 1, 300); // 錯誤訊息
    工作表.setColumnWidths(6, 2, 250); // User Agent, 匿名ID
  } catch(e) {
      Logger.log("初始化日誌表頭時發生錯誤: " + e.toString());
  }
}

/**
 * 輔助函數：將日期字串格式化為 YYYY/MM/DD
 * @param {string} 日期字串 - 原始的日期文字。
 * @returns {string} 格式化後的日期字串。
 */
function 格式化日期(日期字串) {
  if (!日期字串) return '待確認';
  try {
    // 移除中文字元並統一分隔符
    var 清理後字串 = 日期字串.replace(/[年月日]/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    var 字串陣列 = 清理後字串.split('/');
    if (字串陣列.length === 3) {
      // 確保月份和日期為兩位數
      return 字串陣列[0] + '/' + 字串陣列[1].padStart(2, '0') + '/' + 字串陣列[2].padStart(2, '0');
    }
    return 清理後字串; // 如果格式不符，返回清理後的原字串
  } catch (e) {
    return 日期字串; // 發生任何錯誤，返回原始字串
  }
}

// ====================== 新增函數 ======================
/**
 * @description 從測驗時間計算報到時間（提前35分鐘）
 * @param {string} timeString - 格式為 "HH:mm"、"HH:mm-HH:mm" 或 "HH:mm~HH:mm" 的時間字串
 * @returns {string} 格式為 "HH:mm" 的報到時間，或在格式錯誤時返回 'N/A'
 */
function 計算並格式化報到時間(timeString) {
  // 從 "8:20-10:00" / "8:20~10:00" 這類格式中，僅提取開始時間 "8:20"
  var startTimeMatch = (typeof timeString === 'string') ? timeString.match(/^(\d{1,2}:\d{2})/) : null;

  if (!startTimeMatch) {
    Logger.log('無法從時間字串中提取有效的開始時間: ' + timeString);
    return 'N/A';
  }

  var startTime = startTimeMatch[1]; // 例如: "8:20"

  try {
    var parts = startTime.split(':');
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    
    // 使用日期物件處理時間計算
    var date = new Date();
    date.setHours(hours);
    date.setMinutes(minutes);

    // 減去35分鐘
    date.setMinutes(date.getMinutes() - 35);

    var newHours = ('0' + date.getHours()).slice(-2);
    var newMinutes = ('0' + date.getMinutes()).slice(-2);

    return newHours + ':' + newMinutes;
  } catch (e) {
    Logger.log('計算報到時間時發生錯誤: ' + e.toString() + ' (原始時間: ' + timeString + ')');
    return 'N/A';
  }
}
// ======================================================
