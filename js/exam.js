// ===== 狀態 =====
const params = new URLSearchParams(location.search);
const CAT_ID = params.get("cat");
const MODE = params.get("mode"); // "review" = 錯題複習模式
const EXAM_MODE = params.get("examMode") || CONFIG.DEFAULT_MODE; // "normal" | "speed"

let questions = [];
let isFinishing = false; // 防止 finishExam 重複觸發
let catName = "";
let current = 0;
let answers = [];      // answers[i] = { chosen: number|array|null, hinted: bool }

// 複選題輔助：以下函式現已抽到 utils.js（ansArrayOf, correctArrayOf, arraysEqual,
// isAnswerCorrect, formatChoices）。本地保留別名供舊呼叫者使用，避免破壞性改動。
const getAnswerArr = correctArrayOf;
const getChosenArr = ansArrayOf;
function formatCorrectAnswer(q) {
    return formatChoices(q, correctArrayOf(q));
}

// 計時器
let timerInterval = null;
let modeConfig = CONFIG.MODES[EXAM_MODE] || CONFIG.MODES.normal;
let timerSeconds = modeConfig.time * 60;

// 從 categories.json 取顯示名稱（id 可能是「移動式起重機_本籍」，name 是「移動式起重機操作人員（本籍）」）
async function resolveCatDisplayName(catId) {
    try {
        const res = await fetchWithTimeout(
            `${CONFIG.GAS_URL}?action=categories&token=${CONFIG.API_TOKEN}`
        );
        if (!res.ok) return catId;
        const cats = await res.json();
        if (!Array.isArray(cats)) return catId;
        const found = cats.find(c => c.id === catId);
        return found ? found.name : catId;
    } catch (_) {
        return catId; // 失敗時退回 id（不影響功能）
    }
}

