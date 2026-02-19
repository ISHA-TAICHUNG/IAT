# 管理職類暨即測即評電腦化測驗 — 線上練習系統

> 職業安全衛生管理職類測驗，隨機抽 80 題，即測即評，支援反饋回報。

## 功能

- 🗂 27 個職類（業務主管 / 作業主管 / 醫護 / 外籍移工）
- 🎲 每次隨機從題庫抽選 **80 題**
- 📊 滿分 100 分，每題 1.25 分，60 分及格
- 💡 作答中可點「查看答案」（該題不列入計分）
- 🏁 可提前結束並立即查看成績
- ❌ 成績頁顯示錯題、答案、查看過的題目
- 💬 每道題可送出反饋 → 自動記錄至 Google Sheet
- ⌨️ 鍵盤快捷鍵支援（數字鍵 1-4 選答，→ 下一題，← 上一題）

## 架構說明

```
GitHub Pages (HTML/CSS/JS 前端)
        ↓ fetch
Google Apps Script (Web App)
        ↓ 讀取
Google Drive 私人資料夾 (題庫 JSON)
```

題庫 JSON **不放進 git repo**，存放於私人 Google Drive，由 GAS 代理讀取並隨機抽 80 題回傳。

## 初次設定步驟

### 1. 上傳題庫到 Google Drive
1. 執行 `python3 tools/convert_xlsx.py`（產出到 `data/`）
2. 在 Google Drive 建立一個**私人**資料夾
3. 將 `data/` 裡所有 json 檔上傳到該資料夾
4. 記下資料夾 URL 裡的 **Folder ID**（最後一段）

### 2. 設定 Google Apps Script
1. 新建一個 Google Sheet（做反饋紀錄用）
2. 工具 → 指令碼編輯器
3. 貼上 `tools/gas_backend.js` 的內容
4. 將 `FOLDER_ID` 填入你的 Drive 資料夾 ID
5. 部署 → 新增部署 → 網頁應用程式
   - 執行身分：**我**
   - 存取權限：**所有人（含匿名）**
6. 複製 **Web App URL**

### 3. 填入前端設定

編輯 `js/config.js`，將 `GAS_URL` 改為步驟 6 的 URL。

### 4. 題庫更新流程

1. 更新 xlsx → 執行 `python3 tools/convert_xlsx.py`
2. 重新上傳 `data/*.json` 到 Google Drive（覆蓋舊檔）
3. GAS 快取 6 小時自動更新，或重新部署 GAS 立即生效

## 部署（GitHub Pages）

1. Push 至 GitHub repo（`main` 分支）
2. Settings → Pages → Source: `main / (root)`
3. 幾分鐘後即可透過 `https://<你的帳號>.github.io/<repo名>/` 存取

## 檔案結構

```
exam-site/
├── index.html          首頁（選職類）
├── exam.html           作答頁
├── result.html         成績頁
├── css/style.css       樣式
├── js/
│   ├── config.js       GAS URL 等設定
│   ├── app.js          首頁邏輯
│   ├── exam.js         作答核心
│   └── result.js       成績計算
├── data/
│   ├── categories.json 職類清單
│   └── *.json          各職類題庫
└── tools/
    ├── convert_xlsx.py xlsx → json 轉換
    └── gas_feedback.js GAS 後端範本
```
