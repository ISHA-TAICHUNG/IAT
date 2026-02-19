// ===== 狀態 =====
const params = new URLSearchParams(location.search);
const CAT_ID = params.get("cat");

let questions = [];    // 本次抽到的 80 題（由 GAS 隨機抽好）
let catName = "";
let current = 0;
let answers = [];      // answers[i] = { chosen: number|null, hinted: bool }

// ===== 工具 =====
function showToast(msg, dur = 2200) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), dur);
}

const LABELS = ["A", "B", "C", "D"];

// ===== 初始化 =====
async function init() {
    if (!CAT_ID) { location.href = "index.html"; return; }

    try {
        // 從 GAS 取 80 題（已隨機抽好，帶答案）
        const res = await fetch(
            `${CONFIG.GAS_URL}?action=questions&cat=${encodeURIComponent(CAT_ID)}`
        );
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        questions = data;
        // 從 categories 取名稱（先用 catId，之後有值再抓）
        catName = CAT_ID;
        // 嘗試從返回資料的第一題推職類名（GAS 可擴充，這裡用 catId 即可）

        document.title = `${CAT_ID} — 作答中`;
        document.getElementById("exam-title").textContent = CAT_ID;

        answers = questions.map(() => ({ chosen: null, hinted: false }));

        document.getElementById("q-total").textContent = questions.length;
        document.getElementById("loading").remove();

        renderQuestion();
        updateHeader();
        document.addEventListener("keydown", handleKey);
    } catch (e) {
        document.getElementById("loading").innerHTML =
            `<p style="color:red;padding:40px 0">載入題庫失敗：${e.message}<br>請確認 GAS_URL 已設定。</p>`;
    }
}

// ===== 渲染題目 =====
function renderQuestion() {
    const q = questions[current];
    const ans = answers[current];
    const isAnswered = ans.chosen !== null || ans.hinted;

    const area = document.getElementById("main-area");
    area.innerHTML = `
    <div class="question-wrap">
      <div class="question-card">
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
    if (document.getElementById("feedback-modal")?.classList.contains("open")) return;
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

// 提前結束（用自訂 Modal，不用 confirm 以免被瀏覽器跳過）
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
    const resultData = { catId: CAT_ID, catName, questions, answers };
    sessionStorage.setItem("examResult", JSON.stringify(resultData));
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
    const type = document.getElementById("fb-type").value;
    const desc = document.getElementById("fb-desc").value.trim();
    const q = questions[feedbackQIndex];

    const payload = {
        action: "feedback",
        timestamp: new Date().toISOString(),
        catName,
        questionId: q.id,
        question: q.q,
        feedbackType: type,
        description: desc,
    };

    try {
        await fetch(CONFIG.GAS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        showToast("✅ 反饋已送出，感謝你！");
    } catch {
        showToast("⚠️ 反饋送出失敗，請稍後再試。");
    }

    closeFeedback();
    document.getElementById("fb-desc").value = "";
}

// ===== 啟動 =====
init();
