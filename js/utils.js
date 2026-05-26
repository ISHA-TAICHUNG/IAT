// ===== 共用工具函式 =====

/**
 * 取得（或產生）此瀏覽器的 clientId（localStorage UUID）
 * 給 GAS rate limit 用：每個 client 有自己的 20 req/min 配額。
 * 若 localStorage 不可用（隱私模式 / iframe）會 fallback 為單次 session id。
 */
function getOrCreateClientId() {
    var KEY = 'exam_client_id';
    try {
        var existing = localStorage.getItem(KEY);
        if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
        // 產 RFC4122 v4 UUID（前綴 c_ 易識別）
        var uuid;
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            uuid = window.crypto.randomUUID();
        } else {
            uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = (Math.random() * 16) | 0;
                var v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
        }
        var id = 'c_' + uuid.replace(/-/g, '').slice(0, 32);
        localStorage.setItem(KEY, id);
        return id;
    } catch (_) {
        // 隱私模式或受限環境：fallback 為 page session 隨機（不持久但仍能分流）
        if (!window.__examSessionClientId) {
            window.__examSessionClientId = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        }
        return window.__examSessionClientId;
    }
}

/** 取得特定職類的及格分數（支援 PASS_SCORE_BY_CAT 覆蓋） */
function getPassScore(catId) {
    if (catId && CONFIG.PASS_SCORE_BY_CAT && CONFIG.PASS_SCORE_BY_CAT[catId] !== undefined) {
        return CONFIG.PASS_SCORE_BY_CAT[catId];
    }
    return CONFIG.PASS_SCORE;
}

/** XSS 防護：HTML 跳脫 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/** Toast 通知 */
function showToast(msg, dur = 2200) {
    const toastEl = document.getElementById("toast");
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), dur);
}

/** 帶 Timeout 的 Fetch（自動附加 API Token） */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    // 自動附加 API Token
    if (typeof CONFIG !== "undefined" && CONFIG.API_TOKEN) {
        if (options.method === "POST" && options.body) {
            try {
                const body = JSON.parse(options.body);
                body.token = CONFIG.API_TOKEN;
                options = { ...options, body: JSON.stringify(body) };
            } catch (e) { /* 非 JSON body，跳過 */ }
        } else {
            const sep = url.includes("?") ? "&" : "?";
            url += `${sep}token=${encodeURIComponent(CONFIG.API_TOKEN)}`;
        }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        if (e.name === "AbortError") {
            throw new Error(typeof t === 'function' ? t('error.timeout') : 'Server timeout');
        }
        throw e;
    }
}

/** Fisher-Yates Shuffle（回傳新陣列） */
function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** 將題目的選項隨機排列，同時更新 answer 索引
 *  「以上皆是/以上皆非」等綜合選項固定在最後，不參與亂序 */
function shuffleOptions(question) {
    const opts = question.options;
    const origOptImages = question.optionImages ? question.optionImages.slice() : null;
    const pinPatterns = ['以上皆是', '以上皆非', '以上皆對', '以上皆錯', '以上都是', '以上均是'];

    // 分離：需固定在尾端的選項 vs 參與亂序的選項
    const pinned = []; // { origIdx, opt }
    const normal = []; // { origIdx, opt }
    opts.forEach((opt, i) => {
        if (pinPatterns.some(p => opt.includes(p))) {
            pinned.push({ origIdx: i, opt });
        } else {
            normal.push({ origIdx: i, opt });
        }
    });

    // 只亂序一般選項
    const shuffledNormal = shuffleArray(normal);
    // 組合：一般選項在前，固定選項在後（維持原相對順序）
    const combined = [...shuffledNormal, ...pinned];

    // 重建 options、answer、optionImages 映射
    question.options = combined.map(c => c.opt);
    // 支援複選題（answer 為陣列）與單選題（answer 為數字）
    if (Array.isArray(question.answer)) {
        question.answer = question.answer
            .map(origIdx => combined.findIndex(c => c.origIdx === origIdx))
            .sort((a, b) => a - b);
    } else {
        question.answer = combined.findIndex(c => c.origIdx === question.answer);
    }
    if (origOptImages) {
        question.optionImages = combined.map(c => origOptImages[c.origIdx]);
    }
    return question;
}

/** 格式化秒數為 mm:ss */
function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 成績歷史（localStorage）*/
const HISTORY_KEY = "exam_history";
const MAX_HISTORY = 50;

