// ===== 外籍移工國籍翻譯對照 =====
const LANG_LABELS = {
  印尼: { native: "Bahasa Indonesia", flag: "🇮🇩" },
  菲律賓: { native: "Filipino", flag: "🇵🇭" },
  泰國: { native: "ภาษาไทย", flag: "🇹🇭" },
  越南: { native: "Tiếng Việt", flag: "🇻🇳" },
};

// 從職類名稱判斷是否外籍移工並取得翻譯
function getForeignLabel(catName) {
  for (const [zh, info] of Object.entries(LANG_LABELS)) {
    if (catName.includes(zh)) return info;
  }
  return null;
}

// ===== API =====
async function loadCategories() {
  const res = await fetch(`${CONFIG.GAS_URL}?action=categories`);
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
              const label = fl
                ? `${cat.name}　${fl.flag} ${fl.native}`
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
  // 記憶已看過（sessionStorage 每次開瀏覽器都要看一次）
  sessionStorage.setItem("notice_seen", "1");
}

// 若本次已看過則略過
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
      <p class="error-msg">載入題庫失敗：${err.message}<br>請確認 GAS_URL 已設定。</p>`;
  });
