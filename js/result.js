// ===== 成績頁 =====
const raw = sessionStorage.getItem("examResult");
if (!raw) { location.href = "index.html"; }

const data = JSON.parse(raw);
const { catName, questions, answers } = data;

// ===== 計分 =====
let correct = 0, wrong = 0, hinted = 0, skipped = 0;
const wrongList = [];

questions.forEach((q, i) => {
    const ans = answers[i];
    if (ans.hinted && ans.chosen === null) {
        // 只查看答案，未作答 → 不計分
        hinted++;
        wrongList.push({ q, ans, idx: i + 1, status: "hinted" });
    } else if (ans.chosen === null) {
        skipped++;
        wrongList.push({ q, ans, idx: i + 1, status: "skipped" });
    } else if (ans.chosen === q.answer) {
        correct++;
        // 查看答案後選對 → 也不計分（已提示）
        if (ans.hinted) hinted++;
    } else {
        wrong++;
        wrongList.push({ q, ans, idx: i + 1, status: "wrong" });
    }
});

// 僅統計未提示的答對題
const scoredCorrect = correct - (answers.filter(a => a.hinted && a.chosen === a.answer).length);
// 實際計分：未提示且答對
const realCorrect = answers.filter((a, i) => !a.hinted && a.chosen === questions[i].answer).length;
const score = Math.round(realCorrect * CONFIG.SCORE_PER_Q * 100) / 100;
const pass = score >= CONFIG.PASS_SCORE;

const LABELS = ["A", "B", "C", "D"];

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
        ? `<span class="wi-your">你的答案：${LABELS[item.ans.chosen]}. ${item.q.options[item.ans.chosen]}</span>`
        : ""}
          <span class="wi-correct">正確答案：${LABELS[item.q.answer]}. ${item.q.options[item.q.answer]}</span>
        </div>
      </div>`).join("")}
  </div>` : `<p style="text-align:center;color:var(--success);font-weight:700;font-size:1.1rem;margin:24px;">🌟 全部答對！</p>`}
`;