// ===== 初始化 =====
async function init() {
    if (!CAT_ID) { location.href = "index.html"; return; }

    // 嘗試恢復存檔
    const saved = loadProgress();
    if (saved && saved.catId === CAT_ID && saved.examMode === EXAM_MODE && MODE !== "review") {
        questions = saved.questions;
        answers = saved.answers;
        current = saved.current;
        timerSeconds = saved.timerSeconds;
        catName = saved.catName;

        document.title = catName + ' — ' + t('exam.title');
        document.getElementById("exam-title").textContent = catName;
        document.getElementById("q-total").textContent = questions.length;
        var loadingEl = document.getElementById("loading");
        if (loadingEl) loadingEl.remove();

        renderQuestion();
        updateHeader();
        renderNav();
        if (timerSeconds <= 0) { finishExam(); return; }
        startTimer();
        document.addEventListener("keydown", handleKey);
        showToast(t('resume.restored'));
        return;
    }

    try {
        // 解析顯示用的職類名稱（id 可能是「移動式起重機_本籍」，name 是「移動式起重機操作人員（本籍）」）
        const displayName = await resolveCatDisplayName(CAT_ID);

        if (MODE === "review") {
            // 錯題複習模式：從 sessionStorage 讀取錯題
            const stored = sessionStorage.getItem("reviewQuestions");
            if (!stored) throw new Error("No review data found");
            questions = JSON.parse(stored);
            catName = displayName + t('exam.review.suffix');
        } else {
            // 一般模式：從 GAS 取題
            // 若該職類有特殊配比規則 (EXAM_RULES_BY_CAT) 且為 normal/mock 模式 → 取全題庫由前端自抽
            const _hasRule = CONFIG.EXAM_RULES_BY_CAT && CONFIG.EXAM_RULES_BY_CAT[CAT_ID];
            const _useFull = _hasRule && (EXAM_MODE === 'normal' || EXAM_MODE === 'mock');
            const _fullParam = _useFull ? '&full=1' : '';
            const res = await fetchWithTimeout(
                `${CONFIG.GAS_URL}?action=questions&cat=${encodeURIComponent(CAT_ID)}&token=${encodeURIComponent(CONFIG.API_TOKEN)}${_fullParam}`
            );
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            if (!Array.isArray(data)) throw new Error("Invalid data format");

            // 抽題策略（依優先序）：
            // 1) 特殊規則 (EXAM_RULES_BY_CAT)：normal/mock 模式按單選/複選分開抽
            // 2) 80/20 配比：題庫有 subject 標籤時按操作/共同 80:20 抽
            // 3) 純隨機：以上皆非
            const numQ = modeConfig.questions;
            const examRules = CONFIG.EXAM_RULES_BY_CAT && CONFIG.EXAM_RULES_BY_CAT[CAT_ID];
            const useExamRules = examRules && (EXAM_MODE === 'normal' || EXAM_MODE === 'mock');

            if (useExamRules) {
                // 1) 依職類規則分組抽題（單選 N + 複選 M）
                const singleQs = shuffleArray(data.filter(function(q) { return !isMultiQ(q); }));
                const multiQs  = shuffleArray(data.filter(function(q) { return isMultiQ(q); }));
                const singleN = examRules.single ? examRules.single.count : 0;
                const multiN  = examRules.multi  ? examRules.multi.count  : 0;
                var picked = singleQs.slice(0, singleN).concat(multiQs.slice(0, multiN));
                // 題目不足時用剩餘補滿
                if (picked.length < singleN + multiN) {
                    var pickedIds = new Set(picked.map(function(q) { return q.id; }));
                    var extra = shuffleArray(data.filter(function(q) { return !pickedIds.has(q.id); }));
                    picked = picked.concat(extra.slice(0, (singleN + multiN) - picked.length));
                }
                questions = shuffleArray(picked);
            } else {
                const hasSubject = data.some(function(q) { return q.subject; });
                if (hasSubject && numQ < data.length) {
                    // 2) 80/20 配比（既有邏輯）
                    const opQs = shuffleArray(data.filter(function(q) { return q.subject === '操作' || q.subject === '專業'; }));
                    const cmQs = shuffleArray(data.filter(function(q) { return q.subject === '共同'; }));
                    const opN = Math.round(numQ * 0.8);
                    const cmN = numQ - opN;
                    var picked = opQs.slice(0, opN).concat(cmQs.slice(0, cmN));
                    if (picked.length < numQ) {
                        var pickedIds = new Set(picked.map(function(q) { return q.id; }));
                        var extra = shuffleArray(data.filter(function(q) { return !pickedIds.has(q.id); }));
                        picked = picked.concat(extra.slice(0, numQ - picked.length));
                    }
                    questions = shuffleArray(picked);
                } else {
                    // 3) 純隨機
                    questions = shuffleArray(data).slice(0, numQ);
                }
            }
            catName = EXAM_MODE === "speed" ? `${displayName}${t('exam.speed.suffix')}` : displayName;
        }

        // 隨機排列每題選項
        questions.forEach(q => shuffleOptions(q));

        document.title = catName + ' — ' + t('exam.title');
        document.getElementById("exam-title").textContent = catName;

        answers = questions.map(() => ({ chosen: null, hinted: false }));

        document.getElementById("q-total").textContent = questions.length;
        var loadingEl2 = document.getElementById("loading");
        if (loadingEl2) loadingEl2.remove();

        renderQuestion();
        updateHeader();
        renderNav();
        startTimer();
        document.addEventListener("keydown", handleKey);
    } catch (e) {
        var el = document.getElementById("loading");
        el.textContent = t('error.load') + e.message + ' ' + t('error.network');
        el.style.color = 'red';
    }
}

// ===== 計時器 =====
function startTimer() {
    const timerWrap = document.getElementById("timer");
    const timerEl = document.getElementById("timer-text");
    if (!timerWrap || !timerEl) return;
    timerEl.textContent = formatTime(timerSeconds);
    timerWrap.style.display = "inline-flex";

    timerInterval = setInterval(() => {
        timerSeconds--;
        if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            timerEl.textContent = "00:00";
            showToast(t('exam.timeup'), 3000);
            setTimeout(() => finishExam(), 1500);
            return;
        }
        timerEl.textContent = formatTime(timerSeconds);
        // 最後 5 分鐘變紅
        if (timerSeconds <= 300) timerWrap.classList.add("timer-warn");
    }, 1000);
}

// ===== 題目導覽列 =====
function renderNav() {
    let navEl = document.getElementById("q-nav");
    if (!navEl) {
        // 建立外層 wrapper
        const wrap = document.createElement("div");
        wrap.id = "q-nav-wrap";
        wrap.className = "q-nav-wrap";

        navEl = document.createElement("div");
        navEl.id = "q-nav";
        navEl.className = "q-nav";
        wrap.appendChild(navEl);

        // toggle 按鈕（手機才顯示）
        const toggle = document.createElement("button");
        toggle.className = "q-nav-toggle";
        toggle.id = "q-nav-toggle";
        toggle.textContent = t('exam.nav.expand');
        toggle.onclick = () => {
            const expanded = navEl.classList.toggle("expanded");
            toggle.textContent = expanded ? t('exam.nav.collapse') : t('exam.nav.expand');
        };
        wrap.appendChild(toggle);

        const header = document.querySelector(".exam-header");
        if (header) header.after(wrap);
    }

    navEl.innerHTML = questions.map((q, i) => {
        const ans = answers[i];
        let cls = "nav-dot";
        if (i === current) cls += " active";
        if (ans.chosen !== null) cls += " answered";
        if (ans.hinted) cls += " hinted";
        if (isBookmarked(CAT_ID, q.id)) cls += " bookmarked";
        return `<button class="${cls}" onclick="goTo(${i})" title="第 ${i + 1} 題">${i + 1}</button>`;
    }).join("");
}

