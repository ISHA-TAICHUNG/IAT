// ===== 共用工具函式 =====

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
const MAX_HISTORY = 10;

function saveExamHistory(record) {
    // record: { catId, catName, score, correct, total, date }
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
