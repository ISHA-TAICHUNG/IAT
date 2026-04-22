// ===== 檔案轉檔工具（純前端，不上傳雲端）=====
// PDF → TXT 用 PDF.js、XLSX → CSV 用 SheetJS

// 動態載入 PDF.js（CDN ESM）
import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs').then(pdfLib => {
    pdfLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
    window.__pdfjsLib = pdfLib;
}).catch(err => {
    console.error('PDF.js 載入失敗', err);
});

// ===== 共用 =====
function log(area, msg, type) {
    area.classList.add('show');
    const line = document.createElement('div');
    line.className = 'log-line' + (type ? ' ' + type : '');
    line.textContent = msg;
    area.appendChild(line);
    area.scrollTop = area.scrollHeight;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

function renderFileList(listEl, files) {
    listEl.textContent = '';
    files.forEach((f, i) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        const name = document.createElement('span');
        name.textContent = f.name + ' (' + (f.size / 1024).toFixed(1) + ' KB)';
        const status = document.createElement('span');
        status.className = 'status waiting';
        status.textContent = '待轉';
        status.dataset.idx = i;
        item.appendChild(name);
        item.appendChild(status);
        listEl.appendChild(item);
    });
}

function updateStatus(listEl, idx, cls, text) {
    const st = listEl.querySelector(`[data-idx="${idx}"]`);
    if (!st) return;
    st.className = 'status ' + cls;
    st.textContent = text;
}

// ===== Drop zone 通用初始化 =====
function initDropZone(dropEl, inputEl, onFiles) {
    dropEl.addEventListener('dragover', e => {
        e.preventDefault();
        dropEl.classList.add('dragover');
    });
    dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragover'));
    dropEl.addEventListener('drop', e => {
        e.preventDefault();
        dropEl.classList.remove('dragover');
        onFiles(Array.from(e.dataTransfer.files));
    });
    inputEl.addEventListener('change', () => {
        onFiles(Array.from(inputEl.files));
    });
}

// ===== PDF → TXT =====
const pdfDrop = document.getElementById('pdfDrop');
const pdfInput = document.getElementById('pdfInput');
const pdfFileList = document.getElementById('pdfFileList');
const pdfConvertBtn = document.getElementById('pdfConvertBtn');
const pdfClearBtn = document.getElementById('pdfClearBtn');
const pdfLog = document.getElementById('pdfLog');
let pdfFiles = [];

initDropZone(pdfDrop, pdfInput, files => {
    pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    renderFileList(pdfFileList, pdfFiles);
    pdfConvertBtn.disabled = pdfFiles.length === 0;
});

pdfClearBtn.addEventListener('click', () => {
    pdfFiles = [];
    pdfFileList.textContent = '';
    pdfInput.value = '';
    pdfLog.classList.remove('show');
    pdfLog.textContent = '';
    pdfConvertBtn.disabled = true;
});

pdfConvertBtn.addEventListener('click', async () => {
    if (!window.__pdfjsLib) {
        log(pdfLog, '⚠ PDF.js 尚未載入完成，請稍後再試', 'err');
        return;
    }
    pdfConvertBtn.disabled = true;
    for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        updateStatus(pdfFileList, i, 'processing', '轉檔中…');
        try {
            const buf = await file.arrayBuffer();
            const pdf = await window.__pdfjsLib.getDocument({ data: buf }).promise;
            const parts = [];
            for (let p = 1; p <= pdf.numPages; p++) {
                const page = await pdf.getPage(p);
                const content = await page.getTextContent();
                // 依 y 座標分行，每個 item 按原順序接起來
                let lastY = null;
                let line = '';
                content.items.forEach(it => {
                    const y = it.transform[5];
                    if (lastY !== null && Math.abs(y - lastY) > 2) {
                        parts.push(line.trimEnd());
                        line = '';
                    }
                    line += it.str;
                    if (it.hasEOL) {
                        parts.push(line.trimEnd());
                        line = '';
                    }
                    lastY = y;
                });
                if (line) parts.push(line.trimEnd());
            }
            const txt = parts.join('\n');
            const outName = file.name.replace(/\.pdf$/i, '.txt');
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            downloadBlob(blob, outName);
            updateStatus(pdfFileList, i, 'done', '✓ ' + outName);
            log(pdfLog, `✓ ${file.name} → ${outName}（${pdf.numPages} 頁、${parts.length} 行）`, 'ok');
        } catch (err) {
            updateStatus(pdfFileList, i, 'error', '✗ 失敗');
            log(pdfLog, `✗ ${file.name}: ${err.message || err}`, 'err');
        }
    }
    pdfConvertBtn.disabled = false;
});

