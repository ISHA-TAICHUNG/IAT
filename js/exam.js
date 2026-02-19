// ===== 狀態 =====
const params = new URLSearchParams(location.search);
const CAT_ID = params.get("cat");
const MODE = params.get("mode"); // "review" = 錯題複習模式

let questions = [];
let catName = "";
let current = 0;
let answers = [];      // answers[i] = { chosen: number|null, hinted: bool }

// 計時器
let timerInterval = null;
let timerSeconds = CONFIG.EXAM_TIME_LIMIT * 60; // 80分鐘

// ===== 初始化 =====
async function init() {
    if (!CAT_ID) { location.href = "index.html"; return; }

    try {
        if (MODE === "review") {
            // 錯題複習模式：從 sessionStorage 讀取錯題
            const stored = sessionStorage.getItem("reviewQuestions");
            if (!stored) throw new Error("找不到錯題資料");
            questions = JSON.parse(stored);
            catName = CAT_ID + "（錯題複習）";
        } else {
            // 一般模式：從 GAS 取 80 題
            const res = await fetchWithTimeout(
                `${CONFIG.GAS_URL}?action=questions&cat=${encodeURIComponent(CAT_ID)}`
            );
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            questions = data;
            catName = CAT_ID;
        }

        // 隨機排列每題選項
        questions.forEach(q => shuffleOptions(q));

        document.title = `${catName} — 作答中`;
        document.getElementById("exam-title").textContent = catName;

        answers = questions.map(() => ({ chosen: null, hinted: false }));

        document.getElementById("q-total").textContent = questions.length;
        document.getElementById("loading").remove();

        renderQuestion();
        updateHeader();
        startTimer();
        document.addEventListener("keydown", handleKey);
    } catch (e) {
        document.getElementById("loading").innerHTML =
            `<p style="color:red;padding:40px 0">載入題庫失敗：${e.message}<br>請確認網路連線正常或稍後再試。</p>
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

// ===== 渲染題目 =====
function renderQuestion() {
    const q = questions[current];
    const ans = answers[current];
    const isAnswered = ans.chosen !== null || ans.hinted;

    const noScoreBadge = ans.hinted
        ? `<div class="no-score-badge">💡 此題不列入計分</div>` : "";

    const area = document.getElementById("main-area");
    area.innerHTML = `
    <div class="question-wrap">
      <div class="question-card">
        ${noScoreBadge}
        <div class="q-number">第 ${current + 1} 題 / 共 ${questions.length} 題</div>
        <div class="q-text">${q.q}</div>
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
                <span>${opt}</span>
              </button>`;
    }).join("")}
        </div>
        <div class="answer-hint ${isAnswered ? "show " + (ans.hinted && ans.chosen === null ? "hint-only" : ans.chosen === q.answer ? "correct" : "wrong") : ""}"
          id="answer-hint">
          ${isAnswered
            ? ans.hinted && ans.chosen === null
                ? `💡 正確答案為：${LABELS[q.answer]}. ${q.options[q.answer]}（已查看答案，此題不列入計分）`
                : ans.chosen === q.answer
                    ? "✅ 答對了！"
                    : `❌ 答錯了，正確答案為：${LABELS[q.answer]}. ${q.options[q.answer]}`
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
}

function showHint() {
    const ans = answers[current];
    if (ans.chosen !== null) return;
    ans.hinted = true;
    renderQuestion();
    updateHeader();
}

function prevQ() { if (current > 0) { current--; renderQuestion(); updateHeader(); } }

function nextQ() {
    if (current < questions.length - 1) { current++; renderQuestion(); updateHeader(); }
    else finishExam();
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
    const elapsed = (CONFIG.EXAM_TIME_LIMIT * 60) - timerSeconds;

    const resultData = { catId: CAT_ID, catName, questions, answers, elapsed };
    sessionStorage.setItem("examResult", JSON.stringify(resultData));

    // 回報統計到 GAS（fire-and-forget）
    try {
        const realCorrect = answers.filter((a, i) => !a.hinted && a.chosen === questions[i].answer).length;
        const score = Math.round(realCorrect * CONFIG.SCORE_PER_Q * 100) / 100;
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
                timestamp: new Date().toISOString(),
            }),
        }).catch(() => { }); // 忽略錯誤
    } catch { }

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
    const btn = document.querySelector('#feedback-modal .btn-primary');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "送出中…";

    const type = document.getElementById("fb-type").value;
    const desc = document.getElementById("fb-desc").value.trim();
    const q = questions[feedbackQIndex];

    try {
        await fetchWithTimeout(CONFIG.GAS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "feedback",
                timestamp: new Date().toISOString(),
                catName,
                questionId: q.id,
                question: q.q,
                feedbackType: type,
                description: desc,
            }),
        });
        showToast("✅ 反饋已送出，感謝你！");
    } catch {
        showToast("⚠️ 反饋送出失敗，請稍後再試。");
    }

    btn.disabled = false;
    btn.textContent = "送出";
    closeFeedback();
    document.getElementById("fb-desc").value = "";
}

// ===== 啟動 =====
init();
