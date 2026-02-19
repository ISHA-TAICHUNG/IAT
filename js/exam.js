// ===== 狀態 =====
const params = new URLSearchParams(location.search);
const CAT_ID = params.get("cat");

let questions = [];    // 本次抽到的 80 題
let catName = "";
let current = 0;       // 目前題號 (0-based)
let answers = [];      // answers[i] = { chosen: number|null, hinted: bool }

// ===== 工具 =====
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

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
        const res = await fetch(`data/${encodeURIComponent(CAT_ID)}.json`);
        const data = await res.json();
        catName = data.name;
        document.title = `${catName} — 作答中`;
        document.getElementById("exam-title").textContent = catName;

        // 隨機抽 80 題
        const pool = shuffle([...data.questions]);
        questions = pool.slice(0, Math.min(CONFIG.EXAM_QUESTIONS, pool.length));

        // 初始化答案
        answers = questions.map(() => ({ chosen: null, hinted: false }));

        document.getElementById("q-total").textContent = questions.length;
        document.getElementById("loading").remove();

        renderQuestion();
        updateHeader();

        // 提前結束按鈕
        document.getElementById("btn-end").addEventListener("click", () => {
            if (confirm("確定要提前結束作答並查看成績？")) finishExam();
        });

        // 鍵盤快捷鍵
        document.addEventListener("keydown", handleKey);

        // 儲存到 sessionStorage 以防重整
        sessionStorage.setItem("examCatId", CAT_ID);
    } catch (e) {
        document.getElementById("loading").innerHTML =
            `<p style="color:red">載入 ${CAT_ID} 題庫失敗：${e.message}</p>`;
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
          ${q.options
            .map((opt, i) => {
                let cls = "";
                if (isAnswered) {
                    if (i === q.answer) {
                        cls = ans.hinted && ans.chosen === null ? "hint" : "correct";
                    } else if (i === ans.chosen && ans.chosen !== q.answer) {
                        cls = "wrong";
                    }
                } else if (i === ans.chosen) {
                    cls = "selected";
                }
                return `
                <button class="option-btn ${cls}"
                  id="opt-${i}"
                  onclick="selectOption(${i})"
                  ${isAnswered ? "disabled" : ""}>
                  <span class="option-label">${LABELS[i]}</span>
                  <span>${opt}</span>
                </button>`;
            })
            .join("")}
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
            ? `<button class="btn btn-primary" onclick="nextQ()" ${current === questions.length - 1 ? "" : ""}>
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
    if (ans.chosen !== null || ans.hinted) return; // 已回答
    ans.chosen = idx;
    renderQuestion();
    updateHeader();
}

// ===== 查看答案 =====
function showHint() {
    const ans = answers[current];
    if (ans.chosen !== null) return;
    ans.hinted = true;
    renderQuestion();
    updateHeader();
}

// ===== 導航 =====
function prevQ() {
    if (current > 0) { current--; renderQuestion(); updateHeader(); }
}

function nextQ() {
    if (current < questions.length - 1) {
        current++;
        renderQuestion();
        updateHeader();
    } else {
        // 最後一題
        finishExam();
    }
}

function handleKey(e) {
    if (document.getElementById("feedback-modal")?.classList.contains("open")) return;
    const key = e.key;
    if (["1", "2", "3", "4"].includes(key)) selectOption(Number(key) - 1);
    if (key === "ArrowRight" || key === "Enter") {
        if (answers[current].chosen !== null || answers[current].hinted) nextQ();
    }
    if (key === "ArrowLeft") prevQ();
}

// ===== 更新 header =====
function updateHeader() {
    document.getElementById("q-current").textContent = current + 1;
    const answered = answers.filter((a) => a.chosen !== null || a.hinted).length;
    document.getElementById("answered-count").textContent = answered;
    const pct = ((current + 1) / questions.length) * 100;
    document.getElementById("progress-bar").style.width = pct + "%";
}

// ===== 完成測驗 =====
function finishExam() {
    // 將結果存 sessionStorage，跳轉結果頁
    const resultData = {
        catId: CAT_ID,
        catName,
        questions: questions.map((q) => ({
            id: q.id,
            q: q.q,
            options: q.options,
            answer: q.answer,
        })),
        answers,
    };
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
