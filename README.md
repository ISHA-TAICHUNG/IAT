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

## 快速開始（本機）

```bash
cd exam-site
python3 -m http.server 8080
# 開啟 http://localhost:8080
```

## 題庫更新流程

1. 將新的 xlsx 放至 `../`（上層資料夾）
2. 更新 `tools/convert_xlsx.py` 的 `CATEGORIES` 設定（如有新職類）
3. 執行：
   ```bash
   python3 tools/convert_xlsx.py
   ```
4. 提交並推送：
   ```bash
   git add data/
   git commit -m "update: 更新題庫 YYYY-MM-DD"
   git push
   ```

## 設定 Google Apps Script（反饋功能）

1. 新建一個 Google Sheet
2. 工具 → 指令碼編輯器
3. 貼上 `tools/gas_feedback.js` 的內容
4. 部署 → 新增部署 → 網頁應用程式
   - 執行身分：**我**
   - 存取權限：**所有人（含匿名）**
5. 複製 Web App URL
6. 填入 `js/config.js` 的 `GAS_URL`

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
