// ===== 成績頁 =====
const raw = sessionStorage.getItem("examResult");
if (!raw) { location.replace("index.html"); throw new Error("no data"); }

const data = JSON.parse(raw);
const { catName, questions, answers } = data;

// ===== 計分 =====
let correct = 0, wrong = 0, hinted = 0, skipped = 0;
const wrongList = [];

questions.forEach((q, i) => {
  const ans = answers[i];
  if (ans.hinted) {
    // 曾查看答案 → 不計分（不管後來有沒有選對）
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

// 實際計分：未提示且答對
const realCorrect = answers.filter((a, i) => !a.hinted && a.chosen === questions[i].answer).length;
const score = Math.round(realCorrect * CONFIG.SCORE_PER_Q * 100) / 100;
const pass = score >= CONFIG.PASS_SCORE;

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
    </div>
    <p style="font-size:.82rem;color:var(--gray-500);margin-bottom:20px;">
      ※ 查看答案的題目不列入計分。60 分（答對 48 題）及格。
    </p>
    <div class="result-actions">
      <a href="index.html" class="btn btn-outline">← 選擇其他職類</a>
      <a href="exam.html?cat=${encodeURIComponent(data.catId)}" class="btn btn-primary">🔄 重新練習</a>
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
`;

// ===== 反饋功能 =====
let resultFbQIndex = null;

function showToast(msg, dur = 2200) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), dur);
}

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
