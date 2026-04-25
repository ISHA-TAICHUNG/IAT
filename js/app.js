// ===== 即測即評國籍翻譯對照 =====
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
  { keyword: "移動式起重機", emoji: "🏗️" },
  { keyword: "一壓", emoji: "⚙️" },
];

function getJobEmoji(catName) {
  var match = JOB_EMOJI.find(function(j) { return catName.includes(j.keyword); });
  return match ? match.emoji + " " : "";
}

function getForeignLabel(catName) {
  for (var zh in LANG_LABELS) {
    if (catName.includes(zh)) return LANG_LABELS[zh];
  }
  return null;
}

// ===== API =====
var _allCategories = []; // 快取全部職類

async function loadCategories() {
  var res = await fetchWithTimeout(CONFIG.GAS_URL + "?action=categories");
  if (!res.ok) throw new Error("HTTP " + res.status);
  var data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data)) throw new Error("Invalid format");
  _allCategories = data;
  return filterCategoriesByLang(data);
}

// 根據語言過濾職類
function filterCategoriesByLang(cats) {
  var suffix = getLangCatSuffix();
  if (!suffix) return cats; // 中文顯示全部
  return cats.filter(function(c) {
    return c.id.indexOf(suffix) >= 0;
  });
}

// ===== 下拉選單渲染 =====
function renderDropdown(cats) {
  var wrap = document.getElementById("select-wrap");
  var lang = getLang();

  // 外語模式：不分群組，直接列出
  if (lang !== 'zh-TW') {
    wrap.textContent = '';

    var label = document.createElement('label');
    label.className = 'select-label';
    label.setAttribute('for', 'cat-select');
    label.textContent = t('select.category');
    wrap.appendChild(label);

    var selectWrap = document.createElement('div');
    selectWrap.className = 'custom-select-wrap';

    var select = document.createElement('select');
    select.id = 'cat-select';
    select.onchange = function() { onCatChange(this.value); };

    var defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = t('select.placeholder');
    select.appendChild(defOpt);

    cats.forEach(function(cat) {
      var opt = document.createElement('option');
      opt.value = cat.id;
      opt.dataset.total = cat.total;
      opt.textContent = getJobEmoji(cat.id) + translateCatName(cat.id, cat.name);
      select.appendChild(opt);
    });

    selectWrap.appendChild(select);
    selectWrap.insertAdjacentHTML('beforeend', '<svg class="select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>');
    wrap.appendChild(selectWrap);

    var infoDiv = document.createElement('div');
    infoDiv.id = 'cat-info';
    infoDiv.className = 'cat-info';
    infoDiv.style.display = 'none';
    wrap.appendChild(infoDiv);

    // 模式選擇
    var modeDiv = document.createElement('div');
    modeDiv.className = 'mode-select';
    modeDiv.id = 'mode-select';
    var modeLabel = document.createElement('label');
    modeLabel.className = 'select-label';
    modeLabel.textContent = t('select.mode');
    modeDiv.appendChild(modeLabel);

    var modeOpts = document.createElement('div');
    modeOpts.className = 'mode-options';
    Object.entries(CONFIG.MODES).forEach(function(entry) {
      var key = entry[0], m = entry[1];
      var mLabel = document.createElement('label');
      mLabel.className = 'mode-radio' + (key === CONFIG.DEFAULT_MODE ? ' active' : '');

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'exam-mode';
      input.value = key;
      if (key === CONFIG.DEFAULT_MODE) input.checked = true;
      input.onchange = function() { onModeChange(key); };
      mLabel.appendChild(input);

      var icon = document.createElement('span');
      icon.className = 'mode-icon';
      icon.textContent = m.icon;
      mLabel.appendChild(icon);

      var lbl = document.createElement('span');
      lbl.className = 'mode-label';
      lbl.textContent = t('mode.' + key);
      mLabel.appendChild(lbl);

      var desc = document.createElement('span');
      desc.className = 'mode-desc';
      desc.textContent = m.questions + ' ' + t('mode.questions') + ' / ' + m.time + ' ' + t('mode.minutes');
      mLabel.appendChild(desc);

      modeOpts.appendChild(mLabel);
    });
    modeDiv.appendChild(modeOpts);
    wrap.appendChild(modeDiv);

  } else {
    // 中文模式：分群組
    var groupOrder = ["業務主管", "作業主管", "職護", "全國技術士", "即測即評"];
    var groups = cats.reduce(function(acc, c) {
      (acc[c.group] = acc[c.group] || []).push(c);
      return acc;
    }, {});

    wrap.textContent = '';
    var label2 = document.createElement('label');
    label2.className = 'select-label';
    label2.setAttribute('for', 'cat-select');
    label2.textContent = t('select.category');
    wrap.appendChild(label2);

    var selectWrap2 = document.createElement('div');
    selectWrap2.className = 'custom-select-wrap';

    var select2 = document.createElement('select');
    select2.id = 'cat-select';
    select2.onchange = function() { onCatChange(this.value); };

    var defOpt2 = document.createElement('option');
    defOpt2.value = '';
    defOpt2.textContent = t('select.placeholder');
    select2.appendChild(defOpt2);

    groupOrder.filter(function(g) { return groups[g]; }).forEach(function(g) {
      var optgroup = document.createElement('optgroup');
      optgroup.label = t('group.' + g, g);
      groups[g].forEach(function(cat) {
        var fl = getForeignLabel(cat.name);
        var jobEmoji = fl ? getJobEmoji(cat.name) : "";
        var labelText = fl ? jobEmoji + cat.name + "　" + fl.flag + " " + fl.native : cat.name;
        var opt = document.createElement('option');
        opt.value = cat.id;
        opt.dataset.total = cat.total;
        opt.textContent = labelText;
        optgroup.appendChild(opt);
      });
      select2.appendChild(optgroup);
    });

    selectWrap2.appendChild(select2);
    selectWrap2.insertAdjacentHTML('beforeend', '<svg class="select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>');
    wrap.appendChild(selectWrap2);

    var infoDiv2 = document.createElement('div');
    infoDiv2.id = 'cat-info';
    infoDiv2.className = 'cat-info';
    infoDiv2.style.display = 'none';
    wrap.appendChild(infoDiv2);

    // 模式選擇
    var modeHtml = '<div class="mode-select" id="mode-select"><label class="select-label">' + t('select.mode') + '</label><div class="mode-options">';
    Object.entries(CONFIG.MODES).forEach(function(entry) {
      var key = entry[0], m = entry[1];
      modeHtml += '<label class="mode-radio' + (key === CONFIG.DEFAULT_MODE ? ' active' : '') + '">';
      modeHtml += '<input type="radio" name="exam-mode" value="' + key + '"' + (key === CONFIG.DEFAULT_MODE ? ' checked' : '') + ' onchange="onModeChange(\'' + key + '\')">';
      modeHtml += '<span class="mode-icon">' + m.icon + '</span>';
      modeHtml += '<span class="mode-label">' + t('mode.' + key) + '</span>';
      modeHtml += '<span class="mode-desc">' + m.questions + ' ' + t('mode.questions') + ' / ' + m.time + ' ' + t('mode.minutes') + '</span>';
      modeHtml += '</label>';
    });
    modeHtml += '</div></div>';
    wrap.insertAdjacentHTML('beforeend', modeHtml);
  }

  document.getElementById("btn-start").disabled = true;
  renderHomeHistory();
  renderResumeBanner();
}

