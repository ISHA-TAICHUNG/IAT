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
 * POST { action:"feedback", ... }  → 寫入反饋 Sheet（自動去重）
 * POST { action:"logResult", ... } → 寫入測驗統計 Sheet
 *
 * 自訂選單「題庫管理」：
 * - 建立修正指令分頁  → 初始化修正指令工作表 + 題庫管理說明
 * - 執行修正          → 讀取修正指令，自動修改 Drive 上的 JSON（修改前自動備份）
 * - 建立新增題目分頁  → 初始化新增題目工作表
 * - 執行新增題目      → 批次新增題目到 Drive JSON（新增前自動備份）
 * - 清除題庫快取      → 強制清除 GAS 快取
 */

// ★ 填入你的 Google Drive 資料夾 ID
const FOLDER_ID = "1pHdmbCqI8iq2nXmQnqf0FLrdYGffybgO";
const FEEDBACK_SHEET = "反饋紀錄";
const CORRECTION_SHEET = "修正指令";
const ADD_QUESTION_SHEET = "新增題目";
const STATS_SHEET = "測驗統計";

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
        .addItem("➕ 建立新增題目分頁", "createAddQuestionSheet")
        .addItem("▶️ 執行新增題目", "addNewQuestions")
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
    const noteSheet = ss.insertSheet("題庫管理說明");
    noteSheet.getRange("A1").setValue("📖 題庫管理使用說明");
    noteSheet.getRange("A1").setFontSize(14).setFontWeight("bold");

    const instructions = [
        [""],
        ["════════════════════════════════════════"],
        ["📝 一、修正題目（修正指令分頁）"],
        ["════════════════════════════════════════"],
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
        [""],
        [""],
        ["════════════════════════════════════════"],
        ["➕ 二、新增題目（新增題目分頁）"],
        ["════════════════════════════════════════"],
        [""],
        ["步驟 1：點選上方選單「📚 題庫管理 → ➕ 建立新增題目分頁」"],
        ["步驟 2：在「新增題目」分頁逐行填寫新題目"],
        ["步驟 3：點選上方選單「📚 題庫管理 → ▶️ 執行新增題目」"],
        [""],
        ["──────── 欄位說明 ────────"],
        [""],
        ["職類ID：要新增到哪個職類，例如「甲種業務主管」「堆高機_本籍」"],
        ["題目：完整的題目文字"],
        ["選項A～D：四個選項的文字（不可為空）"],
        ["答案(ABCD)：從下拉選單選 A / B / C / D"],
        [""],
        ["──────── 範例 ────────"],
        [""],
        ["職類ID        | 題目                       | 選項A    | 選項B    | 選項C      | 選項D      | 答案"],
        ["甲種業務主管  | 下列何者為正確的安全措施？ | 戴安全帽 | 穿拖鞋   | 不繫安全帶 | 不戴手套   | A"],
        [""],
        ["📌 系統會自動分配題目 id，執行狀態欄會顯示「✅ 已新增 (id=xxx)」"],
        [""],
        [""],
        ["════════════════════════════════════════"],
        ["🗑️ 三、清除快取"],
        ["════════════════════════════════════════"],
        [""],
        ["點選上方選單「📚 題庫管理 → 🗑️ 清除題庫快取」"],
        ["快取每 6 小時自動過期，修正和新增題目時也會自動清除對應快取。"],
        ["如果修改了 Google Drive 上的 JSON 但沒走修正面板，才需要手動清除。"],
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
                        case "答案(ABCD)": {
                            const answerMap = { "A": 0, "B": 1, "C": 2, "D": 3 };
                            const ansIdx = answerMap[correction.newValue.toUpperCase()];
                            if (ansIdx === undefined) {
                                sheet.getRange(correction.row, 5).setValue("❌ 答案請填 A/B/C/D");
                                failCount++;
                                continue;
                            }
                            q.answer = ansIdx;
                            break;
                        }
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
                backupFile(catId + ".json");
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

// ================== 新增題目分頁 ==================
function createAddQuestionSheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(ADD_QUESTION_SHEET);

    if (sheet) {
        SpreadsheetApp.getUi().alert("「新增題目」分頁已存在！");
        return;
    }

    sheet = ss.insertSheet(ADD_QUESTION_SHEET);

    // 表頭
    const headers = ["職類ID", "題目", "選項A", "選項B", "選項C", "選項D", "答案(ABCD)", "執行狀態"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);

    // 表頭樣式
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#2d6a4f");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");

    // 答案欄下拉
    const ansRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["A", "B", "C", "D"], true)
        .setAllowInvalid(false)
        .build();
    sheet.getRange("G2:G500").setDataValidation(ansRule);

    // 欄寬
    sheet.setColumnWidth(1, 180); // 職類ID
    sheet.setColumnWidth(2, 400); // 題目
    sheet.setColumnWidth(3, 200); // 選項A
    sheet.setColumnWidth(4, 200); // 選項B
    sheet.setColumnWidth(5, 200); // 選項C
    sheet.setColumnWidth(6, 200); // 選項D
    sheet.setColumnWidth(7, 100); // 答案
    sheet.setColumnWidth(8, 100); // 狀態

    // 範例行
    sheet.getRange(2, 1, 1, 7).setValues([
        ["甲種業務主管", "下列何者為正確的安全措施？", "戴安全帽", "穿拖鞋", "不繫安全帶", "不戴手套", "A"]
    ]);
    sheet.getRange(2, 1, 1, 7).setFontColor("#999999");

    SpreadsheetApp.getUi().alert("✅ 已建立「新增題目」分頁！\n\n" +
        "填寫方式：\n" +
        "  • 職類ID：如「甲種業務主管」「堆高機_本籍」\n" +
        "  • 題目：完整題目文字\n" +
        "  • 選項A~D：四個選項\n" +
        "  • 答案：填 A / B / C / D\n\n" +
        "填完後點「📚 題庫管理 → ▶️ 執行新增題目」");
}

