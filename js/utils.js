// ===== 共用工具函式 =====

/** XSS 防護：HTML 跳脫 */
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

/** Toast 通知 */
function showToast(msg, dur = 2200) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), dur);
}

/** 帶 Timeout 的 Fetch */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        if (e.name === "AbortError") {
            throw new Error("伺服器回應逾時，請稍後再試");
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

/** 將題目的選項隨機排列，同時更新 answer 索引 */
function shuffleOptions(question) {
    const opts = question.options;
    const answerText = opts[question.answer];
    const indices = opts.map((_, i) => i);
    const shuffled = shuffleArray(indices);
    question.options = shuffled.map(i => opts[i]);
    question.answer = question.options.indexOf(answerText);
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
        btn.title = theme === "dark" ? "切換淺色模式" : "切換深色模式";
    });
}

function toggleTheme() {
    applyTheme(getThemePref() === "dark" ? "light" : "dark");
}

// 初始化主題（立即執行避免閃爍）
(function () {
    applyTheme(getThemePref());
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
async function submitFeedbackCommon({ catName, questionId, questionText, typeElId, descElId, modalEl, btn }) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "送出中…";

    const type = document.getElementById(typeElId).value;
    const desc = document.getElementById(descElId).value.trim();

    try {
        await fetchWithTimeout(CONFIG.GAS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "feedback",
                timestamp: new Date().toISOString(),
                catName,
                questionId,
                question: questionText,
                feedbackType: type,
                description: desc,
            }),
        });
        showToast("✅ 反饋已送出，感謝你！");
    } catch (e) {
        console.warn("反饋送出失敗：", e);
        showToast("⚠️ 反饋送出失敗，請稍後再試。");
    }

    btn.disabled = false;
    btn.textContent = "送出";
    modalEl.classList.remove("open");
    document.getElementById(descElId).value = "";
}