function onCatChange(id) {
  var btn = document.getElementById("btn-start");
  var info = document.getElementById("cat-info");
  if (!id) {
    btn.disabled = true;
    info.style.display = "none";
    return;
  }
  var opt = document.querySelector('#cat-select option[value="' + CSS.escape(id) + '"]');
  var total = opt ? opt.dataset.total : "?";
  info.style.display = "flex";
  info.textContent = t('cat.total.prefix') + ' ' + total + ' ' + t('cat.total.suffix');
  btn.disabled = false;
}

var selectedMode = CONFIG.DEFAULT_MODE;

function onModeChange(mode) {
  selectedMode = mode;
  document.querySelectorAll(".mode-radio").forEach(function(el) {
    el.classList.toggle("active", el.querySelector("input").value === mode);
  });
}

// ===== 存檔恢復提示 =====
function renderResumeBanner() {
  var saved = loadProgress();
  var banner = document.getElementById("resume-banner");
  if (!saved) {
    if (banner) banner.remove();
    return;
  }

  var modeInfo = CONFIG.MODES[saved.examMode] || CONFIG.MODES.normal;
  var answered = saved.answers.filter(function(a) { return a.chosen !== null || a.hinted; }).length;
  var timeAgo = new Date(saved.savedAt).toLocaleString(getLang() === 'zh-TW' ? 'zh-TW' : undefined);

  var el = banner || document.createElement("div");
  el.id = "resume-banner";
  el.className = "resume-banner";
  el.textContent = '';

  var infoDiv = document.createElement('div');
  infoDiv.className = 'resume-info';
  var strong = document.createElement('strong');
  strong.textContent = t('resume.title');
  infoDiv.appendChild(strong);
  var span1 = document.createElement('span');
  span1.textContent = saved.catName + ' — ' + t('mode.' + saved.examMode) + ', ' + t('exam.answered') + ' ' + answered + '/' + saved.questions.length + ' ' + t('mode.questions');
  infoDiv.appendChild(span1);
  el.appendChild(infoDiv);

  var actDiv = document.createElement('div');
  actDiv.className = 'resume-actions';
  var btnResume = document.createElement('button');
  btnResume.className = 'btn btn-primary btn-sm';
  btnResume.onclick = resumeExam;
  btnResume.textContent = t('resume.btn');
  actDiv.appendChild(btnResume);
  var btnDiscard = document.createElement('button');
  btnDiscard.className = 'btn btn-outline btn-sm';
  btnDiscard.onclick = discardSave;
  btnDiscard.textContent = t('resume.discard');
  actDiv.appendChild(btnDiscard);
  el.appendChild(actDiv);

  if (!banner) {
    var card = document.querySelector(".selector-card");
    card.parentNode.insertBefore(el, card);
  }
}