function goTo(idx) {
    if (idx < 0 || idx >= questions.length) return;
    current = idx;
    renderQuestion();
    updateHeader();
    renderNav();
}

// ===== 渲染題目 =====
function renderQuestion() {
    const q = questions[current];
    const ans = answers[current];
    const isMock = EXAM_MODE === 'mock';
    const isMulti = !!q.multi || Array.isArray(q.answer);
    const chosenArr = getChosenArr(ans.chosen);
    const correctArr = getAnswerArr(q);
    const hasSelection = chosenArr.length > 0;
    // 複選題：答題完成條件 = 已按「送出答案」(ans.submitted)；單選題：ans.chosen 有值即完成
    const isAnswered = isMock ? false : (isMulti ? (ans.submitted === true || ans.hinted) : (ans.chosen !== null || ans.hinted));
    const bookmarked = isBookmarked(CAT_ID, q.id);
    const isCorrect = isAnswerCorrect(q, ans.chosen);

    const noScoreBadge = (!isMock && ans.hinted)
        ? `<div class="no-score-badge">${t('exam.noscore')}</div>` : "";

    const area = document.getElementById("main-area");
    area.innerHTML = `
    <div class="question-wrap">
      <div class="question-card">
        ${noScoreBadge}
        <div class="q-top-row">
          <div class="q-number">${t('exam.q.prefix')}${current + 1}${t('exam.q.of')}${questions.length}${t('exam.q.unit')}</div>
          <button class="btn-bookmark ${bookmarked ? "active" : ""}" onclick="toggleBm()" title="${bookmarked ? t('exam.bookmark.remove') : t('exam.bookmark.add')}">
            ${bookmarked ? "★" : "☆"}
          </button>
        </div>
        ${isMulti ? `<div class="multi-badge" style="display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:6px;padding:2px 10px;font-size:0.82rem;font-weight:600;margin-bottom:8px">📋 複選題</div>` : ''}
        <div class="q-text">${escapeHtml(q.q)}</div>
        ${q.image ? `<div class="q-image"><img src="${q.image}" alt="題目圖片" loading="eager" onclick="openImageModal(this.src)"></div>` : ''}
        <div class="options-list" id="options" role="radiogroup" aria-label="作答選項，可按鍵盤 1-4 快速選擇">
          ${q.options.map((opt, i) => {
        let cls = "";
        const isSelected = chosenArr.indexOf(i) >= 0;
        if (isMock) {
            if (isSelected) cls = "mock-selected";
        } else if (isAnswered) {
            if (correctArr.indexOf(i) >= 0) cls = ans.hinted && !hasSelection ? "hint" : "correct";
            else if (isSelected) cls = "wrong";
        } else if (isSelected) cls = "selected";
        var btnDisabled = isMock ? false : isAnswered;
        return `
              <button class="option-btn ${cls}${q.optionImages && q.optionImages[i] ? ' has-image' : ''}" onclick="selectOption(${i})" ${btnDisabled ? "disabled" : ""}>
                <span class="option-label">${LABELS[i]}${isMulti ? (isSelected ? ' ✓' : '') : ''}</span>
                ${q.optionImages && q.optionImages[i]
                  ? `<img src="${q.optionImages[i]}" alt="選項${LABELS[i]}" class="option-image" loading="lazy">`
                  : `<span>${escapeHtml(opt)}</span>`}
              </button>`;
    }).join("")}
        </div>
        ${isMock ? '' : `<div class="answer-hint ${isAnswered ? "show " + (ans.hinted && !hasSelection ? "hint-only" : isCorrect ? "correct" : "wrong") : ""}"
          id="answer-hint">
          ${isAnswered
            ? ans.hinted && !hasSelection
                ? `${t('exam.hint.prefix')}${escapeHtml(formatCorrectAnswer(q))}${t('exam.hint.suffix')}`
                : isCorrect
                    ? t('exam.correct')
                    : `${t('exam.wrong.prefix')}${escapeHtml(formatCorrectAnswer(q))}`
            : ""}
        </div>`}
      </div>

      <div class="action-row">
        <button class="btn btn-outline" onclick="prevQ()" ${current === 0 ? "disabled" : ""}>${t('exam.btn.prev')}</button>
        ${isMock
            ? `<button class="btn btn-primary" onclick="nextQ()">
               ${current === questions.length - 1 ? t('exam.btn.finish') : t('exam.btn.next')}
             </button>`
            : isAnswered
            ? `<button class="btn btn-primary" onclick="nextQ()">
               ${current === questions.length - 1 ? t('exam.btn.finish') : t('exam.btn.next')}
             </button>`
            : (!isMock && isMulti && hasSelection)
            ? `<button class="btn btn-primary" onclick="submitMulti()">送出答案</button>
               <button class="btn btn-hint" onclick="showHint()">${t('exam.btn.hint')}</button>`
            : `<button class="btn btn-hint" onclick="showHint()">${t('exam.btn.hint')}</button>`}
        <button class="btn btn-feedback" onclick="openFeedback()">${t('exam.btn.feedback')}</button>
      </div>
    </div>`;
}