// ================== 執行新增題目 ==================
function addNewQuestions() {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ADD_QUESTION_SHEET);

    if (!sheet) {
        ui.alert("找不到「新增題目」分頁！\n\n請先點選「📚 題庫管理 → ➕ 建立新增題目分頁」");
        return;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
        ui.alert("新增題目分頁沒有任何資料！");
        return;
    }

    const answerMap = { "A": 0, "B": 1, "C": 2, "D": 3 };

    // 篩選待處理
    const pending = [];
    for (let i = 1; i < data.length; i++) {
        const [catId, question, optA, optB, optC, optD, answer, status] = data[i];
        if (!catId || !question) continue;
        if (status === "✅ 已新增" || status === "❌ 失敗") continue;
        pending.push({
            row: i + 1,
            catId: String(catId).trim(),
            q: String(question).trim(),
            options: [String(optA).trim(), String(optB).trim(), String(optC).trim(), String(optD).trim()],
            answer: String(answer).trim().toUpperCase()
        });
    }

    if (pending.length === 0) {
        ui.alert("沒有待處理的新增題目！");
        return;
    }

    // 驗證
    for (const p of pending) {
        if (!p.q || p.q.length < 3) {
            sheet.getRange(p.row, 8).setValue("❌ 題目太短");
            continue;
        }
        if (p.options.some(o => !o || o.length === 0)) {
            sheet.getRange(p.row, 8).setValue("❌ 選項不可為空");
            continue;
        }
        if (answerMap[p.answer] === undefined) {
            sheet.getRange(p.row, 8).setValue("❌ 答案請填 A/B/C/D");
            continue;
        }
    }

    const confirm = ui.alert(
        "確認新增",
        `即將新增 ${pending.length} 題到題庫，確定嗎？`,
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

            // 目前最大 id
            let maxId = questions.reduce((max, q) => Math.max(max, q.id || 0), 0);

            for (const item of grouped[catId]) {
                try {
                    if (answerMap[item.answer] === undefined) {
                        failCount++;
                        continue;
                    }

                    maxId++;
                    questions.push({
                        q: item.q,
                        options: item.options,
                        answer: answerMap[item.answer],
                        id: maxId
                    });

                    sheet.getRange(item.row, 8).setValue("✅ 已新增 (id=" + maxId + ")");
                    successCount++;
                } catch (err) {
                    sheet.getRange(item.row, 8).setValue("❌ " + err.message);
                    failCount++;
                }
            }

            // 備份 + 寫回 JSON
            backupFile(catId + ".json");
            content.questions = questions;
            content.total = questions.length;
            file.setContent(JSON.stringify(content, null, 2));

            // 更新 categories.json
            updateCategoryTotal(catId, questions.length);

            // 清快取
            CACHE.remove("cat_" + catId);
            CACHE.remove("categories");

        } catch (err) {
            grouped[catId].forEach(item => {
                sheet.getRange(item.row, 8).setValue("❌ " + err.message);
                failCount++;
            });
        }
    }

    ui.alert(`✅ 新增完成！\n\n成功：${successCount} 題\n失敗：${failCount} 題\n\n快取已自動清除，新題目立即生效。`);
}

