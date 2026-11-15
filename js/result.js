// ===== 成績頁 =====
var raw = sessionStorage.getItem("examResult");
if (!raw) { location.replace("index.html"); throw new Error("no data"); }

var data;
try { data = JSON.parse(raw); } catch(e) { location.replace("index.html"); throw new Error("data corrupted"); }
var catId = data.catId, catName = data.catName, questions = data.questions, answers = data.answers, elapsed = data.elapsed, examMode = data.examMode;
var modeConf = CONFIG.MODES[examMode] || CONFIG.MODES.normal;

// ===== 複選題輔助 =====
// 以下函式現已抽到 utils.js（ansArrayOf / correctArrayOf / arraysEqual /
// isAnswerCorrect / formatChoices）。本檔保留別名相容舊呼叫。
var ansArr = ansArrayOf;
var corrArr = correctArrayOf;
var isCorr = function(q, chosen) {
  // 多了「空陣列視為未答」的判斷（result.js 特殊邏輯）
  if (Array.isArray(chosen) && chosen.length === 0) return false;
  return isAnswerCorrect(q, chosen);
};
function formatAns(q, chosen) { return formatChoices(q, ansArrayOf(chosen)); }
function formatCorrect(q) { return formatChoices(q, correctArrayOf(q)); }

// ===== 計分 =====
function hasExplanation(q) {
  return typeof q.explanation === 'string' && q.explanation.trim() !== '';
}

