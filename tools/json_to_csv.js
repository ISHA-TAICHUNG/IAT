#!/usr/bin/env node
/**
 * 題庫 JSON → CSV 轉換工具
 * 用法：node json_to_csv.js [指定檔名.json]
 * 不帶參數 = 轉換 data/ 下所有題庫 JSON
 * 輸出到 csv/ 資料夾
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CSV_DIR = path.join(__dirname, '..', 'csv');

// 確保 csv 資料夾存在
if (!fs.existsSync(CSV_DIR)) fs.mkdirSync(CSV_DIR, { recursive: true });

function escapeCsv(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function jsonToCsv(jsonPath) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const basename = path.basename(jsonPath, '.json');

    // BOM for Excel 正確顯示中文
    const BOM = '\uFEFF';
    const header = ['id', '題目', '選項A', '選項B', '選項C', '選項D', '正確答案(1=A,2=B,3=C,4=D)'];
    const rows = [header.join(',')];

    for (const q of raw.questions) {
        const row = [
            q.id,
            escapeCsv(q.q),
            escapeCsv(q.options[0] || ''),
            escapeCsv(q.options[1] || ''),
            escapeCsv(q.options[2] || ''),
            escapeCsv(q.options[3] || ''),
            q.answer + 1,
        ];
        rows.push(row.join(','));
    }

    const csvPath = path.join(CSV_DIR, `${basename}.csv`);
    fs.writeFileSync(csvPath, BOM + rows.join('\n'), 'utf-8');
    console.log(`✅ ${basename}.json → ${csvPath} (${raw.questions.length} 題)`);
}

// 主程式
const target = process.argv[2];
if (target) {
    const p = path.resolve(DATA_DIR, target);
    if (!fs.existsSync(p)) {
        console.error(`❌ 找不到: ${p}`);
        process.exit(1);
    }
    jsonToCsv(p);
} else {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && f !== 'categories.json');
    console.log(`🔄 轉換 ${files.length} 個題庫...`);
    for (const f of files) {
        jsonToCsv(path.join(DATA_DIR, f));
    }
    console.log(`\n📁 CSV 檔案輸出到: ${CSV_DIR}`);
}
