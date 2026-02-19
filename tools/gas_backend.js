/**
 * Google Apps Script — 題庫代理 + 反饋接收器 + 修正面板
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
 *
 * 自訂選單「題庫管理」：
 * - 建立修正指令分頁  → 初始化修正指令工作表
 * - 執行修正          → 讀取修正指令，自動修改 Drive 上的 JSON
 * - 清除題庫快取      → 強制清除 GAS 快取
 */

// ★ 填入你的 Google Drive 資料夾 ID
const FOLDER_ID = "1pHdmbCqI8iq2nXmQnqf0FLrdYGffybgO";
const FEEDBACK_SHEET = "反饋紀錄";
const CORRECTION_SHEET = "修正指令";

// ── 快取：避免重複讀 Drive（每次部署後 6 小時內同一職類快取）
const CACHE = CacheService.getScriptCache();
const CACHE_TTL = 21600; // 6 小時

// ================== 自訂選單 ==================
function onOpen() {
    SpreadsheetApp.getUi()
        .createMenu("📚 題庫管理")
        .addItem("📋 建立修正指令分頁", "createCorrectionSheet")
        .addItem("▶️ 執行修正", "applyCorrections")
        .addSeparator()
        .addItem("🗑️ 清除題庫快取", "clearAllCache")
        .addToUi();
}

// ================== 修正指令分頁 ==================
function createCorrectionSheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(CORRECTION_SHEET);

    if (sheet) {
        SpreadsheetApp.getUi().alert("「修正指令」分頁已存在！");
        return;
    }

    sheet = ss.insertSheet(CORRECTION_SHEET);

    // 設定表頭
    const headers = ["職類ID", "題目ID", "修改項目", "修正後內容", "執行狀態"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);

    // 表頭樣式
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#e85d04");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");

    // 設定「修改項目」欄的下拉選單
    const itemRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["題目", "選項A", "選項B", "選項C", "選項D", "答案(ABCD)", "刪除此題"], true)
        .setAllowInvalid(false)
        .build();
    sheet.getRange("C2:C500").setDataValidation(itemRule);

    // 調整欄寬
    sheet.setColumnWidth(1, 180); // 職類ID
    sheet.setColumnWidth(2, 80);  // 題目ID
    sheet.setColumnWidth(3, 120); // 修改項目
    sheet.setColumnWidth(4, 400); // 修正後內容
    sheet.setColumnWidth(5, 100); // 執行狀態

    // 新增使用說明
    const noteSheet = ss.insertSheet("修正指令說明");
    noteSheet.getRange("A1").setValue("📖 修正指令使用說明");
    noteSheet.getRange("A1").setFontSize(14).setFontWeight("bold");

    const instructions = [
        [""],
        ["步驟 1：到「反饋紀錄」分頁查看使用者回報的問題"],
        ["步驟 2：到「修正指令」分頁填寫修正內容"],
        ["步驟 3：點選上方選單「📚 題庫管理 → ▶️ 執行修正」"],
        ["步驟 4：完成！回到「反饋紀錄」將對應反饋標記為「是」"],
        [""],
        ["──────── 欄位說明 ────────"],
        [""],
        ["職類ID：填入 categories.json 裡的 id，例如「甲種業務主管」「固定式起重機_印尼」"],
        ["題目ID：填入題目的 id 數字，可在「反饋紀錄」的「題目ID」欄找到"],
        ["修改項目：從下拉選單選擇要修改什麼"],
        ["修正後內容：填入修正後的文字"],
        [""],
        ["──────── 修改項目說明 ────────"],
        [""],
        ["題目      → 修改題目文字，「修正後內容」填新的題目文字"],
        ["選項A     → 修改第一個選項，「修正後內容」填新的選項文字"],
        ["選項B     → 修改第二個選項"],
        ["選項C     → 修改第三個選項"],
        ["選項D     → 修改第四個選項"],
        ["答案(ABCD) → 修改正確答案，「修正後內容」填 A、B、C 或 D"],
        ["刪除此題   → 刪除整題，「修正後內容」可留空"],
        [""],
        ["──────── 範例 ────────"],
        [""],
        ["職類ID          | 題目ID | 修改項目   | 修正後內容"],
        ["甲種業務主管    | 15     | 題目       | 下列何者為正確的安全防護具？"],
        ["甲種業務主管    | 15     | 選項C      | 安全帽"],
        ["甲種業務主管    | 15     | 答案(ABCD) | C"],
        ["固定式起重機_印尼 | 42   | 刪除此題   |（留空）"],
    ];

    instructions.forEach((row, i) => {
        noteSheet.getRange(i + 2, 1).setValue(row[0]);
    });

    noteSheet.setColumnWidth(1, 600);
    SpreadsheetApp.getUi().alert("✅ 已建立「修正指令」分頁和使用說明！\n\n請到「修正指令」分頁填寫修正內容，填完後點選「📚 題庫管理 → ▶️ 執行修正」。");
}

