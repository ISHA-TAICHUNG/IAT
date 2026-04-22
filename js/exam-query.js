// ===== 即測即評測驗日期查詢（龍井教室專用）=====
(function () {
  'use strict';

  // 後端 API（由使用者部署 GAS 後提供）
  var API_URL = 'https://script.google.com/macros/s/AKfycbyoXa2uaz53wa_uVSlIrDPTfuM87f36y-nCVZArj8VG-AWp64vDqaMgJ0GlKXZznPw/exec';
  var CACHE_TTL = 300000;
  var MAX_HISTORY = 5;
  var TIMEOUT = 15000;

  var PNO_MAP = {
    '00400': '男子西服',
    '00700': '女子服裝',
    '02000': '餐飲服務',
    '03100': '美容',
    '06000': '一般車床',
    '06100': '固定式起重機操作',
    '06200': '移動式起重機操作',
    '07400': '氣銲',
    '07700': '建築物室內配線',
    '09900': '鍋爐操作',
    '11800': '特定氣體熔接',
    '15100': '堆高機操作',
    '18201': '製茶',
    '22200': '食品'
  };

  var EGR_MAP = { '1': '甲級', '2': '乙級', '3': '丙級', '4': '單一級' };

  var form = document.getElementById('examQueryForm');
  if (!form) return;
  var idnoInput = document.getElementById('eqIdno');
  var btn = document.getElementById('eqBtn');
  var btnText = document.getElementById('eqBtnText');
  var errDiv = document.getElementById('eqError');
  var errText = document.getElementById('eqErrorText');
  var resultsDiv = document.getElementById('eqResults');
  var historyDiv = document.getElementById('eqHistory');
  var historyTags = document.getElementById('eqHistoryTags');
  var noticesBtn = document.getElementById('eqNoticesBtn');
  var noticesBody = document.getElementById('eqNoticesBody');
  var noticesArrow = document.getElementById('eqNoticesArrow');

  var cache = new Map();
  // 隱私保護：身分證號只存在 sessionStorage（tab 關閉即清除），
  // 且不使用 localStorage（跨 session 永久保留，公用電腦會洩漏前人資料）
  var HISTORY_KEY = 'exam_query_history';
  // 若 localStorage 有舊資料，清除（相容舊版本遺留）
  try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
  var history = loadHistory();
  var searching = false;

  renderHistory();
  idnoInput.focus();

  // 自動大寫英文字母
  idnoInput.addEventListener('input', function (e) {
    var v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v !== e.target.value) e.target.value = v;
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (searching) return;
    var idno = idnoInput.value.trim().toUpperCase();
    if (!validate(idno)) return;
    hideError();
    showConfirmBeforeQuery(function () { doSearch(idno); });
  });

  historyTags.addEventListener('click', function (e) {
    var tag = e.target.closest('.history-tag');
    if (tag) {
      idnoInput.value = tag.dataset.idno || tag.textContent;
      form.dispatchEvent(new Event('submit'));
    }
  });

  noticesBtn.addEventListener('click', function () {
    var isHidden = noticesBody.classList.toggle('hidden');
    noticesBtn.setAttribute('aria-expanded', !isHidden);
    noticesArrow.style.transform = isHidden ? '' : 'rotate(180deg)';
  });

  // 查詢前提示：每次查詢都提醒，以紙本准考證為準
  function showConfirmBeforeQuery(onConfirm) {
    var modal = document.getElementById('eqConfirmModal');
    var okBtn = document.getElementById('eqConfirmOk');
    if (!modal || !okBtn) { onConfirm(); return; }

    modal.classList.add('open');
    var cleanup = function () {
      modal.classList.remove('open');
      okBtn.removeEventListener('click', handleOk);
      modal.removeEventListener('click', handleBackdrop);
      document.removeEventListener('keydown', handleEsc);
    };
    var handleOk = function () { cleanup(); onConfirm(); };
    var handleBackdrop = function (ev) { if (ev.target === modal) cleanup(); };
    var handleEsc = function (ev) { if (ev.key === 'Escape') cleanup(); };
    okBtn.addEventListener('click', handleOk);
    modal.addEventListener('click', handleBackdrop);
    document.addEventListener('keydown', handleEsc);
    okBtn.focus();
  }

  function validate(idno) {
    if (!idno) { showError('請輸入身分證字號'); return false; }
    if (idno.length !== 10) { showError('身分證字號必須為 10 碼'); return false; }
    if (!/^[A-Z][12]\d{8}$/.test(idno)) {
      showError('格式錯誤：1 個英文字母 + 性別碼(1或2) + 8 個數字');
      return false;
    }
    if (!validateROC(idno)) {
      showError('身分證字號檢查碼不正確');
      return false;
    }
    return true;
  }

  // 台灣身分證字號檢查碼驗證
  function validateROC(id) {
    var letterMap = 'ABCDEFGHJKLMNPQRSTUVXYWZIO';
    var letterValues = [10,11,12,13,14,15,16,17,34,18,19,20,21,22,35,23,24,25,26,27,28,29,32,30,31,33];
    var idx = letterMap.indexOf(id.charAt(0));
    if (idx < 0) return false;
    var n = letterValues[idx];
    var sum = Math.floor(n / 10) + (n % 10) * 9;
    for (var i = 1; i < 9; i++) sum += parseInt(id.charAt(i), 10) * (9 - i);
    sum += parseInt(id.charAt(9), 10);
    return sum % 10 === 0;
  }

  function showError(msg) { errText.textContent = msg; errDiv.classList.add('show'); }
  function hideError() { errDiv.classList.remove('show'); }

  async function doSearch(idno) {
    searching = true;
    btn.disabled = true;
    btnText.textContent = '查詢中...';
    resultsDiv.textContent = '';

    var cached = cache.get(idno);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      renderResults(cached.data);
      showToast('使用快取資料');
      done();
      return;
    }

    try {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, TIMEOUT);
      var resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'examQuery', idno: idno, exactMatch: true }),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();

      if (data.success && data.data && data.data.length > 0) {
        cache.set(idno, { data: data, ts: Date.now() });
        renderResults(data);
        addHistory(idno);
        showToast('查詢成功，找到 ' + data.data.length + ' 筆');
      } else {
        renderNoResult();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        renderError('請求逾時，請稍後再試');
      } else {
        renderError('查詢失敗，請檢查網路連線');
      }
    }
    done();
  }

  function done() {
    searching = false;
    btn.disabled = false;
    btnText.textContent = '🔍 查詢測驗資訊';
  }

  // 依當天最早場次時間推算報到時間
  // 上午場（< 12:00）→ 7:30 ~ 7:40；下午場 → 12:50
  function computeCheckinTime(mode, writtenTime, practicalTime) {
    var earliest = null;
    if (mode.code === 'B') {
      // 免術科只考學科
      earliest = writtenTime;
    } else {
      // 取學科、術科中較早的開始時間
      var times = [writtenTime, practicalTime].filter(Boolean);
      times.sort(function (a, b) { return String(a).localeCompare(String(b)); });
      earliest = times[0];
    }
    if (!earliest) return '—';
    var isMorning = /^0[6-9]|^1[0-1]/.test(String(earliest));
    return isMorning ? '上午 7:30 ~ 7:40' : '中午 12:50';
  }

  function getExamMode(dstng, writtenTime, practicalTime) {
    if (dstng === 'B' || dstng === 'b') return { code: 'B', label: '🅰️ 免術科', desc: '僅考學科' };
    var wMorn = writtenTime && /^0[6-9]|^1[0-2]/.test(writtenTime);
    var pMorn = practicalTime && /^0[6-9]|^1[0-2]/.test(practicalTime);
    if (wMorn && !pMorn) return { code: 'W_P', label: '🅱️ 上午學科 / 下午術科', desc: '上午學科，下午術科' };
    if (pMorn && !wMorn) return { code: 'P_W', label: '🅲 上午術科 / 下午學科', desc: '上午術科，下午學科' };
    return { code: '-', label: '📋 測驗方式', desc: '依查詢結果顯示' };
  }

  function formatROCDate(s) {
    if (!s) return '';
    s = String(s);
    if (s.length === 7) {
      return s.substring(0, 3) + '年' + parseInt(s.substring(3, 5), 10) + '月' + parseInt(s.substring(5, 7), 10) + '日';
    }
    return s;
  }

  function getOccupation(pno, egr) {
    var name = PNO_MAP[pno] || ('職類代碼 ' + pno);
    var level = EGR_MAP[String(egr)] || '';
    return level ? (name + '（' + level + '）') : name;
  }

  function renderResults(data) {
    resultsDiv.textContent = '';
    var items = data.data || data;

    items.forEach(function (item, idx) {
      var card = document.createElement('div');
      card.className = 'result-item';

      var header = document.createElement('div');
      header.className = 'result-header';
      var h3 = document.createElement('h3');
      h3.textContent = item.studentName || item.name || '查詢結果';
      if (items.length > 1) {
        h3.textContent += '（第 ' + (idx + 1) + ' 筆）';
      }
      header.appendChild(h3);
      card.appendChild(header);

      // 測驗方式標籤
      var mode = getExamMode(item.exemption || item.dstng, item.writtenTime, item.practicalTime);
      var modeBadge = document.createElement('div');
      modeBadge.style.cssText = 'margin:12px 24px 8px;padding:10px 16px;background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1px solid #fed7aa;border-radius:10px;display:flex;align-items:center;gap:10px;font-weight:600;color:#9a3412';
      var modeIcon = document.createElement('span');
      modeIcon.style.cssText = 'font-size:1.2rem';
      modeIcon.textContent = mode.label.split(' ')[0];
      var modeText = document.createElement('div');
      var modeTitle = document.createElement('div');
      modeTitle.style.cssText = 'font-size:0.95rem';
      modeTitle.textContent = mode.label.replace(/^[^\s]+\s/, '');
      var modeDesc = document.createElement('div');
      modeDesc.style.cssText = 'font-size:0.78rem;color:#c2410c;font-weight:500;margin-top:2px';
      modeDesc.textContent = mode.desc;
      modeText.appendChild(modeTitle);
      modeText.appendChild(modeDesc);
      modeBadge.appendChild(modeIcon);
      modeBadge.appendChild(modeText);
      card.appendChild(modeBadge);

      var grid = document.createElement('div');
      grid.className = 'result-grid';

      var cert = item.certNumber || item.aeno || '';
      var occ = getOccupation(item.pno, item.egr || item.level);

      // 推算當天最早場次的報到時間（上午場 7:30-7:40、下午場 12:50）
      var checkinTime = computeCheckinTime(mode, item.writtenTime, item.practicalTime);

      var fields = [
        { label: '身分證字號', value: item.idno || '—', icon: '🪪', hl: false },
        { label: '職類 / 級別', value: occ, icon: '📚', hl: false },
        { label: '准考證號', value: cert ? String(cert).trim() : '-', icon: '🎫', hl: false },
        { label: '報到時間', value: checkinTime, icon: '🚶', hl: true },
      ];

      // 學科：所有人都考（含免術科者）
      fields.push({ label: '學科測驗日期', value: formatROCDate(item.writtenDate) || '待公告', icon: '📅', hl: true });
      fields.push({ label: '學科測驗時間', value: item.writtenTime || '待公告', icon: '⏰', hl: true });
      fields.push({ label: '學科測驗教室', value: item.writtenRoom || '龍井教室 2 樓即測即評學科電腦教室', icon: '🏫', hl: false });
      if (item.writtenSession) fields.push({ label: '學科場次', value: item.writtenSession, icon: '🎟️', hl: false });
      if (item.writtenSeat) fields.push({ label: '學科座號', value: item.writtenSeat, icon: '💺', hl: false });

      // 術科：免術科者 (mode.code === 'B') 不顯示術科
      if (mode.code !== 'B') {
        fields.push({ label: '術科測驗日期', value: formatROCDate(item.practicalDate) || '待公告', icon: '📅', hl: true });
        fields.push({ label: '術科測驗時間', value: item.practicalTime || '待公告', icon: '⏰', hl: true });
        if (item.practicalRoom) fields.push({ label: '術科測驗場地', value: item.practicalRoom, icon: '🛠️', hl: false });
        if (item.practicalSeat) fields.push({ label: '術科座號', value: item.practicalSeat, icon: '💺', hl: false });
      }

      fields.forEach(function (f) {
        var field = document.createElement('div');
        field.className = 'result-field' + (f.hl ? ' highlight' : '');

        var iconDiv = document.createElement('div');
        iconDiv.className = 'result-field-icon';
        iconDiv.textContent = f.icon;

        var textDiv = document.createElement('div');
        var label = document.createElement('div');
        label.className = 'result-field-label';
        label.textContent = f.label + (f.hl ? ' ★' : '');
        var val = document.createElement('div');
        val.className = 'result-field-value';
        val.textContent = f.value || '未提供';
        textDiv.appendChild(label);
        textDiv.appendChild(val);

        field.appendChild(iconDiv);
        field.appendChild(textDiv);
        grid.appendChild(field);
      });
      card.appendChild(grid);

      var tipDiv = document.createElement('div');
      tipDiv.className = 'tip-box tip-info';
      tipDiv.style.margin = '0 24px 24px';
      tipDiv.textContent = '💡 請於測驗前 30 分鐘抵達龍井試場辦理報到（臺中市龍井區中社五街 12 號）。';
      card.appendChild(tipDiv);

      resultsDiv.appendChild(card);
    });

    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderNoResult() {
    resultsDiv.textContent = '';
    var div = document.createElement('div');
    div.className = 'query-card no-result';

    var icon = document.createElement('div');
    icon.className = 'no-result-icon';
    icon.textContent = '🔍';
    div.appendChild(icon);

    var h3 = document.createElement('h3');
    h3.textContent = '目前無法找到您的即測即評測驗資訊';
    div.appendChild(h3);

    var p1 = document.createElement('p');
    p1.textContent = '可能測驗資訊尚未發布，或姓名輸入有誤。';
    div.appendChild(p1);

    var p2 = document.createElement('p');
    p2.style.marginTop = '12px';
    p2.textContent = '請直接致電龍井試場確認：';
    div.appendChild(p2);

    var linkDiv = document.createElement('div');
    linkDiv.style.cssText = 'margin-top:8px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap';

    var a1 = document.createElement('a');
    a1.href = 'tel:04-26336999';
    a1.style.cssText = 'color:var(--primary);font-weight:700;font-size:1.1rem';
    a1.textContent = '📞 04-2633-6999';
    linkDiv.appendChild(a1);

    div.appendChild(linkDiv);
    resultsDiv.appendChild(div);
  }

  function renderError(msg) {
    resultsDiv.textContent = '';
    var div = document.createElement('div');
    div.className = 'query-card no-result';

    var icon = document.createElement('div');
    icon.className = 'no-result-icon';
    icon.textContent = '❌';
    div.appendChild(icon);

    var h3 = document.createElement('h3');
    h3.textContent = '查詢發生錯誤';
    div.appendChild(h3);

    var p = document.createElement('p');
    p.textContent = msg;
    div.appendChild(p);

    var btn2 = document.createElement('button');
    btn2.textContent = '重新整理';
    btn2.style.cssText = 'margin-top:16px;padding:10px 24px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit';
    btn2.onclick = function () { location.reload(); };
    div.appendChild(btn2);

    resultsDiv.appendChild(div);
  }

  function loadHistory() {
    // 使用 sessionStorage — tab 關閉即清除，不跨 session 保留
    try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function addHistory(idno) {
    history = history.filter(function (h) { return h !== idno; });
    history.unshift(idno);
    history = history.slice(0, MAX_HISTORY);
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) { }
    renderHistory();
  }

  // 身分證遮罩顯示：A1****6789
  function maskIdno(idno) {
    if (!idno || idno.length !== 10) return idno;
    return idno.substring(0, 2) + '****' + idno.substring(6);
  }

  function renderHistory() {
    if (!history.length) { historyDiv.style.display = 'none'; return; }
    historyDiv.style.display = '';
    historyTags.textContent = '';
    history.forEach(function (idno) {
      var tag = document.createElement('button');
      tag.className = 'history-tag';
      tag.textContent = maskIdno(idno);
      tag.dataset.idno = idno;
      tag.type = 'button';
      historyTags.appendChild(tag);
    });
  }
})();