// 複選題送出答案（揭示對錯）
function submitMulti() {
    const ans = answers[current];
    ans.submitted = true;
    renderQuestion();
    autoSave();
    updateHeader();
    renderNav();
}

// ===== 選擇選項 =====
function selectOption(idx) {
    const q = questions[current];
    const ans = answers[current];
    const isMulti = !!q.multi || Array.isArray(q.answer);

    if (isMulti) {
        // 複選題：toggle 選取；若已提交或模擬考外已確認，禁止改答
        if (EXAM_MODE !== 'mock' && ans.submitted) return;
        if (ans.hinted) return;
        if (!Array.isArray(ans.chosen)) ans.chosen = [];
        const pos = ans.chosen.indexOf(idx);
        if (pos >= 0) ans.chosen.splice(pos, 1);
        else ans.chosen.push(idx);
        if (ans.chosen.length === 0) ans.chosen = null;
    } else {
        if (EXAM_MODE === 'mock') {
            ans.chosen = idx;
        } else {
            if (ans.chosen !== null || ans.hinted) return;
            ans.chosen = idx;
        }
    }
    renderQuestion();
    updateHeader();
    renderNav();
    autoSave();
}

function showHint() {
    const q = questions[current];
    const ans = answers[current];
    const isMulti = !!q.multi || Array.isArray(q.answer);
    // 複選題：若已有選擇且尚未送出，showHint 等同放棄（標記為已查看答案）
    if (isMulti) {
        if (ans.submitted) return;
        ans.hinted = true;
        ans.chosen = null;
    } else {
        if (ans.chosen !== null) return;
        ans.hinted = true;
    }
    renderQuestion();
    updateHeader();
    renderNav();
    autoSave();
}

function prevQ() { if (current > 0) { current--; renderQuestion(); updateHeader(); renderNav(); } }

function nextQ() {
    if (current < questions.length - 1) { current++; renderQuestion(); updateHeader(); renderNav(); }
    else finishExam();
}

function toggleBm() {
    const q = questions[current];
    toggleBookmark(CAT_ID, q.id);
    renderQuestion();
    renderNav();
}

function handleKey(e) {
    // 輸入法組字中（如注音、倉頡、印尼/越南文輸入法）不觸發快捷鍵，避免誤選答案
    if (e.isComposing || e.keyCode === 229) return;
    // 焦點在輸入欄位（反饋 textarea 等）時也不攔截
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) {
        if (e.key !== 'Escape') return;
    }

    if (e.key === "Escape") {
        if (document.getElementById("feedback-modal")?.classList.contains("open")) { closeFeedback(); return; }
        if (document.getElementById("end-confirm-modal")?.classList.contains("open")) { closeEndConfirm(); return; }
    }
    if (document.getElementById("feedback-modal")?.classList.contains("open")) return;
    if (document.getElementById("end-confirm-modal")?.classList.contains("open")) return;
    if (["1", "2", "3", "4"].includes(e.key)) selectOption(Number(e.key) - 1);
    if (e.key === "ArrowRight" || e.key === "Enter") {
        // 複選題必須 submitted 或 hinted 才能前進，避免跳過判分
        const q = questions[current];
        const ans = answers[current];
        const isMulti = !!q.multi || Array.isArray(q.answer);
        const canAdvance = isMulti
            ? (ans.submitted === true || ans.hinted)
            : (ans.chosen !== null || ans.hinted);
        if (canAdvance) nextQ();
    }
    if (e.key === "ArrowLeft") prevQ();
}