// ===== XLSX → CSV =====
const ALLOWED_WRITTEN_FIELDS_ZH = new Set([
    '准考證號', '學科測試編號', '場地', '試場', '場次', '測試日期', '測試時間'
]);
const WRITTEN_FIELD_MAP = {
    '准考證號': 'aeno',
    '學科測試編號': 'examno',
    '場地': 'venue',
    '試場': 'room',
    '場次': 'distid',
    '測試日期': 'exdate',
    '測試時間': 'extime'
};
const ALLOWED_REG_FIELDS = new Set([
    'IDNO', 'NAME', 'AENO', 'PNO', 'EGR', 'DSTNG', 'OPEXDT', 'OPEXTIME'
]);

const xlsxDrop = document.getElementById('xlsxDrop');
const xlsxInput = document.getElementById('xlsxInput');
const xlsxFileList = document.getElementById('xlsxFileList');
const xlsxConvertBtn = document.getElementById('xlsxConvertBtn');
const xlsxClearBtn = document.getElementById('xlsxClearBtn');
const xlsxLog = document.getElementById('xlsxLog');
let xlsxFiles = [];

initDropZone(xlsxDrop, xlsxInput, files => {
    xlsxFiles = files.filter(f => /\.xlsx?$/i.test(f.name));
    renderFileList(xlsxFileList, xlsxFiles);
    xlsxConvertBtn.disabled = xlsxFiles.length === 0;
});

xlsxClearBtn.addEventListener('click', () => {
    xlsxFiles = [];
    xlsxFileList.textContent = '';
    xlsxInput.value = '';
    xlsxLog.classList.remove('show');
    xlsxLog.textContent = '';
    xlsxConvertBtn.disabled = true;
});

// 以 UTF-8 BOM 輸出讓 Excel 正確辨識中文
function rowsToCsv(rows) {
    const bom = '\uFEFF';
    const escape = v => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };
    return bom + rows.map(r => r.map(escape).join(',')).join('\n');
}

function convertWrittenXlsx(wb) {
    // 學科報檢：第 3 列（index 2）是中文欄位名、第 4 列起資料
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 4) throw new Error('資料不足');
    const zhHeaders = rows[2];
    const keepIdx = [], keepZh = [], keepEn = [];
    zhHeaders.forEach((h, i) => {
        const s = String(h || '').trim();
        if (ALLOWED_WRITTEN_FIELDS_ZH.has(s)) {
            keepIdx.push(i);
            keepZh.push(s);
            keepEn.push(WRITTEN_FIELD_MAP[s]);
        }
    });
    if (keepIdx.length === 0) throw new Error('找不到預期的欄位');
    const out = [keepZh, keepEn];
    let count = 0;
    for (let r = 3; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[keepIdx[0]]) continue;
        out.push(keepIdx.map(i => (row[i] !== null && row[i] !== undefined) ? String(row[i]) : ''));
        count++;
    }
    return { csv: rowsToCsv(out), count, outName: '學科報檢資料.csv' };
}

function convertRegistrationXlsx(wb) {
    // 術科報檢：SKT1 sheet 或第 1 個 sheet；row 0 = 中文、row 1 = 英文欄位、row 2+ = 資料
    const sheetName = wb.SheetNames.includes('SKT1') ? 'SKT1' : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 3) throw new Error('資料不足');
    const zhHeaders = rows[0];
    const enFields = rows[1];
    const keepIdx = [];
    enFields.forEach((f, i) => {
        if (f && ALLOWED_REG_FIELDS.has(String(f).trim().toUpperCase())) {
            keepIdx.push(i);
        }
    });
    if (keepIdx.length === 0) throw new Error('找不到預期的欄位');
    const out = [
        keepIdx.map(i => zhHeaders[i]),
        keepIdx.map(i => enFields[i])
    ];
    let count = 0;
    for (let r = 2; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[keepIdx[0]]) continue;
        out.push(keepIdx.map(i => (row[i] !== null && row[i] !== undefined) ? String(row[i]) : ''));
        count++;
    }
    return { csv: rowsToCsv(out), count, outName: '報檢資料.csv' };
}

xlsxConvertBtn.addEventListener('click', async () => {
    if (typeof XLSX === 'undefined') {
        log(xlsxLog, '⚠ SheetJS 尚未載入完成', 'err');
        return;
    }
    xlsxConvertBtn.disabled = true;
    for (let i = 0; i < xlsxFiles.length; i++) {
        const file = xlsxFiles[i];
        updateStatus(xlsxFileList, i, 'processing', '轉檔中…');
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            let result;
            if (file.name.includes('學科報檢資料')) {
                result = convertWrittenXlsx(wb);
            } else {
                result = convertRegistrationXlsx(wb);
            }
            const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
            downloadBlob(blob, result.outName);
            updateStatus(xlsxFileList, i, 'done', `✓ ${result.count} 筆`);
            log(xlsxLog, `✓ ${file.name} → ${result.outName}（${result.count} 筆，個資已過濾）`, 'ok');
        } catch (err) {
            updateStatus(xlsxFileList, i, 'error', '✗ 失敗');
            log(xlsxLog, `✗ ${file.name}: ${err.message || err}`, 'err');
        }
    }
    xlsxConvertBtn.disabled = false;
});