// ================== 清除快取 ==================
function clearAllCache() {
    var keys = ["categories"];
    try {
        var cats = JSON.parse(getFileByName("categories.json").getBlob().getDataAsString("UTF-8"));
        cats.forEach(function (c) { keys.push("cat_" + c.id); });
    } catch (e) {
        // 無法讀取 categories.json 時僅清 categories key
    }
    CACHE.removeAll(keys);
    SpreadsheetApp.getUi().alert("✅ 快取已清除！\n\n共清除 " + keys.length + " 筆快取。\n新題庫將在下次請求時重新載入。");
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
        if (body.action === "logResult") {
            logExamResult(body);
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

// ─────────────────────────── 反饋寫入（自動去重）────────────────────────────
function saveFeedback(body) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(FEEDBACK_SHEET);

    if (!sheet) {
        sheet = ss.insertSheet(FEEDBACK_SHEET);
        sheet.appendRow(["時間", "職類", "題目ID", "題目", "反饋類型", "補充說明", "已處理", "次數"]);
        sheet.setFrozenRows(1);
        const headerRange = sheet.getRange(1, 1, 1, 8);
        headerRange.setBackground("#1a56db");
        headerRange.setFontColor("#ffffff");
        headerRange.setFontWeight("bold");
    }

    // 去重：檢查最近 50 行是否有相同 題目ID + 反饋類型
    const lastRow = sheet.getLastRow();
    const checkRows = Math.min(50, lastRow - 1);
    if (checkRows > 0) {
        const data = sheet.getRange(lastRow - checkRows + 1, 1, checkRows, 8).getValues();
        for (let i = data.length - 1; i >= 0; i--) {
            if (String(data[i][2]) === String(body.questionId) && data[i][4] === (body.feedbackType || "")) {
                // 找到重複，更新次數
                const row = lastRow - checkRows + 1 + i;
                const currentCount = Number(data[i][7]) || 1;
                sheet.getRange(row, 8).setValue(currentCount + 1);
                sheet.getRange(row, 1).setValue(body.timestamp || new Date().toISOString()); // 更新時間
                return;
            }
        }
    }

    sheet.appendRow([
        body.timestamp || new Date().toISOString(),
        body.catName || "",
        body.questionId || "",
        body.question || "",
        body.feedbackType || "",
        body.description || "",
        "否",
        1,
    ]);
}

// ─────────────────────────── 測驗統計 ────────────────────────────
function logExamResult(body) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(STATS_SHEET);

    if (!sheet) {
        sheet = ss.insertSheet(STATS_SHEET);
        sheet.appendRow(["時間", "職類", "分數", "答對", "總題數", "用時(秒)"]);
        sheet.setFrozenRows(1);
        const headerRange = sheet.getRange(1, 1, 1, 6);
        headerRange.setBackground("#057a55");
        headerRange.setFontColor("#ffffff");
        headerRange.setFontWeight("bold");
    }

    sheet.appendRow([
        body.timestamp || new Date().toISOString(),
        body.catId || "",
        body.score || 0,
        body.correct || 0,
        body.total || 0,
        body.elapsed || 0,
    ]);
}

// ─────────────────────────── 自動備份 ────────────────────────────
function backupFile(fileName) {
    try {
        const folder = DriveApp.getFolderById(FOLDER_ID);
        const backupFolders = folder.getFoldersByName("_backup");
        let backupFolder;
        if (backupFolders.hasNext()) {
            backupFolder = backupFolders.next();
        } else {
            backupFolder = folder.createFolder("_backup");
        }
        const file = getFileByName(fileName);
        const timestamp = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyyMMdd_HHmmss");
        file.makeCopy(fileName.replace(".json", "_" + timestamp + ".json"), backupFolder);
    } catch (e) {
        // 備份失敗不阻擋修正流程
        Logger.log("備份失敗: " + fileName + " - " + e.message);
    }
}

// ──────────────────────── 工具函式 ───────────────────────────────
function getFileByName(name) {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const files = folder.getFilesByName(name);
    if (!files.hasNext()) throw new Error("找不到檔案: " + name);
    return files.next();
}

function jsonResponse(data) {
    return ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}