function saveExamHistory(record) {
    // record: { catId, catName, score, correct, total, date, mode }
    const history = getExamHistory();
    history.unshift(record);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        // 容量滿（QuotaExceededError 等）→ 自動瘦身重試
        // 策略：保留最近 20 筆，並嘗試清掉 feedback_queue 釋放空間
        try {
            const slim = history.slice(0, 20);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(slim));
        } catch (_) {
            // 還是失敗 → 釋放輔助資料後再試
            try { localStorage.removeItem("feedback_queue"); } catch (_) {}
            try {
                localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
            } catch (__) {
                // 終極失敗 → 整個歷史丟掉，至少保住新一筆
                localStorage.setItem(HISTORY_KEY, JSON.stringify([record]));
            }
        }
    }
}

function getExamHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch { return []; }
}

/** 選項標籤 */
const LABELS = ["A", "B", "C", "D"];

/**
 * 答案處理共用函式（exam.js / result.js 共用）
 * 統一處理單選 (number) / 複選 (array) / 未答 (null/undefined) 三種情形
 */
function ansArrayOf(value) {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value.slice().sort() : [value];
}
function correctArrayOf(q) {
    return Array.isArray(q.answer) ? q.answer.slice().sort() : [q.answer];
}
function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
function isAnswerCorrect(q, chosen) {
    if (chosen === null || chosen === undefined) return false;
    return arraysEqual(correctArrayOf(q), ansArrayOf(chosen));
}
/** 判斷題目是否為複選題（answer 為陣列或 type==='multi'） */
function isMultiQ(q) {
    return !!(q && (q.type === 'multi' || Array.isArray(q.answer)));
}
/**
 * 計算分數：支援「依職類分別配分」的特殊規則 (CONFIG.EXAM_RULES_BY_CAT)
 * 若 catId 在 EXAM_RULES_BY_CAT，按單選/複選 scorePerQ 分別計算
 * 否則用預設：FULL_SCORE / 題數 平均配分
 *
 * @param {string} catId 職類 ID
 * @param {Array} questions 題目陣列
 * @param {Array} answers 作答陣列（每元素 {chosen, hinted}）
 * @returns {{score:number, realCorrect:number, perQ:Array<number>}}
 */
function calculateScore(catId, questions, answers) {
    const rules = (typeof CONFIG !== 'undefined' && CONFIG.EXAM_RULES_BY_CAT) ? CONFIG.EXAM_RULES_BY_CAT[catId] : null;
    let realCorrect = 0;
    const perQ = [];
    if (rules) {
        // 特殊規則：單選/複選分別配分
        let total = 0;
        questions.forEach((q, i) => {
            const a = answers[i] || {};
            const correct = !a.hinted && isAnswerCorrect(q, a.chosen);
            const isMulti = isMultiQ(q);
            const scorePerQ = isMulti
                ? (rules.multi && rules.multi.scorePerQ) || 0
                : (rules.single && rules.single.scorePerQ) || 0;
            perQ.push(scorePerQ);
            if (correct) {
                realCorrect++;
                total += scorePerQ;
            }
        });
        return { score: Math.round(total * 100) / 100, realCorrect, perQ };
    }
    // 預設：均等配分
    const scorePerQ = CONFIG.FULL_SCORE / questions.length;
    questions.forEach((q, i) => {
        const a = answers[i] || {};
        if (!a.hinted && isAnswerCorrect(q, a.chosen)) realCorrect++;
        perQ.push(scorePerQ);
    });
    return { score: Math.round(realCorrect * scorePerQ * 100) / 100, realCorrect, perQ };
}
/**
 * 格式化答案索引陣列為「A. xxx、B. yyy」字串
 * @param {Object} q 題目（需有 options）
 * @param {number[]} indices 索引陣列
 */
function formatChoices(q, indices) {
    if (!indices || indices.length === 0) return '';
    return indices.map(i => LABELS[i] + '. ' + q.options[i]).join('、');
}

// ===== 深色模式 =====
const THEME_KEY = "theme_pref";

function getThemePref() {
    return localStorage.getItem(THEME_KEY) || "light";
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    // 更新所有 toggle 按鈕
    document.querySelectorAll(".theme-toggle").forEach(btn => {
        btn.textContent = theme === "dark" ? "☀️" : "🌙";
        btn.title = theme === "dark" ? (typeof t === 'function' ? t('theme.light') : 'Light') : (typeof t === 'function' ? t('theme.dark') : 'Dark');
    });
}

function toggleTheme() {
    applyTheme(getThemePref() === "dark" ? "light" : "dark");
}

// ===== 字體大小 =====
const FONTSIZE_KEY = "fontsize_pref";
const FONTSIZES = ["normal", "large", "xlarge"];
const FONTSIZE_LABELS = { normal: "字小", large: "字中", xlarge: "字大" };

function getFontSizePref() {
    return localStorage.getItem(FONTSIZE_KEY) || "normal";
}

