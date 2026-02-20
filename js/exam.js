// ===== 狀態 =====
const params = new URLSearchParams(location.search);
const CAT_ID = params.get("cat");
const MODE = params.get("mode"); // "review" = 錯題複習模式
const EXAM_MODE = params.get("examMode") || CONFIG.DEFAULT_MODE; // "normal" | "speed"

let questions = [];
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

        document.title = `${escapeHtml(catName)} — 作答中`;
        document.getElementById("exam-title").textContent = catName;
        document.getElementById("q-total").textContent = questions.length;
        document.getElementById("loading").remove();

        renderQuestion();
        updateHeader();
        renderNav();
        startTimer();
        document.addEventListener("keydown", handleKey);
        showToast("📂 已恢復上次進度");
        return;
    }

    try {
        if (MODE === "review") {
            // 錯題複習模式：從 sessionStorage 讀取錯題
            const stored = sessionStorage.getItem("reviewQuestions");
            if (!stored) throw new Error("找不到錯題資料");
            questions = JSON.parse(stored);
            catName = CAT_ID + "（錯題複習）";
        } else {
            // 一般模式：從 GAS 取題
            const res = await fetchWithTimeout(
                `${CONFIG.GAS_URL}?action=questions&cat=${encodeURIComponent(CAT_ID)}`
            );
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            // 急速模式抽指定題數
            const numQ = modeConfig.questions;
            questions = shuffleArray(data).slice(0, numQ);
            catName = EXAM_MODE === "speed" ? `${CAT_ID}（急速模式）` : CAT_ID;
        }

        // 隨機排列每題選項
        questions.forEach(q => shuffleOptions(q));

        document.title = `${escapeHtml(catName)} — 作答中`;
        document.getElementById("exam-title").textContent = catName;

        answers = questions.map(() => ({ chosen: null, hinted: false }));

        document.getElementById("q-total").textContent = questions.length;
        document.getElementById("loading").remove();

        renderQuestion();
        updateHeader();
        renderNav();
        startTimer();
        document.addEventListener("keydown", handleKey);
    } catch (e) {
        console.warn("載入題庫失敗：", e);
        document.getElementById("loading").innerHTML =
            `<p style="color:red;padding:40px 0">載入題庫失敗：${escapeHtml(e.message)}<br>請確認網路連線正常或稍後再試。</p>
       <a href="index.html" class="btn btn-outline" style="margin-top:12px">← 返回首頁</a>`;
    }
}

// ===== 計時器 =====
function startTimer() {
    const timerEl = document.getElementById("timer");
    if (!timerEl) return;
    timerEl.textContent = formatTime(timerSeconds);
    timerEl.style.display = "inline-flex";

    timerInterval = setInterval(() => {
        timerSeconds--;
        if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            timerEl.textContent = "00:00";
            showToast("⏰ 時間到！自動交卷", 3000);
            setTimeout(() => finishExam(), 1500);
            return;
        }
        timerEl.textContent = formatTime(timerSeconds);
        // 最後 5 分鐘變紅
        if (timerSeconds <= 300) timerEl.classList.add("timer-warn");
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
        toggle.textContent = "▼ 展開題目導覽";
        toggle.onclick = () => {
            const expanded = navEl.classList.toggle("expanded");
            toggle.textContent = expanded ? "▲ 收合題目導覽" : "▼ 展開題目導覽";
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
    const isAnswered = ans.chosen !== null || ans.hinted;
    const bookmarked = isBookmarked(CAT_ID, q.id);

    const noScoreBadge = ans.hinted
        ? `<div class="no-score-badge">💡 此題不列入計分</div>` : "";

    const area = document.getElementById("main-area");
    area.innerHTML = `
    <div class="question-wrap">
      <div class="question-card">
        ${noScoreBadge}
        <div class="q-top-row">
          <div class="q-number">第 ${current + 1} 題 / 共 ${questions.length} 題</div>
          <button class="btn-bookmark ${bookmarked ? "active" : ""}" onclick="toggleBm()" title="${bookmarked ? "取消收藏" : "收藏此題"}">
            ${bookmarked ? "★" : "☆"}
          </button>
        </div>
        <div class="q-text">${escapeHtml(q.q)}</div>
        <div class="options-list" id="options">
          ${q.options.map((opt, i) => {
        let cls = "";
        if (isAnswered) {
            if (i === q.answer) cls = ans.hinted && ans.chosen === null ? "hint" : "correct";
            else if (i === ans.chosen && ans.chosen !== q.answer) cls = "wrong";
        } else if (i === ans.chosen) cls = "selected";
        return `
              <button class="option-btn ${cls}" onclick="selectOption(${i})" ${isAnswered ? "disabled" : ""}>
                <span class="option-label">${LABELS[i]}</span>
                <span>${escapeHtml(opt)}</span>
              </button>`;
    }).join("")}
        </div>
        <div class="answer-hint ${isAnswered ? "show " + (ans.hinted && ans.chosen === null ? "hint-only" : ans.chosen === q.answer ? "correct" : "wrong") : ""}"
          id="answer-hint">
          ${isAnswered
            ? ans.hinted && ans.chosen === null
                ? `💡 正確答案為：${escapeHtml(q.options[q.answer])}（已查看答案，此題不列入計分）`
                : ans.chosen === q.answer
                    ? "✅ 答對了！"
                    : `❌ 答錯了，正確答案為：${escapeHtml(q.options[q.answer])}`
            : ""}
        </div>
      </div>

      <div class="action-row">
        <button class="btn btn-outline" onclick="prevQ()" ${current === 0 ? "disabled" : ""}>← 上一題</button>
        ${isAnswered
            ? `<button class="btn btn-primary" onclick="nextQ()">
               ${current === questions.length - 1 ? "查看成績 →" : "下一題 →"}
             </button>`
            : `<button class="btn btn-hint" onclick="showHint()">💡 查看答案</button>`}
        <button class="btn btn-feedback" onclick="openFeedback()">💬 反饋</button>
      </div>
    </div>`;
}

// ===== 選擇選項 =====
function selectOption(idx) {
    const ans = answers[current];
    if (ans.chosen !== null || ans.hinted) return;
    ans.chosen = idx;
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
    if (timerInterval) clearInterval(timerInterval);
    const totalTime = modeConfig.time * 60;
    const elapsed = totalTime - timerSeconds;

    // 清除存檔
    clearProgress();

    const resultData = { catId: CAT_ID, catName, questions, answers, elapsed, examMode: EXAM_MODE };
    sessionStorage.setItem("examResult", JSON.stringify(resultData));

    // 回報統計到 GAS（fire-and-forget）
    try {
        const realCorrect = answers.filter((a, i) => !a.hinted && a.chosen === questions[i].answer).length;
        const scorePerQ = CONFIG.FULL_SCORE / questions.length;
        const score = Math.round(realCorrect * scorePerQ * 100) / 100;
        fetch(CONFIG.GAS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "logResult",
                catId: CAT_ID,
                score,
                correct: realCorrect,
                total: questions.length,
                elapsed,
                mode: EXAM_MODE,
                timestamp: new Date().toISOString(),
            }),
        }).catch(e => console.warn("統計回報失敗：", e));
    } catch (e) { console.warn("統計回報失敗：", e); }

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
        typeElId: "fb-type",
        descElId: "fb-desc",
        modalEl: document.getElementById("feedback-modal"),
        btn: document.querySelector('#feedback-modal .btn-primary'),
    });
}

// ===== 啟動 =====
init();