function updateHeader() {
    document.getElementById("q-current").textContent = current + 1;
    // 複選題需 submitted；單選題只要 chosen 或 hinted 即算已答
    const answered = answers.filter((a, i) => {
        if (a.hinted) return true;
        const q = questions[i];
        const isMulti = !!q.multi || Array.isArray(q.answer);
        return isMulti ? (a.submitted === true) : (a.chosen !== null);
    }).length;
    document.getElementById("answered-count").textContent = answered;
    document.getElementById("progress-bar").style.width =
        ((current + 1) / questions.length * 100) + "%";
}

// ===== 中途存檔 =====
function autoSave() {
    if (MODE === "review") return; // 錯題複習不存檔
    try {
        saveProgress({
            catId: CAT_ID,
            catName,
            examMode: EXAM_MODE,
            questions,
            answers,
            current,
            timerSeconds,
            savedAt: new Date().toISOString(),
        });
    } catch (e) {
        // 儲存空間不足 → 嘗試釋放歷史與離線反饋佇列後再試
        try { localStorage.removeItem("feedback_queue"); } catch (_) {}
        try {
            const hist = JSON.parse(localStorage.getItem("exam_history") || "[]");
            if (hist.length > 10) {
                localStorage.setItem("exam_history", JSON.stringify(hist.slice(0, 10)));
            }
        } catch (_) {}
        try {
            saveProgress({ catId: CAT_ID, catName, examMode: EXAM_MODE, questions, answers,
                current, timerSeconds, savedAt: new Date().toISOString() });
        } catch (_) { /* 仍然失敗就放棄存檔，不影響作答 */ }
    }
}

// ===== 提前結束 =====
function endEarly() {
    if (!questions.length) return;
    document.getElementById("end-confirm-modal").classList.add("open");
}
function closeEndConfirm() {
    document.getElementById("end-confirm-modal").classList.remove("open");
}
function confirmEnd() {
    closeEndConfirm();
    finishExam();
}

function finishExam() {
    if (isFinishing) return;
    isFinishing = true;
    if (timerInterval) clearInterval(timerInterval);
    const totalTime = modeConfig.time * 60;
    const elapsed = Math.max(0, totalTime - timerSeconds);

    // 清除存檔
    clearProgress();

    const resultData = { catId: CAT_ID, catName, questions, answers, elapsed, examMode: EXAM_MODE };
    sessionStorage.setItem("examResult", JSON.stringify(resultData));

    // 回報統計到 GAS（使用 sendBeacon 確保頁面跳轉前送出）
    try {
        // 使用共用 calculateScore（支援職類特殊配分規則）
        const sc = calculateScore(CAT_ID, questions, answers);
        const realCorrect = sc.realCorrect;
        const score = sc.score;
        navigator.sendBeacon(CONFIG.GAS_URL, JSON.stringify({
            action: "logResult",
            token: CONFIG.API_TOKEN,
            catId: CAT_ID,
            score,
            correct: realCorrect,
            total: questions.length,
            elapsed,
            mode: EXAM_MODE,
            timestamp: new Date().toISOString(),
        }));

        // 回報答題明細（只送有作答且非查看答案的題目，減少資料量）
        var answerDetails = [];
        questions.forEach(function(q, i) {
            var a = answers[i];
            if (a.chosen !== null && !a.hinted) {
                answerDetails.push({ qId: q.id, correct: isAnswerCorrect(q, a.chosen) });
            }
        });
        if (answerDetails.length > 0) {
            navigator.sendBeacon(CONFIG.GAS_URL, JSON.stringify({
                action: "logAnswers",
                token: CONFIG.API_TOKEN,
                catId: CAT_ID,
                answers: answerDetails,
            }));
        }
    } catch (e) { /* sendBeacon 失敗不影響成績頁顯示，靜默處理 */ }

    location.href = "result.html";
}

// ===== 反饋 Modal =====
let feedbackQIndex = null;

function openFeedback() {
    feedbackQIndex = current;
    document.getElementById("feedback-modal").classList.add("open");
}
function closeFeedback() {
    document.getElementById("feedback-modal").classList.remove("open");
}

async function submitFeedback() {
    const q = questions[feedbackQIndex];
    await submitFeedbackCommon({
        catName,
        questionId: q.id,
        questionText: q.q,
        options: q.options,
        answer: q.answer,
        typeElId: "fb-type",
        descElId: "fb-desc",
        modalEl: document.getElementById("feedback-modal"),
        btn: document.querySelector('#feedback-modal .btn-primary'),
    });
}

// ===== 圖片放大 Modal =====
function openImageModal(src) {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('modal-image');
    img.src = src;
    modal.classList.add('show');
}
function closeImageModal() {
    document.getElementById('image-modal').classList.remove('show');
}

// ===== 啟動 =====
init();
