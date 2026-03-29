// ===== 成績頁 =====
var raw = sessionStorage.getItem("examResult");
if (!raw) { location.replace("index.html"); throw new Error("no data"); }

var data;
try { data = JSON.parse(raw); } catch(e) { location.replace("index.html"); throw new Error("data corrupted"); }
var catId = data.catId, catName = data.catName, questions = data.questions, answers = data.answers, elapsed = data.elapsed, examMode = data.examMode;
var modeConf = CONFIG.MODES[examMode] || CONFIG.MODES.normal;

// ===== 計分 =====
var correct = 0, wrong = 0, hinted = 0, skipped = 0;
var wrongList = [];

questions.forEach(function(q, i) {
  var ans = answers[i];
  if (ans.hinted) {
    hinted++;
    wrongList.push({ q: q, ans: ans, idx: i + 1, status: "hinted" });
  } else if (ans.chosen === null) {
    skipped++;
    wrongList.push({ q: q, ans: ans, idx: i + 1, status: "skipped" });
  } else if (ans.chosen === q.answer) {
    correct++;
  } else {
    wrong++;
    wrongList.push({ q: q, ans: ans, idx: i + 1, status: "wrong" });
  }
});

var realCorrect = answers.filter(function(a, i) { return !a.hinted && a.chosen === questions[i].answer; }).length;
var scorePerQ = CONFIG.FULL_SCORE / questions.length;
var score = Math.round(realCorrect * scorePerQ * 100) / 100;
var pass = score >= CONFIG.PASS_SCORE;

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

// 說明
var disc = document.createElement('p');
disc.style.cssText = 'font-size:.82rem;color:var(--gray-500);margin-bottom:20px;';
disc.textContent = t('result.disclaimer');
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
    if (item.ans.chosen !== null && item.ans.chosen !== item.q.answer) {
      var yourSpan = document.createElement('span');
      yourSpan.className = 'wi-your';
      yourSpan.textContent = t('result.your.answer') + item.q.options[item.ans.chosen];
      metaDiv.appendChild(yourSpan);
    }
    var correctSpan = document.createElement('span');
    correctSpan.className = 'wi-correct';
    correctSpan.textContent = t('result.correct.answer') + item.q.options[item.q.answer];
    metaDiv.appendChild(correctSpan);
    wi.appendChild(metaDiv);

    var fbBtn = document.createElement('button');
    fbBtn.className = 'btn btn-feedback';
    fbBtn.textContent = t('exam.btn.feedback');
    fbBtn.onclick = function() { openResultFeedback(item.idx - 1); };
    wi.appendChild(fbBtn);

    wl.appendChild(wi);
  });
  area.appendChild(wl);
} else {
  var perfect = document.createElement('p');
  perfect.style.cssText = 'text-align:center;color:var(--success);font-weight:700;font-size:1.1rem;margin:24px;';
  perfect.textContent = t('result.perfect');
  area.appendChild(perfect);
}

// 歷史成績
var history = getExamHistory();
if (history.length > 1) {
  var hCard = document.createElement('div');
  hCard.className = 'history-card';
  var hH2 = document.createElement('h2');
  hH2.textContent = t('result.history');
  hCard.appendChild(hH2);

  var hList = document.createElement('div');
  hList.className = 'history-list';
  history.slice(0, 10).forEach(function(h, idx) {
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
    sDiv.className = 'hi-score ' + (h.score >= CONFIG.PASS_SCORE ? 'pass' : 'fail');
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

function openResultFeedback(qIdx) {
  resultFbQIndex = qIdx;
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