// ================== 執行修正 ==================
function applyCorrections() {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CORRECTION_SHEET);

    if (!sheet) {
        ui.alert("找不到「修正指令」分頁！\n\n請先點選「📚 題庫管理 → 📋 建立修正指令分頁」");
        return;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
        ui.alert("修正指令分頁沒有任何資料！");
        return;
    }

    // 篩選待處理的行（跳過表頭，跳過已完成）
    const pending = [];
    for (let i = 1; i < data.length; i++) {
        const [catId, qId, item, newValue, status] = data[i];
        if (!catId || !qId || !item) continue;
        if (status === "✅ 已完成" || status === "❌ 失敗") continue;
        pending.push({ row: i + 1, catId: String(catId).trim(), qId: Number(qId), item: String(item).trim(), newValue: String(newValue).trim() });
    }

    if (pending.length === 0) {
        ui.alert("沒有待處理的修正指令！\n\n（已完成的會自動跳過）");
        return;
    }

    // 確認
    const confirm = ui.alert(
        "確認執行",
        `即將執行 ${pending.length} 筆修正，確定嗎？`,
        ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) return;

    // 依職類分組
    const grouped = {};
    pending.forEach(p => {
        if (!grouped[p.catId]) grouped[p.catId] = [];
        grouped[p.catId].push(p);
    });

    let successCount = 0;
    let failCount = 0;

    for (const catId of Object.keys(grouped)) {
        try {
            const fname = catId + ".json";
            const file = getFileByName(fname);
            const content = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
            const questions = content.questions;
            let modified = false;

            for (const correction of grouped[catId]) {
                try {
                    const qIndex = questions.findIndex(q => q.id === correction.qId);
                    if (qIndex === -1) {
                        sheet.getRange(correction.row, 5).setValue("❌ 找不到題目ID " + correction.qId);
                        failCount++;
                        continue;
                    }

                    const q = questions[qIndex];

                    switch (correction.item) {
                        case "題目":
                            q.q = correction.newValue;
                            break;
                        case "選項A":
                            q.options[0] = correction.newValue;
                            break;
                        case "選項B":
                            q.options[1] = correction.newValue;
                            break;
                        case "選項C":
                            q.options[2] = correction.newValue;
                            break;
                        case "選項D":
                            q.options[3] = correction.newValue;
                            break;
                        case "答案(ABCD)":
                            const answerMap = { "A": 0, "B": 1, "C": 2, "D": 3 };
                            const ansIdx = answerMap[correction.newValue.toUpperCase()];
                            if (ansIdx === undefined) {
                                sheet.getRange(correction.row, 5).setValue("❌ 答案請填 A/B/C/D");
                                failCount++;
                                continue;
                            }
                            q.answer = ansIdx;
                            break;
                        case "刪除此題":
                            questions.splice(qIndex, 1);
                            break;
                        default:
                            sheet.getRange(correction.row, 5).setValue("❌ 未知修改項目");
                            failCount++;
                            continue;
                    }

                    sheet.getRange(correction.row, 5).setValue("✅ 已完成");
                    successCount++;
                    modified = true;
                } catch (err) {
                    sheet.getRange(correction.row, 5).setValue("❌ " + err.message);
                    failCount++;
                }
            }

            // 如果有修改，更新 categories.json 的 total 並寫回 JSON
            if (modified) {
                content.questions = questions;
                file.setContent(JSON.stringify(content, null, 2));

                // 更新 categories.json 的題數
                updateCategoryTotal(catId, questions.length);

                // 清除此職類的快取
                CACHE.remove("cat_" + catId);
                CACHE.remove("categories");
            }
        } catch (err) {
            // 整個職類失敗
            grouped[catId].forEach(c => {
                sheet.getRange(c.row, 5).setValue("❌ " + err.message);
                failCount++;
            });
        }
    }

    ui.alert(`✅ 修正完成！\n\n成功：${successCount} 筆\n失敗：${failCount} 筆\n\n快取已自動清除，新題目立即生效。`);
}

// 更新 categories.json 中的題數
function updateCategoryTotal(catId, newTotal) {
    try {
        const file = getFileByName("categories.json");
        const categories = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
        const cat = categories.find(c => c.id === catId);
        if (cat) {
            cat.total = newTotal;
            file.setContent(JSON.stringify(categories, null, 2));
        }
    } catch (e) {
        // 非致命錯誤，忽略
    }
}

// ================== 清除快取 ==================
function clearAllCache() {
    CACHE.removeAll(["categories"]);
    // 清除所有 cat_ 開頭的快取（CacheService 無法 wildcard，但重新部署即可）
    SpreadsheetApp.getUi().alert("✅ 快取已清除！\n\n如果部分職類仍有快取，請到「部署 → 管理部署 → 建立新版本」完全刷新。");
}

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
        // 快取題庫（不含抽題結果）— 但大檔案可能超過 100KB 限制
        try {
            CACHE.put(cacheKey, JSON.stringify(all), CACHE_TTL);
        } catch (e) {
            // 超過 CacheService 限制，跳過快取
        }
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
        // 表頭樣式
        const headerRange = sheet.getRange(1, 1, 1, 7);
        headerRange.setBackground("#1a56db");
        headerRange.setFontColor("#ffffff");
        headerRange.setFontWeight("bold");
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
