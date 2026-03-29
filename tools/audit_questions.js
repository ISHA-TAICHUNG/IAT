#!/usr/bin/env node
/**
 * 題庫品質審查腳本
 * 檢查項目：
 *   1. 選項數量 (必須 = 4)
 *   2. 空白/缺漏題目或選項
 *   3. 答案索引合法性 (0~3)
 *   4. 重複選項
 *   5. 重複題目
 *   6. 題目或選項中的常見錯別字
 *   7. 題目長度異常 (太短可能截斷)
 *   8. 選項格式問題 (前後空白、怪異字元)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// 常見錯別字對照表 (錯 → 正確建議)
const TYPO_MAP = {
    '工做': '工作',
    '安乍': '安全',
    '勞工安全衛生': '職業安全衛生', // 法規已改名
    '巳': '已',  // 常見混淆
    '己': null,   // 己/已 需人工判斷，先標記
    '銲': '焊',   // 看情境，銲接 vs 焊接 都合法
    '貭': '質',
    '祇': '只',
    '迴': null,    // 迴 vs 回 需看情境
    '裝設': null,  // 有些情境合法
    '仟': '千',
    '拾': null,    // 拾 vs 十 需看情境
    '佰': null,    // 佰 vs 百 需看情境
    '公絲': '公釐',
    '公伕': '公噸',
    '瓩': '千瓦',
    '粍': '公釐',
    '糎': '公分',
    '竡': '百公升',
    '浬': '海里',
    '呎': '英尺',
    '吋': '英寸',
    // 選項中常出現
    '以上皆是': '以上皆是',  // OK
    '以上皆非': '以上皆非',  // OK
};

// 可疑字元 pattern
const SUSPICIOUS_CHARS = /[\u0000-\u0008\u000E-\u001F\u007F\uFFFD\uFFFE\uFFFF]/;
// 全形數字
const FULLWIDTH_DIGITS = /[０-９]/;
// 連續空白
const MULTI_SPACES = /\s{3,}/;

const issues = [];
let totalQuestions = 0;
let totalFiles = 0;

function addIssue(file, qId, severity, msg) {
    issues.push({ file, qId, severity, msg });
}

function auditFile(filePath) {
    const filename = path.basename(filePath, '.json');
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        addIssue(filename, '-', '🔴', `JSON 解析失敗: ${e.message}`);
        return;
    }

    if (!raw.questions || !Array.isArray(raw.questions)) {
        addIssue(filename, '-', '🔴', '缺少 questions 陣列');
        return;
    }

    totalFiles++;
    const seenQuestions = new Map(); // q text → id

    for (const q of raw.questions) {
        totalQuestions++;

        // 1. 必要欄位
        if (q.id == null) {
            addIssue(filename, '??', '🔴', '缺少 id 欄位');
        }
        if (!q.q || String(q.q).trim() === '') {
            addIssue(filename, q.id, '🔴', '題目文字為空');
            continue;
        }

        const qText = String(q.q).trim();

        // 2. 選項數量
        if (!Array.isArray(q.options)) {
            addIssue(filename, q.id, '🔴', '缺少 options 陣列');
            continue;
        }
        if (q.options.length !== 4) {
            addIssue(filename, q.id, '🔴', `選項數量 = ${q.options.length}（應為4）| 題目: ${qText.substring(0, 50)}`);
        }

        // 3. 空白選項
        for (let i = 0; i < q.options.length; i++) {
            const opt = q.options[i];
            if (opt == null || String(opt).trim() === '') {
                addIssue(filename, q.id, '🔴', `選項${i + 1} 為空 | 題目: ${qText.substring(0, 50)}`);
            }
        }

        // 4. 答案索引
        if (q.answer == null || q.answer < 0 || q.answer >= q.options.length) {
            addIssue(filename, q.id, '🔴', `答案索引 ${q.answer} 超出範圍 | 題目: ${qText.substring(0, 50)}`);
        }

        // 5. 重複選項
        const optTexts = q.options.map(o => String(o).trim());
        const uniqueOpts = new Set(optTexts);
        if (uniqueOpts.size < optTexts.length) {
            const dupes = optTexts.filter((o, i) => optTexts.indexOf(o) !== i);
            addIssue(filename, q.id, '🟡', `有重複選項: "${dupes[0]}" | 題目: ${qText.substring(0, 50)}`);
        }

        // 6. 重複題目
        const normalizedQ = qText.replace(/\s+/g, '');
        if (seenQuestions.has(normalizedQ)) {
            addIssue(filename, q.id, '🟡', `與 #${seenQuestions.get(normalizedQ)} 題目重複: ${qText.substring(0, 60)}`);
        } else {
            seenQuestions.set(normalizedQ, q.id);
        }

        // 7. 題目長度異常
        if (qText.length < 5) {
            addIssue(filename, q.id, '🟡', `題目過短(${qText.length}字): "${qText}"`);
        }

        // 8. 可疑字元
        if (SUSPICIOUS_CHARS.test(qText)) {
            addIssue(filename, q.id, '🟡', `題目含可疑控制字元 | ${qText.substring(0, 50)}`);
        }
        for (let i = 0; i < q.options.length; i++) {
            if (SUSPICIOUS_CHARS.test(String(q.options[i]))) {
                addIssue(filename, q.id, '🟡', `選項${i + 1} 含可疑控制字元`);
            }
        }

        // 9. 全形數字（可能是 OCR 轉換殘留）
        if (FULLWIDTH_DIGITS.test(qText)) {
            addIssue(filename, q.id, '🟢', `題目含全形數字 | ${qText.substring(0, 50)}`);
        }
        for (let i = 0; i < q.options.length; i++) {
            if (FULLWIDTH_DIGITS.test(String(q.options[i]))) {
                addIssue(filename, q.id, '🟢', `選項${i + 1} 含全形數字: "${String(q.options[i]).substring(0, 40)}"`);
            }
        }

        // 10. 連續空白
        if (MULTI_SPACES.test(qText)) {
            addIssue(filename, q.id, '🟢', `題目有連續空白 | ${qText.substring(0, 50)}`);
        }

        // 11. 選項前後多餘空白
        for (let i = 0; i < q.options.length; i++) {
            const raw = String(q.options[i]);
            if (raw !== raw.trim()) {
                addIssue(filename, q.id, '🟢', `選項${i + 1} 有前後空白: "${raw.substring(0, 40)}"`);
            }
        }

        // 12. 常見錯別字（只掃中文題庫）
        if (!filename.includes('印尼') && !filename.includes('泰國') && !filename.includes('菲律賓') && !filename.includes('越南')) {
            for (const [typo, suggest] of Object.entries(TYPO_MAP)) {
                if (qText.includes(typo)) {
                    const note = suggest ? `→ 建議改「${suggest}」` : '（需人工確認）';
                    addIssue(filename, q.id, '🟢', `可能錯別字「${typo}」${note} | ${qText.substring(0, 50)}`);
                }
                for (let i = 0; i < q.options.length; i++) {
                    if (String(q.options[i]).includes(typo)) {
                        const note = suggest ? `→ 建議改「${suggest}」` : '（需人工確認）';
                        addIssue(filename, q.id, '🟢', `選項${i + 1} 可能錯別字「${typo}」${note}`);
                    }
                }
            }
        }
    }
}

// ==== 主程式 ====
const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f !== 'categories.json')
    .sort();

console.log(`📋 開始審查 ${files.length} 個題庫...\n`);

for (const f of files) {
    auditFile(path.join(DATA_DIR, f));
}

// 統計
const red = issues.filter(i => i.severity === '🔴');
const yellow = issues.filter(i => i.severity === '🟡');
const green = issues.filter(i => i.severity === '🟢');

console.log('='.repeat(80));
console.log(`📊 審查完畢: ${totalFiles} 個題庫, ${totalQuestions} 題`);
console.log(`   🔴 嚴重 (必修): ${red.length}`);
console.log(`   🟡 警告 (建議修): ${yellow.length}`);
console.log(`   🟢 提示 (可選修): ${green.length}`);
console.log('='.repeat(80));

if (red.length > 0) {
    console.log('\n🔴 嚴重問題:');
    for (const i of red) {
        console.log(`  [${i.file}] #${i.qId}: ${i.msg}`);
    }
}

if (yellow.length > 0) {
    console.log('\n🟡 警告:');
    for (const i of yellow) {
        console.log(`  [${i.file}] #${i.qId}: ${i.msg}`);
    }
}

if (green.length > 0) {
    console.log('\n🟢 提示:');
    for (const i of green) {
        console.log(`  [${i.file}] #${i.qId}: ${i.msg}`);
    }
}

// 輸出報告到檔案
const reportPath = path.join(__dirname, '..', 'audit_report.txt');
const reportLines = [];
reportLines.push(`題庫品質審查報告 - ${new Date().toLocaleString('zh-TW')}`);
reportLines.push(`共 ${totalFiles} 個題庫, ${totalQuestions} 題`);
reportLines.push(`🔴 嚴重: ${red.length} | 🟡 警告: ${yellow.length} | 🟢 提示: ${green.length}`);
reportLines.push('='.repeat(80));
for (const i of issues) {
    reportLines.push(`${i.severity} [${i.file}] #${i.qId}: ${i.msg}`);
}
fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');
console.log(`\n📄 完整報告已存到: ${reportPath}`);
