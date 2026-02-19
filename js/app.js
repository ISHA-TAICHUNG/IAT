// ===== 外籍移工國籍翻譯對照 =====
const LANG_LABELS = {
  印尼: { native: "Bahasa Indonesia", flag: "🇮🇩" },
  菲律賓: { native: "Filipino", flag: "🇵🇭" },
  泰國籍: { native: "ภาษาไทย", flag: "🇹🇭" },
  泰籍: { native: "ภาษาไทย", flag: "🇹🇭" },
  越南: { native: "Tiếng Việt", flag: "🇻🇳" },
};

// 職類 emoji
const JOB_EMOJI = [
  { keyword: "堆高機", emoji: "🚜" },
  { keyword: "固定式起重機", emoji: "🏗️" },
];

function getJobEmoji(catName) {
  const match = JOB_EMOJI.find((j) => catName.includes(j.keyword));
  return match ? match.emoji + " " : "";
}

// 從職類名稱判斷是否外籍移工並取得翻譯
function getForeignLabel(catName) {
  for (const [zh, info] of Object.entries(LANG_LABELS)) {
    if (catName.includes(zh)) return info;
  }
  return null;
}

// ===== API =====
async function loadCategories() {
  const res = await fetchWithTimeout(`${CONFIG.GAS_URL}?action=categories`);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// ===== 下拉選單渲染 =====
function renderDropdown(cats) {
  const wrap = document.getElementById("select-wrap");
  const groupOrder = ["業務主管", "作業主管", "醫護", "外籍移工"];
  const groups = cats.reduce((acc, c) => {
    (acc[c.group] = acc[c.group] || []).push(c);
    return acc;
  }, {});

  wrap.innerHTML = `
    <label class="select-label" for="cat-select">選擇職類</label>
    <div class="custom-select-wrap">
      <select id="cat-select" onchange="onCatChange(this.value)">
        <option value="">— 請選擇職類 —</option>
        ${groupOrder
      .filter((g) => groups[g])
      .map(
        (g) => `
          <optgroup label="${g}">
            ${groups[g]
            .map((cat) => {
              const fl = getForeignLabel(cat.name);
              const jobEmoji = fl ? getJobEmoji(cat.name) : "";
              const label = fl
                ? `${jobEmoji}${cat.name}　${fl.flag} ${fl.native}`
                : cat.name;
              return `<option value="${cat.id}" data-total="${cat.total}">${label}</option>`;
            })
            .join("")}
          </optgroup>`
      )
      .join("")}
      </select>
      <svg class="select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
    <div id="cat-info" class="cat-info" style="display:none"></div>
  `;

  document.getElementById("btn-start").disabled = true;

  // 顯示首頁歷史成績
  renderHomeHistory();
}

function onCatChange(id) {
  const btn = document.getElementById("btn-start");
  const info = document.getElementById("cat-info");
  if (!id) {
    btn.disabled = true;
    info.style.display = "none";
    return;
  }
  const opt = document.querySelector(`option[value="${id}"]`);
  const total = opt?.dataset?.total || "?";
  info.style.display = "flex";
  info.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
    題庫共 <strong>${total}</strong> 題，隨機抽選 <strong>80</strong> 題作答
  `;
  btn.disabled = false;
}

// ===== 首頁歷史成績 =====
function renderHomeHistory() {
  const section = document.getElementById("history-section");
  if (!section) return;
  const history = getExamHistory();
  if (history.length === 0) { section.innerHTML = ""; return; }

  section.innerHTML = `
    <div class="history-card home-history">
      <h2>📊 最近練習紀錄</h2>
      <div class="history-list">
        ${history.slice(0, 5).map(h => `
          <div class="history-item">
            <div class="hi-cat">${h.catName}</div>
            <div class="hi-score ${h.score >= CONFIG.PASS_SCORE ? 'pass' : 'fail'}">${h.score} 分</div>
            <div class="hi-detail">答對 ${h.correct}/${h.total}</div>
            <div class="hi-date">${new Date(h.date).toLocaleDateString("zh-TW")}</div>
          </div>`).join("")}
      </div>
    </div>`;
}

// ===== 測驗前須知 =====
let _pendingCatId = null;

function requestStartExam() {
  const sel = document.getElementById("cat-select");
  if (!sel?.value) return;
  _pendingCatId = sel.value;
  document.getElementById("preexam-modal").classList.add("open");
}

function confirmStartExam() {
  if (!_pendingCatId) return;
  window.location.href = `exam.html?cat=${encodeURIComponent(_pendingCatId)}`;
}

function closePreExam() {
  document.getElementById("preexam-modal").classList.remove("open");
  _pendingCatId = null;
}

// ===== 進站須知 =====
function closeNotice() {
  document.getElementById("notice-modal").classList.remove("open");
  sessionStorage.setItem("notice_seen", "1");
}

if (sessionStorage.getItem("notice_seen")) {
  document.addEventListener("DOMContentLoaded", () => {
    const m = document.getElementById("notice-modal");
    if (m) m.classList.remove("open");
  });
}

// ===== 初始化 =====
loadCategories()
  .then(renderDropdown)
  .catch((err) => {
    document.getElementById("select-wrap").innerHTML = `
      <p class="error-msg">載入題庫失敗：${err.message}<br>請確認網路連線正常或稍後再試。</p>`;
  });