function resumeExam() {
  var saved = loadProgress();
  if (!saved) return;
  location.href = 'exam.html?cat=' + encodeURIComponent(saved.catId) + '&examMode=' + saved.examMode;
}

function discardSave() {
  clearProgress();
  var el = document.getElementById("resume-banner");
  if (el) el.remove();
  showToast(t('resume.discarded'));
}

// ===== 首頁歷史成績 =====
function renderHomeHistory() {
  var section = document.getElementById("history-section");
  if (!section) return;
  var history = getExamHistory();
  if (history.length === 0) { section.textContent = ""; return; }

  section.textContent = '';
  var card = document.createElement('div');
  card.className = 'history-card home-history';
  var h2 = document.createElement('h2');
  h2.textContent = t('history.title');
  card.appendChild(h2);

  var list = document.createElement('div');
  list.className = 'history-list';
  history.slice(0, 5).forEach(function(h) {
    var item = document.createElement('div');
    item.className = 'history-item';

    var catDiv = document.createElement('div');
    catDiv.className = 'hi-cat';
    catDiv.textContent = h.catName;
    item.appendChild(catDiv);

    var scoreDiv = document.createElement('div');
    scoreDiv.className = 'hi-score ' + (h.score >= getPassScore(h.catId) ? 'pass' : 'fail');
    scoreDiv.textContent = h.score + ' ' + t('result.score.unit');
    item.appendChild(scoreDiv);

    var detailDiv = document.createElement('div');
    detailDiv.className = 'hi-detail';
    detailDiv.textContent = t('result.correct') + ' ' + h.correct + '/' + h.total;
    item.appendChild(detailDiv);

    var dateDiv = document.createElement('div');
    dateDiv.className = 'hi-date';
    dateDiv.textContent = new Date(h.date).toLocaleDateString(getLang() === 'zh-TW' ? 'zh-TW' : undefined);
    item.appendChild(dateDiv);

    list.appendChild(item);
  });
  card.appendChild(list);
  section.appendChild(card);
}

// ===== 測驗前須知 =====
var _pendingCatId = null;

function requestStartExam() {
  var sel = document.getElementById("cat-select");
  if (!sel || !sel.value) return;
  _pendingCatId = sel.value;
  document.getElementById("preexam-modal").classList.add("open");
}

function confirmStartExam() {
  if (!_pendingCatId) return;
  var saved = loadProgress();
  if (saved && (saved.catId !== _pendingCatId || saved.examMode !== selectedMode)) {
    clearProgress();
  }
  window.location.href = 'exam.html?cat=' + encodeURIComponent(_pendingCatId) + '&examMode=' + selectedMode;
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
  document.addEventListener("DOMContentLoaded", function() {
    var m = document.getElementById("notice-modal");
    if (m) m.classList.remove("open");
  });
}

// ===== 語言切換事件 =====
window.addEventListener('langchange', function() {
  // 語言切換時重新渲染
  var filtered = filterCategoriesByLang(_allCategories);
  renderDropdown(filtered);
  applyI18n();
});

// ===== 初始化 =====
if (typeof flushFeedbackQueue === 'function') flushFeedbackQueue();
loadCategories()
  .then(renderDropdown)
  .catch(function(err) {
    // 載入失敗（網路或 GAS 異常）→ 顯示錯誤訊息給使用者
    var wrap = document.getElementById("select-wrap");
    wrap.textContent = '';
    var p = document.createElement('p');
    p.className = 'error-msg';
    p.textContent = t('error.load') + err.message + ' ' + t('error.network');
    wrap.appendChild(p);
  });
