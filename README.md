# 管理職類暨即測即評電腦化測驗 — 線上練習系統

> 職業安全衛生管理職類測驗，隨機抽 80 題，即測即評，支援反饋回報。

## 功能

- 🗂 27 個職類（業務主管 / 作業主管 / 醫護 / 外籍移工）
- � 外籍移工職類自動顯示國旗與母語翻譯（印尼、越南、菲律賓、泰國）
- �🎲 每次從題庫隨機抽選 **80 題**
- 📊 滿分 100 分，每題 1.25 分，60 分及格
- 💡 作答中可點「查看答案」（該題不列入計分）
- 🏁 可提前結束，自訂 Modal 確認避免誤觸
- ❌ 成績頁顯示錯題、正確答案、查看過的題目
- 💬 作答中 & 成績頁均可送出反饋 → 自動記錄至 Google Sheet
- ⌨️ 鍵盤快捷鍵（`1-4` 選答、`→` 下一題、`←` 上一題、`Enter` 確認）
- 📋 進站須知 & 測驗前須知雙 Modal 提醒

---

## 架構

```
GitHub Pages (HTML/CSS/JS 前端)
        ↓ fetch
Google Apps Script (Web App)
        ↓ 讀取 / 寫入
Google Drive 私人資料夾 (題庫 JSON)
Google Sheet (反饋紀錄)
```

題庫 JSON **不放進 git repo**，存放於私人 Google Drive，由 GAS 代理讀取。

---

## 初次設定

### 1. 上傳題庫到 Google Drive

1. 執行 `python3 tools/convert_xlsx.py`（產出到 `data/`）
2. 在 Google Drive 建立一個**私人**資料夾
3. 將 `data/` 裡所有 `.json` 檔上傳（含 `categories.json`）
4. 記下資料夾 URL 裡的 **Folder ID**

### 2. 設定 Google Apps Script

1. 新建一個 Google Sheet（做反饋紀錄用）
2. 工具 → 指令碼編輯器
3. 貼上 `tools/gas_backend.js` 的內容
4. 將 `FOLDER_ID` 改為你的 Drive 資料夾 ID
5. 部署 → 新增部署 → 網頁應用程式
   - 執行身分：**我**
   - 存取權限：**所有人（含匿名）**
6. 複製 **Web App URL**

### 3. 填入前端設定

編輯 `js/config.js`，將 `GAS_URL` 改為步驟 6 的 URL。

### 4. 部署 GitHub Pages

1. Push 至 GitHub repo（`main` 分支）
2. Settings → Pages → Source: `main / (root)`
3. 幾分鐘後可透過 `https://<你的帳號>.github.io/<repo名>/` 存取

---

## 反饋處理：修正題目 / 選項 / 答案

使用者在作答中或成績頁點「💬 反饋」時，資料會自動寫入你的 Google Sheet 的 **「反饋紀錄」** 工作表。

### 步驟 1：查看反饋

打開 Google Sheet → 「反饋紀錄」分頁，欄位如下：

| 時間 | 職類 | 題目ID | 題目 | 反饋類型 | 補充說明 | 已處理 |
|------|------|--------|------|----------|----------|--------|

### 步驟 2：找到對應的題庫 JSON

每個職類對應一個 JSON 檔，例如：

| 職類 | 對應檔案 |
|------|----------|
| 甲種職業安全衛生業務主管 | `甲種業務主管.json` |
| 固定式起重機操作人員（印尼籍） | `固定式起重機_印尼.json` |
| 堆高機操作人員（泰籍） | `堆高機_泰國.json` |

檔名 = `categories.json` 裡的 `id` 欄位 + `.json`

### 步驟 3：修正 JSON 內容

JSON 檔結構如下：

```json
{
  "questions": [
    {
      "id": 1,
      "q": "下列何者不屬於職場健康促進項目？",
      "options": [
        "健康檢查",
        "戒菸計畫",
        "指認呼喚動作",
        "體適能促進"
      ],
      "answer": 2
    }
  ]
}
```

#### 修正題目文字

找到對應的 `id`，修改 `"q"` 的值：

```json
"q": "修正後的題目文字"
```

#### 修正選項

修改 `"options"` 陣列中對應位置的文字：

```json
"options": ["選項A", "選項B", "修正後的選項C", "選項D"]
```

#### 修正答案

`"answer"` 是正確選項的**索引值**（從 0 開始）：

| answer 值 | 對應選項 |
|-----------|----------|
| `0` | 第一個選項 (A) |
| `1` | 第二個選項 (B) |
| `2` | 第三個選項 (C) |
| `3` | 第四個選項 (D) |

例如正確答案是第三個選項，就設為 `"answer": 2`。

### 步驟 4：上傳修正後的 JSON

1. 儲存修正後的 `.json` 檔案
2. 到 Google Drive 的題庫資料夾
3. **右鍵 → 上傳檔案**，覆蓋舊的同名檔案
4. GAS 快取會在 **6 小時後** 自動更新

> **⚡ 想立即生效？** 到 Apps Script 編輯器 → 部署 → 管理部署 → 建立新版本，就會刷新快取。

### 步驟 5：標記已處理

在 Google Sheet 的「已處理」欄位改為 `是`，方便追蹤。

---

## 題庫更新流程

1. 更新 xlsx → 執行 `python3 tools/convert_xlsx.py`
2. 重新上傳 `data/*.json` 到 Google Drive（覆蓋舊檔）
3. GAS 快取 6 小時自動更新，或重新部署 GAS 立即生效

---

## 前端更新注意事項

修改 CSS 或 JS 後，需更新 HTML 中的版本號以避免瀏覽器快取：

```html
<!-- 把 ?v=20250219 改成新日期 -->
<link rel="stylesheet" href="css/style.css?v=20250220" />
<script src="js/app.js?v=20250220"></script>
```

---

## 檔案結構

```
exam-site/
├── index.html               首頁（選職類 + 進站須知 + 測驗前須知）
├── exam.html                作答頁（提前結束 Modal + 反饋 Modal）
├── result.html              成績頁（錯題列表 + 反饋 Modal）
├── css/style.css            樣式（safety orange 主題）
├── js/
│   ├── config.js            GAS URL、計分等設定
│   ├── app.js               首頁邏輯（下拉選單、須知彈窗、翻譯）
│   ├── exam.js              作答核心（選題、計分、反饋、鍵盤）
│   └── result.js            成績計算（成績渲染、錯題反饋）
├── data/
│   ├── categories.json      職類清單
│   └── *.json               各職類題庫（上傳至 Google Drive）
└── tools/
    ├── convert_xlsx.py      xlsx → json 轉檔工具
    └── gas_backend.js       GAS 後端範本（題庫代理 + 反饋接收）
```
