// ===== 成績頁 =====
const raw = sessionStorage.getItem("examResult");
if (!raw) { location.replace("index.html"); throw new Error("no data"); }

const data = JSON.parse(raw);
const { catId, catName, questions, answers, elapsed } = data;

// ===== 計分 =====
let correct = 0, wrong = 0, hinted = 0, skipped = 0;
const wrongList = [];

questions.forEach((q, i) => {
  const ans = answers[i];
  if (ans.hinted) {
    hinted++;
    wrongList.push({ q, ans, idx: i + 1, status: "hinted" });
  } else if (ans.chosen === null) {
    skipped++;
    wrongList.push({ q, ans, idx: i + 1, status: "skipped" });
  } else if (ans.chosen === q.answer) {
    correct++;
  } else {
    wrong++;
    wrongList.push({ q, ans, idx: i + 1, status: "wrong" });
  }
});

const realCorrect = answers.filter((a, i) => !a.hinted && a.chosen === questions[i].answer).length;
const score = Math.round(realCorrect * CONFIG.SCORE_PER_Q * 100) / 100;
const pass = score >= CONFIG.PASS_SCORE;

// ===== 儲存歷史成績 =====
saveExamHistory({
  catId,
  catName,
  score,
  correct: realCorrect,
  total: questions.length,
  wrong: wrong + hinted + skipped,
  elapsed: elapsed || 0,
  date: new Date().toISOString(),
});

// ===== 用時顯示 =====
const timeStr = elapsed ? formatTime(elapsed) : "";

// ===== 歷史成績 =====
const history = getExamHistory();
const historyHTML = history.length > 1 ? `
  <div class="history-card">
    <h2>📊 最近成績紀錄</h2>
    <div class="history-list">
      ${history.map((h, idx) => `
        <div class="history-item ${idx === 0 ? 'latest' : ''}">
          <div class="hi-cat">${h.catName}${idx === 0 ? ' <span class="hi-badge">本次</span>' : ''}</div>
          <div class="hi-score ${h.score >= CONFIG.PASS_SCORE ? 'pass' : 'fail'}">${h.score} 分</div>
          <div class="hi-detail">答對 ${h.correct}/${h.total}　${h.elapsed ? formatTime(h.elapsed) : ''}</div>
          <div class="hi-date">${new Date(h.date).toLocaleDateString("zh-TW")}</div>
        </div>`).join("")}
    </div>
  </div>` : "";

// ===== 渲染 =====
document.getElementById("result-area").innerHTML = `
  <div class="result-card">
    <div class="score-circle ${pass ? "pass" : "fail"}">
      <span class="score-num">${score}</span>
      <span class="score-label">/ ${CONFIG.FULL_SCORE} 分</span>
    </div>
    <div class="pass-badge ${pass ? "pass" : "fail"}">${pass ? "🎉 及格" : "😓 未及格"}</div>
    <h2 style="margin-bottom:8px;font-size:1rem;">${catName}</h2>
    <div class="stats-row">
      <span>答對：<strong>${realCorrect}</strong> 題</span>
      <span>答錯：<strong>${wrong}</strong> 題</span>
      <span>看答案：<strong>${hinted}</strong> 題</span>
      <span>未答：<strong>${skipped}</strong> 題</span>
      ${timeStr ? `<span>用時：<strong>${timeStr}</strong></span>` : ""}
    </div>
    <p style="font-size:.82rem;color:var(--gray-500);margin-bottom:20px;">
      ※ 查看答案的題目不列入計分。60 分（答對 48 題）及格。
    </p>
    <div class="result-actions">
      <a href="index.html" class="btn btn-outline">← 選擇其他職類</a>
      <a href="exam.html?cat=${encodeURIComponent(catId)}" class="btn btn-primary">🔄 重新練習</a>
      ${wrongList.length > 0 ? `<button class="btn btn-review" onclick="startReview()">📝 只練錯題 (${wrongList.length}題)</button>` : ""}
    </div>
  </div>

  ${wrongList.length > 0 ? `
  <div class="wrong-list">
    <h2>錯題 / 未答 / 看答案 共 ${wrongList.length} 題</h2>
    ${wrongList.map(item => `
      <div class="wrong-item">
        <div class="wi-num">
          第 ${item.idx} 題
          ${item.status === "hinted" ? '<span class="wi-hinted">（已查看答案）</span>' : ""}
          ${item.status === "skipped" ? '<span class="wi-hinted">（未作答）</span>' : ""}
          ${item.status === "wrong" ? '<span class="wi-your">（答錯）</span>' : ""}
        </div>
        <div class="wi-q">${item.q.q}</div>
        <div class="wi-meta">
          ${item.ans.chosen !== null && item.ans.chosen !== item.q.answer
    ? `<span class="wi-your">你的答案：${item.q.options[item.ans.chosen]}</span>`
    : ""}
          <span class="wi-correct">正確答案：${item.q.options[item.q.answer]}</span>
        </div>
        <button class="btn btn-feedback" onclick="openResultFeedback(${item.idx - 1})">💬 反饋</button>
      </div>`).join("")}
  </div>` : `<p style="text-align:center;color:var(--success);font-weight:700;font-size:1.1rem;margin:24px;">🌟 全部答對！</p>`}

  ${historyHTML}
`;

// ===== 錯題複習 =====
function startReview() {
  // 將錯題存入 sessionStorage，跳轉 exam.html
  const reviewQs = wrongList.map(item => item.q);
  sessionStorage.setItem("reviewQuestions", JSON.stringify(reviewQs));
  location.href = `exam.html?cat=${encodeURIComponent(catId)}&mode=review`;
}

// ===== 反饋功能 =====
let resultFbQIndex = null;

function openResultFeedback(qIdx) {
  resultFbQIndex = qIdx;
  document.getElementById("result-fb-modal").classList.add("open");
}
function closeResultFeedback() {
  document.getElementById("result-fb-modal").classList.remove("open");
}

async function submitResultFeedback() {
  const btn = document.querySelector('#result-fb-modal .btn-primary');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "送出中…";

  const type = document.getElementById("result-fb-type").value;
  const desc = document.getElementById("result-fb-desc").value.trim();
  const q = questions[resultFbQIndex];

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
  closeResultFeedback();
  document.getElementById("result-fb-desc").value = "";
}

// Esc 關閉 Modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("result-fb-modal")?.classList.contains("open")) {
    closeResultFeedback();
  }
});
