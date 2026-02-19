/**
 * Google Apps Script — 反饋接收器
 * 部署方式：
 * 1. 開啟 Google Sheet
 * 2. 工具 → 指令碼編輯器
 * 3. 貼上此程式碼
 * 4. 部署 → 新增部署 → 網頁應用程式
 *    執行身分：我（你的帳號）
 *    存取權限：所有人（含匿名）
 * 5. 複製 Web App URL，填入 js/config.js 的 GAS_URL
 */

const SHEET_NAME = "反饋紀錄";

function doPost(e) {
    try {
        const body = JSON.parse(e.postData.contents);
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = ss.getSheetByName(SHEET_NAME);

        // 自動建立表單標題列
        if (!sheet) {
            sheet = ss.insertSheet(SHEET_NAME);
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
            "否",  // 維護者用，改為「是」表示已處理
        ]);

        return ContentService
            .createTextOutput(JSON.stringify({ success: true }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
        return ContentService
            .createTextOutput(JSON.stringify({ success: false, error: err.message }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// GET 健康檢查（方便測試）
function doGet() {
    return ContentService
        .createTextOutput(JSON.stringify({ status: "ok" }))
        .setMimeType(ContentService.MimeType.JSON);
}