function applyFontSize(size) {
    document.documentElement.setAttribute("data-fontsize", size);
    localStorage.setItem(FONTSIZE_KEY, size);
    document.querySelectorAll(".fontsize-btn").forEach(function(btn) {
        btn.textContent = FONTSIZE_LABELS[size] || "A";
    });
}

function cycleFontSize() {
    var current = getFontSizePref();
    var idx = FONTSIZES.indexOf(current);
    var next = FONTSIZES[(idx + 1) % FONTSIZES.length];
    applyFontSize(next);
}

// 初始化主題 + 字體（立即執行避免閃爍）
(function () {
    applyTheme(getThemePref());
    applyFontSize(getFontSizePref());
})();

// ===== 中途存檔 =====
const SAVE_KEY = "exam_save";

function saveProgress(data) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function loadProgress() {
    try {
        return JSON.parse(localStorage.getItem(SAVE_KEY));
    } catch { return null; }
}

function clearProgress() {
    localStorage.removeItem(SAVE_KEY);
}

// ===== 收藏/標記 =====
const BOOKMARK_KEY = "exam_bookmarks";

function getBookmarks() {
    try {
        return JSON.parse(localStorage.getItem(BOOKMARK_KEY)) || {};
    } catch { return {}; }
}

function toggleBookmark(catId, questionId) {
    const all = getBookmarks();
    const key = `${catId}__${questionId}`;
    if (all[key]) delete all[key];
    else all[key] = true;
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(all));
    return !!all[key];
}

function isBookmarked(catId, questionId) {
    return !!getBookmarks()[`${catId}__${questionId}`];
}

// ===== 共用反饋提交 =====
async function submitFeedbackCommon({ catName, questionId, questionText, options, answer, typeElId, descElId, modalEl, btn }) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "送出中…";

    const type = document.getElementById(typeElId).value;
    const desc = document.getElementById(descElId).value.trim();

    var feedbackPayload = {
        action: "feedback",
        token: CONFIG.API_TOKEN,
        clientId: getOrCreateClientId(),  // GAS rate-limit per-client 配額
        timestamp: new Date().toISOString(),
        catName: catName,
        questionId: questionId,
        question: questionText,
        optionA: options ? options[0] || "" : "",
        optionB: options ? options[1] || "" : "",
        optionC: options ? options[2] || "" : "",
        optionD: options ? options[3] || "" : "",
        // 答案：單選回 "A"/"B"/"C"/"D"；複選回 "AC"（多個字母串接，Sheet 「預設答案」欄位可讀）
        // 安全處理 number / array / null / undefined 四種輸入
        answer: (function() {
            if (answer === null || answer === undefined) return "";
            if (Array.isArray(answer)) {
                return answer
                    .slice()
                    .sort(function(a, b) { return a - b; })
                    .map(function(i) { return LABELS[i] || ""; })
                    .filter(function(s) { return s; })
                    .join("");
            }
            return LABELS[answer] || "";
        })(),
        feedbackType: type,
        description: desc,
    };

    try {
        await fetchWithTimeout(CONFIG.GAS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(feedbackPayload),
        });
        showToast(typeof t === 'function' ? t('fb.success') : 'Submitted!');
    } catch (e) {
        // 提交失敗（多半是斷網）→ 暫存到 localStorage 佇列，下次上線自動補送
        var queue = JSON.parse(localStorage.getItem("feedback_queue") || "[]");
        queue.push(feedbackPayload);
        localStorage.setItem("feedback_queue", JSON.stringify(queue));
        showToast(typeof t === 'function' ? t('fb.queued') : 'Saved offline, will send later');
    }

    btn.disabled = false;
    btn.textContent = typeof t === 'function' ? t('fb.submit') : 'Submit';
    modalEl.classList.remove("open");
    document.getElementById(descElId).value = "";
}

// 離線反饋佇列：上線後自動補送（使用 Promise.allSettled 避免資料遺失）
async function flushFeedbackQueue() {
    var queue = JSON.parse(localStorage.getItem("feedback_queue") || "[]");
    if (queue.length === 0) return;
    // Legacy payload 補 clientId：舊版本 queued 沒有 clientId 欄位，補上避免進 "anon" bucket
    var clientId = getOrCreateClientId();
    queue.forEach(function(payload) {
        if (payload && !payload.clientId) payload.clientId = clientId;
    });
    var results = await Promise.allSettled(queue.map(function(payload) {
        return fetch(CONFIG.GAS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    }));
    var remaining = queue.filter(function(_, i) { return results[i].status === 'rejected'; });
    if (remaining.length > 0) {
        localStorage.setItem("feedback_queue", JSON.stringify(remaining));
    } else {
        localStorage.removeItem("feedback_queue");
    }
}