// 法規依據：每條連到全國法規資料庫該條文；網址不是 law.moj.gov.tw 就只顯示文字，不做連結
var LAW_URL_PREFIX = 'https://law.moj.gov.tw/';
// 「第6條」→6、「第3-1條」「第3條之1」→3.001；抓不到條號的排最後
function articleKey(article) {
  var m = article.match(/(\d+)\s*條?(?:\s*(?:-|之)\s*(\d+))?/);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 1000 : 0) : Infinity;
}
function articleText(r) {
  if (typeof r.article === 'number' && isFinite(r.article)) return '第' + r.article + '條';
  return typeof r.article === 'string' ? r.article.trim() : '';
}
function buildLegalBasis(list) {
  if (!Array.isArray(list)) return null;
  var seen = {};
  // 濾掉壞資料，同一法規同一條只留一筆
  var refs = list.filter(function(r) {
    if (!r || typeof r.law !== 'string' || !r.law.trim()) return false;
    var key = r.law.trim() + '\u0000' + articleText(r);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
  if (refs.length === 0) return null;
  var row = document.createElement('div');
  row.className = 'wi-law';
  var label = document.createElement('span');
  label.className = 'wi-law-label';
  label.textContent = t('result.legalBasis');
  row.appendChild(label);
  // 同一部法規的多條合成一行（法規名只寫一次），縮短版面
  var groups = [], byLaw = {};
  refs.forEach(function(r) {
    var name = r.law.trim();
    if (!byLaw[name]) { byLaw[name] = { law: name, refs: [] }; groups.push(byLaw[name]); }
    byLaw[name].refs.push(r);
  });
  groups.forEach(function(g) {
    g.refs.sort(function(a, b) { return articleKey(articleText(a)) - articleKey(articleText(b)); });
    var line = document.createElement('div');
    line.className = 'wi-law-group';
    line.appendChild(document.createTextNode(g.law + ' '));
    g.refs.forEach(function(r, i) {
      if (i > 0) line.appendChild(document.createTextNode('、'));
      var text = articleText(r) || t('result.legalBasis.law');
      var el;
      if (typeof r.url === 'string' && r.url.indexOf(LAW_URL_PREFIX) === 0) {
        el = document.createElement('a');
        el.href = r.url;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
        el.textContent = text + '↗';
      } else {
        el = document.createElement('span');
        el.textContent = text;
      }
      el.className = 'wi-law-ref';
      line.appendChild(el);
    });
    row.appendChild(line);
  });
  return row;
}

// 解析區塊（📘 解析＋📜 法規依據）；沒有解析文字回傳 null
function buildExplanationBlock(q) {
  if (!hasExplanation(q)) return null;
  var exDiv = document.createElement('div');
  exDiv.className = 'wi-explanation';
  var exTitle = document.createElement('div');
  exTitle.className = 'wi-explanation-title';
  exTitle.textContent = t('result.explanation');
  var exBody = document.createElement('div');
  exBody.className = 'wi-explanation-body';
  exBody.textContent = q.explanation;
  exDiv.appendChild(exTitle);
  exDiv.appendChild(exBody);
  var lawRow = buildLegalBasis(q.legalBasis);
  if (lawRow) exDiv.appendChild(lawRow);
  return exDiv;
}

// 題目指紋：SHA-256(JSON.stringify([題幹, 選項, 答案])) 前 16 碼 hex。
// 必須和 tools/ai_explain 的 site_fp 一致；題目或答案被改後指紋對不上，解析自動隱藏。
function questionFingerprint(q) {
  var bytes = new TextEncoder().encode(JSON.stringify([q.q, q.options, q.answer]));
  return crypto.subtle.digest('SHA-256', bytes).then(function(buf) {
    return Array.from(new Uint8Array(buf)).slice(0, 8).map(function(b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  });
}

// 解析來自網站獨立檔 explanations/<catId>.json（不放在題庫）。任何一步失敗都安靜略過，畫面維持原樣。
function loadExplanations() {
  if (wrongList.length === 0 || typeof fetch !== 'function' || typeof crypto === 'undefined' ||
      !crypto.subtle || typeof TextEncoder === 'undefined') return;
  var request;
  try {
    request = fetch('explanations/' + encodeURIComponent(catId) + '.json').then(function(res) {
      if (!res || !res.ok) throw new Error('no explanations');
      return res.json();
    });
  } catch (e) { return; }
  request.then(function(file) {
    if (!file || file.schema !== 1 || !file.items || typeof file.items !== 'object') return;
    return Promise.all(wrongList.map(function(item) {
      var key = String(item.q.id);
      if (!Object.prototype.hasOwnProperty.call(file.items, key)) return null;
      var entry = file.items[key];
      if (!entry || typeof entry.fp !== 'string' || typeof entry.explanation !== 'string') return null;
      return questionFingerprint(item.q).then(function(fp) {
        if (fp !== entry.fp) return null;
        return { item: item, entry: entry };
      });
    })).then(function(matches) {
      var shown = 0;
      matches.forEach(function(m) {
        if (!m) return;
        m.item.q.explanation = m.entry.explanation;
        m.item.q.legalBasis = m.entry.legalBasis;
        var block = buildExplanationBlock(m.item.q);
        if (!block) return;
        m.item.wi.insertBefore(block, m.item.fbBtn);
        shown++;
      });
      // 但書整頁只放一次（至少有一題真的顯示解析才放）
      if (shown > 0) {
        var aiNote = document.createElement('p');
        aiNote.className = 'wl-ai-note';
        aiNote.textContent = t('result.explanation.note');
        wrongListEl.insertBefore(aiNote, wrongList[0].wi);
      }
    });
  }).catch(function() { /* 解析是加分項，失敗不影響成績頁 */ });
}

var correct = 0, wrong = 0, hinted = 0, skipped = 0;
var wrongList = [];
var wrongListEl = null;

questions.forEach(function(q, i) {
  var ans = answers[i];
  var chosenEmpty = ans.chosen === null || ans.chosen === undefined || (Array.isArray(ans.chosen) && ans.chosen.length === 0);
  if (ans.hinted) {
    hinted++;
    wrongList.push({ q: q, ans: ans, idx: i + 1, status: "hinted" });
  } else if (chosenEmpty) {
    skipped++;
    wrongList.push({ q: q, ans: ans, idx: i + 1, status: "skipped" });
  } else if (isCorr(q, ans.chosen)) {
    correct++;
  } else {
    wrong++;
    wrongList.push({ q: q, ans: ans, idx: i + 1, status: "wrong" });
  }
});

// 使用共用 calculateScore（支援職類特殊配分規則）
var _sc = calculateScore(catId, questions, answers);
var realCorrect = _sc.realCorrect;
var score = _sc.score;
var perQScores = _sc.perQ;  // 每題分數陣列（供成績單細項顯示）
var passScore = getPassScore(catId);
var pass = score >= passScore;

// ===== 儲存歷史成績 =====
saveExamHistory({
  catId: catId,
  catName: catName,
  score: score,
  correct: realCorrect,
  total: questions.length,
  wrong: wrong + hinted + skipped,
  elapsed: elapsed || 0,
  mode: examMode || "normal",
  date: new Date().toISOString(),
});

// ===== 用時顯示 =====
var timeStr = elapsed ? formatTime(elapsed) : "";

// ===== 渲染 =====
var area = document.getElementById("result-area");
area.textContent = '';

// 成績卡片
var card = document.createElement('div');
card.className = 'result-card';

// 分數圓圈
var scoreCircle = document.createElement('div');
scoreCircle.className = 'score-circle ' + (pass ? 'pass' : 'fail');
var scoreNum = document.createElement('span');
scoreNum.className = 'score-num';
scoreNum.textContent = score;
scoreCircle.appendChild(scoreNum);
var scoreLabel = document.createElement('span');
scoreLabel.className = 'score-label';
scoreLabel.textContent = '/ ' + CONFIG.FULL_SCORE + ' ' + t('result.score.unit');
scoreCircle.appendChild(scoreLabel);
card.appendChild(scoreCircle);

// 及格/未及格
var badge = document.createElement('div');
badge.className = 'pass-badge ' + (pass ? 'pass' : 'fail');
badge.textContent = pass ? ('🎉 ' + t('result.pass')) : ('😓 ' + t('result.fail'));
card.appendChild(badge);

// 職類名稱
var catH2 = document.createElement('h2');
catH2.style.cssText = 'margin-bottom:8px;font-size:1rem;';
catH2.textContent = catName;
card.appendChild(catH2);

// 統計列
var stats = document.createElement('div');
stats.className = 'stats-row';
var statsData = [
  [t('result.correct'), realCorrect],
  [t('result.wrong'), wrong],
  [t('result.hinted'), hinted],
  [t('result.skipped'), skipped],
];
statsData.forEach(function(s) {
  var span = document.createElement('span');
  span.textContent = s[0] + ' ';
  var strong = document.createElement('strong');
  strong.textContent = s[1];
  span.appendChild(strong);
  var unit = document.createTextNode(' ' + t('mode.questions'));
  span.appendChild(unit);
  stats.appendChild(span);
});
if (timeStr) {
  var timeSpan = document.createElement('span');
  timeSpan.textContent = t('result.time') + ' ';
  var timeStrong = document.createElement('strong');
  timeStrong.textContent = timeStr;
  timeSpan.appendChild(timeStrong);
  stats.appendChild(timeSpan);
}
card.appendChild(stats);

// 操作/共同配比（僅含 subject 的題庫顯示）
var opCount = questions.filter(function(q) { return q.subject === '操作'; }).length;
var cmCount = questions.filter(function(q) { return q.subject === '共同'; }).length;
if (opCount > 0 || cmCount > 0) {
  var ratioDiv = document.createElement('div');
  ratioDiv.className = 'stats-ratio';
  ratioDiv.textContent = t('result.ratio.op') + ' ' + opCount + ' ' + t('mode.questions') +
    ' / ' + t('result.ratio.cm') + ' ' + cmCount + ' ' + t('mode.questions');
  card.appendChild(ratioDiv);
}

// 說明（動態帶入職類及格分數）
var disc = document.createElement('p');
disc.style.cssText = 'font-size:.82rem;color:var(--gray-500);margin-bottom:20px;';
disc.textContent = t('result.disclaimer').replace(/60/g, String(passScore));
card.appendChild(disc);

// 操作按鈕
var actions = document.createElement('div');
actions.className = 'result-actions';
var homeLink = document.createElement('a');
homeLink.href = 'index.html';
homeLink.className = 'btn btn-outline';
homeLink.textContent = t('result.btn.home');
actions.appendChild(homeLink);

var retryLink = document.createElement('a');
retryLink.href = 'exam.html?cat=' + encodeURIComponent(catId) + '&examMode=' + examMode;
retryLink.className = 'btn btn-primary';
retryLink.textContent = t('result.btn.retry');
actions.appendChild(retryLink);

if (wrongList.length > 0) {
  var reviewBtn = document.createElement('button');
  reviewBtn.className = 'btn btn-review';
  reviewBtn.onclick = startReview;
  reviewBtn.textContent = t('result.btn.review') + ' (' + wrongList.length + t('mode.questions') + ')';
  actions.appendChild(reviewBtn);
}
card.appendChild(actions);
area.appendChild(card);

// 錯題列表
if (wrongList.length > 0) {
  var wl = document.createElement('div');
  wl.className = 'wrong-list';
  wrongListEl = wl;
  var wlH2 = document.createElement('h2');
  wlH2.textContent = wrongList.length + ' ' + t('mode.questions');
  wl.appendChild(wlH2);

  wrongList.forEach(function(item) {
    var wi = document.createElement('div');
    wi.className = 'wrong-item';

    var numDiv = document.createElement('div');
    numDiv.className = 'wi-num';
    numDiv.textContent = t('exam.q.prefix') + item.idx + t('exam.q.unit') + ' ';
    if (item.status === 'hinted') {
      var hs = document.createElement('span');
      hs.className = 'wi-hinted';
      hs.textContent = t('result.status.hinted');
      numDiv.appendChild(hs);
    } else if (item.status === 'skipped') {
      var ss2 = document.createElement('span');
      ss2.className = 'wi-hinted';
      ss2.textContent = t('result.status.skipped');
      numDiv.appendChild(ss2);
    } else if (item.status === 'wrong') {
      var ws = document.createElement('span');
      ws.className = 'wi-your';
      ws.textContent = t('result.status.wrong');
      numDiv.appendChild(ws);
    }
    wi.appendChild(numDiv);

    var qDiv = document.createElement('div');
    qDiv.className = 'wi-q';
    qDiv.textContent = item.q.q;
    wi.appendChild(qDiv);

    var metaDiv = document.createElement('div');
    metaDiv.className = 'wi-meta';
    var chosenEmpty = item.ans.chosen === null || item.ans.chosen === undefined || (Array.isArray(item.ans.chosen) && item.ans.chosen.length === 0);
    if (!chosenEmpty && !isCorr(item.q, item.ans.chosen)) {
      var yourSpan = document.createElement('span');
      yourSpan.className = 'wi-your';
      yourSpan.textContent = t('result.your.answer') + formatAns(item.q, item.ans.chosen);
      metaDiv.appendChild(yourSpan);
    }
    var correctSpan = document.createElement('span');
    correctSpan.className = 'wi-correct';
    correctSpan.textContent = t('result.correct.answer') + formatCorrect(item.q);
    metaDiv.appendChild(correctSpan);
    wi.appendChild(metaDiv);

    var fbBtn = document.createElement('button');
    fbBtn.className = 'btn btn-feedback';
    fbBtn.textContent = t('exam.btn.feedback');
    fbBtn.onclick = function() { openResultFeedback(item.idx - 1); };
    wi.appendChild(fbBtn);
    item.wi = wi;
    item.fbBtn = fbBtn;

    wl.appendChild(wi);
  });
  area.appendChild(wl);
  loadExplanations();
} else {
  var perfect = document.createElement('p');
  perfect.style.cssText = 'text-align:center;color:var(--success);font-weight:700;font-size:1.1rem;margin:24px;';
  perfect.textContent = t('result.perfect');
  area.appendChild(perfect);
}

// 歷史成績
var examHistory = getExamHistory();
if (examHistory.length > 1) {
  var hCard = document.createElement('div');
  hCard.className = 'history-card';
  var hH2 = document.createElement('h2');
  hH2.textContent = t('result.history');
  hCard.appendChild(hH2);

  var hList = document.createElement('div');
  hList.className = 'history-list';
  examHistory.slice(0, 10).forEach(function(h, idx) {
    var hi = document.createElement('div');
    hi.className = 'history-item' + (idx === 0 ? ' latest' : '');

    var catDiv = document.createElement('div');
    catDiv.className = 'hi-cat';
    catDiv.textContent = h.catName;
    if (idx === 0) {
      var curBadge = document.createElement('span');
      curBadge.className = 'hi-badge';
      curBadge.textContent = t('result.current');
      catDiv.appendChild(curBadge);
    }
    hi.appendChild(catDiv);

    var sDiv = document.createElement('div');
    sDiv.className = 'hi-score ' + (h.score >= getPassScore(h.catId) ? 'pass' : 'fail');
    sDiv.textContent = h.score + ' ' + t('result.score.unit');
    hi.appendChild(sDiv);

    var dDiv = document.createElement('div');
    dDiv.className = 'hi-detail';
    dDiv.textContent = t('result.correct') + ' ' + h.correct + '/' + h.total;
    hi.appendChild(dDiv);

    var dateDiv = document.createElement('div');
    dateDiv.className = 'hi-date';
    dateDiv.textContent = new Date(h.date).toLocaleDateString(getLang() === 'zh-TW' ? 'zh-TW' : undefined);
    hi.appendChild(dateDiv);

    hList.appendChild(hi);
  });
  hCard.appendChild(hList);
  area.appendChild(hCard);
}

// ===== 錯題複習 =====
function startReview() {
  var reviewQs = wrongList.map(function(item) { return item.q; });
  sessionStorage.setItem("reviewQuestions", JSON.stringify(reviewQs));
  location.href = 'exam.html?cat=' + encodeURIComponent(catId) + '&mode=review';
}

// ===== 反饋功能 =====
var resultFbQIndex = null;

// 「解析有誤」只在該題有解析時出現；用增刪 option 而非 hidden，因為 iOS Safari 不會隱藏 option
var EXPLANATION_FB_TYPE = '解析有誤';
function syncExplanationFbOption(q) {
  var sel = document.getElementById("result-fb-type");
  var opt = sel.querySelector('option[value="' + EXPLANATION_FB_TYPE + '"]');
  if (hasExplanation(q)) {
    if (!opt) sel.appendChild(new Option(t('fb.type.explanation'), EXPLANATION_FB_TYPE));
  } else if (opt) {
    if (opt.selected) sel.selectedIndex = 0;
    opt.remove();
  }
}

function openResultFeedback(qIdx) {
  resultFbQIndex = qIdx;
  syncExplanationFbOption(questions[qIdx]);
  document.getElementById("result-fb-modal").classList.add("open");
}
function closeResultFeedback() {
  document.getElementById("result-fb-modal").classList.remove("open");
}

async function submitResultFeedback() {
  var q = questions[resultFbQIndex];
  await submitFeedbackCommon({
    catName: catName,
    questionId: q.id,
    questionText: q.q,
    options: q.options,
    answer: q.answer,
    typeElId: "result-fb-type",
    descElId: "result-fb-desc",
    modalEl: document.getElementById("result-fb-modal"),
    btn: document.querySelector('#result-fb-modal .btn-primary'),
  });
}

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape" && document.getElementById("result-fb-modal").classList.contains("open")) {
    closeResultFeedback();
  }
});
