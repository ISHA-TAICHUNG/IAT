// ===== 狀態 =====
const params = new URLSearchParams(location.search);
const CAT_ID = params.get("cat");
const MODE = params.get("mode"); // "review" = 錯題複習模式
const EXAM_MODE = params.get("examMode") || CONFIG.DEFAULT_MODE; // "normal" | "speed"

let questions = [];
let isFinishing = false; // 防止 finishExam 重複觸發
let catName = "";
let current = 0;
let answers = [];      // answers[i] = { chosen: number|null, hinted: bool }

// 計時器
let timerInterval = null;
let modeConfig = CONFIG.MODES[EXAM_MODE] || CONFIG.MODES.normal;
let timerSeconds = modeConfig.time * 60;

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
        if (MODE === "review") {
            // 錯題複習模式：從 sessionStorage 讀取錯題
            const stored = sessionStorage.getItem("reviewQuestions");
            if (!stored) throw new Error("No review data found");
            questions = JSON.parse(stored);
            catName = CAT_ID + t('exam.review.suffix');
        } else {
            // 一般模式：從 GAS 取題
            const res = await fetchWithTimeout(
                `${CONFIG.GAS_URL}?action=questions&cat=${encodeURIComponent(CAT_ID)}`
            );
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            if (!Array.isArray(data)) throw new Error("Invalid data format");

            // 急速模式抽指定題數（維持 80/20 配比）
            const numQ = modeConfig.questions;
            const hasSubject = data.some(function(q) { return q.subject; });
            if (hasSubject && numQ < data.length) {
                const opQs = shuffleArray(data.filter(function(q) { return q.subject === '操作'; }));
                const cmQs = shuffleArray(data.filter(function(q) { return q.subject === '共同'; }));
                const opN = Math.round(numQ * 0.8);
                const cmN = numQ - opN;
                var picked = opQs.slice(0, opN).concat(cmQs.slice(0, cmN));
                // 題數不足時從剩餘題目補充
                if (picked.length < numQ) {
                    var pickedIds = new Set(picked.map(function(q) { return q.id; }));
                    var extra = shuffleArray(data.filter(function(q) { return !pickedIds.has(q.id); }));
                    picked = picked.concat(extra.slice(0, numQ - picked.length));
                }
                questions = shuffleArray(picked);
            } else {
                questions = shuffleArray(data).slice(0, numQ);
            }
            catName = EXAM_MODE === "speed" ? `${CAT_ID}${t('exam.speed.suffix')}` : CAT_ID;
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
        console.warn("Load failed:", e);
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
    const isAnswered = isMock ? false : (ans.chosen !== null || ans.hinted);
    const hasChosen = ans.chosen !== null;
    const bookmarked = isBookmarked(CAT_ID, q.id);

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
        <div class="q-text">${escapeHtml(q.q)}</div>
        ${q.image ? `<div class="q-image"><img src="${q.image}" alt="題目圖片" loading="lazy" onclick="openImageModal(this.src)"></div>` : ''}
        <div class="options-list" id="options">
          ${q.options.map((opt, i) => {
        let cls = "";
        if (isMock) {
            if (i === ans.chosen) cls = "mock-selected";
        } else if (isAnswered) {
            if (i === q.answer) cls = ans.hinted && ans.chosen === null ? "hint" : "correct";
            else if (i === ans.chosen && ans.chosen !== q.answer) cls = "wrong";
        } else if (i === ans.chosen) cls = "selected";
        var btnDisabled = isMock ? false : isAnswered;
        return `
              <button class="option-btn ${cls}${q.optionImages && q.optionImages[i] ? ' has-image' : ''}" onclick="selectOption(${i})" ${btnDisabled ? "disabled" : ""}>
                <span class="option-label">${LABELS[i]}</span>
                ${q.optionImages && q.optionImages[i]
                  ? `<img src="${q.optionImages[i]}" alt="選項${LABELS[i]}" class="option-image" loading="lazy">`
                  : `<span>${escapeHtml(opt)}</span>`}
              </button>`;
    }).join("")}
        </div>
        ${isMock ? '' : `<div class="answer-hint ${isAnswered ? "show " + (ans.hinted && ans.chosen === null ? "hint-only" : ans.chosen === q.answer ? "correct" : "wrong") : ""}"
          id="answer-hint">
          ${isAnswered
            ? ans.hinted && ans.chosen === null
                ? `${t('exam.hint.prefix')}${escapeHtml(q.options[q.answer])}${t('exam.hint.suffix')}`
                : ans.chosen === q.answer
                    ? t('exam.correct')
                    : `${t('exam.wrong.prefix')}${escapeHtml(q.options[q.answer])}`
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
            : `<button class="btn btn-hint" onclick="showHint()">${t('exam.btn.hint')}</button>`}
        <button class="btn btn-feedback" onclick="openFeedback()">${t('exam.btn.feedback')}</button>
      </div>
    </div>`;
}

// ===== 選擇選項 =====
function selectOption(idx) {
    const ans = answers[current];
    if (EXAM_MODE === 'mock') {
        // 模擬考：可以改答案
        ans.chosen = idx;
    } else {
        if (ans.chosen !== null || ans.hinted) return;
        ans.chosen = idx;
    }
    renderQuestion();
    updateHeader();
    renderNav();
    autoSave();
}

function showHint() {
    const ans = answers[current];
    if (ans.chosen !== null) return;
    ans.hinted = true;
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
    if (e.key === "Escape") {
        if (document.getElementById("feedback-modal")?.classList.contains("open")) { closeFeedback(); return; }
        if (document.getElementById("end-confirm-modal")?.classList.contains("open")) { closeEndConfirm(); return; }
    }
    if (document.getElementById("feedback-modal")?.classList.contains("open")) return;
    if (document.getElementById("end-confirm-modal")?.classList.contains("open")) return;
    if (["1", "2", "3", "4"].includes(e.key)) selectOption(Number(e.key) - 1);
    if (e.key === "ArrowRight" || e.key === "Enter") {
        if (answers[current].chosen !== null || answers[current].hinted) nextQ();
    }
    if (e.key === "ArrowLeft") prevQ();
}

function updateHeader() {
    document.getElementById("q-current").textContent = current + 1;
    const answered = answers.filter(a => a.chosen !== null || a.hinted).length;
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
        console.warn("存檔失敗（儲存空間可能不足）：", e);
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
        const realCorrect = answers.filter((a, i) => !a.hinted && a.chosen === questions[i].answer).length;
        const scorePerQ = CONFIG.FULL_SCORE / questions.length;
        const score = Math.round(realCorrect * scorePerQ * 100) / 100;
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
                answerDetails.push({ qId: q.id, correct: a.chosen === q.answer });
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
    } catch (e) { console.warn("report failed:", e); }

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
