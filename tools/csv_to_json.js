#!/usr/bin/env node
/**
 * CSV → 題庫 JSON 轉換工具（編輯完 CSV 後轉回 JSON）
 * 用法：node csv_to_json.js [指定檔名.csv]
 * 不帶參數 = 轉換 csv/ 下所有 CSV
 * 輸出覆蓋 data/ 下對應的 JSON
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CSV_DIR = path.join(__dirname, '..', 'csv');

function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    result.push(current);
    return result;
}

function csvToJson(csvPath) {
    const basename = path.basename(csvPath, '.csv');
    let content = fs.readFileSync(csvPath, 'utf-8');
    // 移除 BOM
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    const lines = content.split(/\r?\n/).filter(l => l.trim());
    // 跳過 header
    const dataLines = lines.slice(1);

    // 讀取原始 JSON 以保留 metadata
    const jsonPath = path.join(DATA_DIR, `${basename}.json`);
    let original = {};
    if (fs.existsSync(jsonPath)) {
        original = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    }

    const questions = [];
    for (const line of dataLines) {
        const cols = parseCsvLine(line);
        if (cols.length < 7) continue;

        questions.push({
            q: cols[1].trim(),
            options: [cols[2].trim(), cols[3].trim(), cols[4].trim(), cols[5].trim()],
            answer: parseInt(cols[6], 10) - 1,
            id: parseInt(cols[0], 10),
        });
    }

    const output = {
        id: original.id || basename,
        name: original.name || basename,
        group: original.group || '',
        total: questions.length,
        questions,
    };

    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`✅ ${basename}.csv → ${jsonPath} (${questions.length} 題)`);
}

// 主程式
const target = process.argv[2];
if (target) {
    const p = path.resolve(CSV_DIR, target);
    if (!fs.existsSync(p)) {
        console.error(`❌ 找不到: ${p}`);
        process.exit(1);
    }
    csvToJson(p);
} else {
    const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
    console.log(`🔄 轉換 ${files.length} 個 CSV...`);
    for (const f of files) {
        csvToJson(path.join(CSV_DIR, f));
    }
    console.log(`\n📁 JSON 已更新到: ${DATA_DIR}`);
}
