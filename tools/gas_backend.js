/**
 * Google Apps Script — 題庫代理 + 反饋接收器
 *
 * 設定方式：
 * 1. 建立一個 Google Drive「私人」資料夾，上傳所有 data/*.json
 * 2. 取得該資料夾的 ID（URL 最後一段）
 * 3. 將 FOLDER_ID 填入下方
 * 4. 部署 → 網頁應用程式（執行身分：我，存取：所有人含匿名）
 * 5. 複製 Web App URL → 填入 js/config.js 的 GAS_URL
 *
 * GET  ?action=categories           → 回傳職類清單
 * GET  ?action=questions&cat=ID     → 回傳 80 題（已隨機抽取）
 * POST { action:"feedback", ... }  → 寫入反饋 Sheet
 */

// ★ 填入你的 Google Drive 資料夾 ID
const FOLDER_ID = "1pHdmbCqI8iq2nXmQnqf0FLrdYGffybgO";
const FEEDBACK_SHEET = "反饋紀錄";

// ── 快取：避免重複讀 Drive（每次部署後 6 小時內同一職類快取）
const CACHE = CacheService.getScriptCache();
const CACHE_TTL = 21600; // 6 小時

// ────────────────────────────── GET ──────────────────────────────
function doGet(e) {
    const action = e.parameter.action || "";

    try {
        if (action === "categories") {
            return jsonResponse(getCategories());
        }
        if (action === "questions") {
            const cat = e.parameter.cat || "";
            if (!cat) return jsonResponse({ error: "缺少 cat 參數" }, 400);
            return jsonResponse(getQuestions(cat, 80));
        }
        // 健康檢查
        return jsonResponse({ status: "ok" });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

// ────────────────────────────── POST ─────────────────────────────
function doPost(e) {
    try {
        const body = JSON.parse(e.postData.contents);

        if (body.action === "feedback") {
            saveFeedback(body);
            return jsonResponse({ success: true });
        }
        return jsonResponse({ error: "未知 action" }, 400);
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}

// ────────────────────────── 職類清單 ─────────────────────────────
function getCategories() {
    const cached = CACHE.get("categories");
    if (cached) return JSON.parse(cached);

    const file = getFileByName("categories.json");
    const data = JSON.parse(file.getBlob().getDataAsString("UTF-8"));

    CACHE.put("categories", JSON.stringify(data), CACHE_TTL);
    return data;
}

// ─────────────────────────── 隨機抽題 ────────────────────────────
function getQuestions(catId, count) {
    const cacheKey = "cat_" + catId;
    let all;

    const cached = CACHE.get(cacheKey);
    if (cached) {
        all = JSON.parse(cached);
    } else {
        const fname = catId + ".json";
        const file = getFileByName(fname);
        const data = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
        all = data.questions;
        // 快取題庫（不含抽題結果）
        CACHE.put(cacheKey, JSON.stringify(all), CACHE_TTL);
    }

    // Fisher-Yates shuffle → 取前 count 題
    const arr = all.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, Math.min(count, arr.length));
}

// ─────────────────────────── 反饋寫入 ────────────────────────────
function saveFeedback(body) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(FEEDBACK_SHEET);

    if (!sheet) {
        sheet = ss.insertSheet(FEEDBACK_SHEET);
        sheet.appendRow(["時間", "職類", "題目ID", "題目", "反饋類型", "補充說明", "已處理"]);
        sheet.setFrozenRows(1);
    }

    sheet.appendRow([
        body.timestamp || new Date().toISOString(),
        body.catName || "",
        body.questionId || "",
        body.question || "",
        body.feedbackType || "",
        body.description || "",
        "否",
    ]);
}

// ──────────────────────── 工具函式 ───────────────────────────────
function getFileByName(name) {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const files = folder.getFilesByName(name);
    if (!files.hasNext()) throw new Error("找不到檔案: " + name);
    return files.next();
}

function jsonResponse(data, code) {
    const output = ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
    return output;
}
