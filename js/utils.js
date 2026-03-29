// ===== 共用工具函式 =====

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
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), dur);
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
    question.answer = combined.findIndex(c => c.origIdx === question.answer);
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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function getExamHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch { return []; }
}

/** 選項標籤 */
const LABELS = ["A", "B", "C", "D"];

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
const FONTSIZE_LABELS = { normal: "A", large: "A⁺", xlarge: "A⁺⁺" };

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
        timestamp: new Date().toISOString(),
        catName: catName,
        questionId: questionId,
        question: questionText,
        optionA: options ? options[0] || "" : "",
        optionB: options ? options[1] || "" : "",
        optionC: options ? options[2] || "" : "",
        optionD: options ? options[3] || "" : "",
        answer: answer != null ? LABELS[answer] : "",
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
        console.warn("Feedback submit failed, queuing:", e);
        // 離線佇列：暫存到 localStorage
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

// 離線反饋佇列：上線後自動補送
function flushFeedbackQueue() {
    var queue = JSON.parse(localStorage.getItem("feedback_queue") || "[]");
    if (queue.length === 0) return;
    var remaining = [];
    queue.forEach(function(payload) {
        fetch(CONFIG.GAS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }).catch(function() {
            remaining.push(payload);
        });
    });
    // 短暫延遲後更新佇列（等 fetch 完成）
    setTimeout(function() {
        if (remaining.length > 0) {
            localStorage.setItem("feedback_queue", JSON.stringify(remaining));
        } else {
            localStorage.removeItem("feedback_queue");
        }
    }, 3000);
}
