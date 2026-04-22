// ===== 測驗日期查詢（台中職業訓練中心專用） =====
(function() {
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbyfN0Soku5MzYi-VXy2h5Hkn6TrCocmONnzM-jQ1wdE2ANOsaPlgyxx7aX38o5I7a1v/exec';
  var CACHE_TTL = 300000;
  var MAX_HISTORY = 5;
  var TIMEOUT = 15000;

  var form = document.getElementById('queryForm');
  if (!form) return; // 非 query 頁面，跳過初始化
  var nameInput = document.getElementById('qName');
  var btn = document.getElementById('qBtn');
  var btnText = document.getElementById('qBtnText');
  var errDiv = document.getElementById('qError');
  var errText = document.getElementById('qErrorText');
  var resultsDiv = document.getElementById('qResults');
  var historyDiv = document.getElementById('qHistory');
  var historyTags = document.getElementById('qHistoryTags');
  var noticesBtn = document.getElementById('noticesBtn');
  var noticesBody = document.getElementById('noticesBody');
  var noticesArrow = document.getElementById('noticesArrow');

  var cache = new Map();
  var history = loadHistory();
  var searching = false;

  renderHistory();
  nameInput.focus();

  // 事件綁定
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (searching) return;
    var name = nameInput.value.trim();
    if (!validate(name)) return;
    hideError();
    doSearch(name);
  });

  historyTags.addEventListener('click', function(e) {
    var tag = e.target.closest('.history-tag');
    if (tag) {
      nameInput.value = tag.textContent;
      form.dispatchEvent(new Event('submit'));
    }
  });

  noticesBtn.addEventListener('click', function() {
    var isHidden = noticesBody.classList.toggle('hidden');
    noticesBtn.setAttribute('aria-expanded', !isHidden);
    noticesArrow.style.transform = isHidden ? '' : 'rotate(180deg)';
  });

  // 驗證
  function validate(name) {
    if (!name) { showError('請輸入姓名'); return false; }
    if (name.length < 2) { showError('姓名至少 2 個字元'); return false; }
    if (name.length > 20) { showError('姓名不能超過 20 字元'); return false; }
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9\s]+$/.test(name)) {
      showError('姓名只能包含中文、英文和數字');
      return false;
    }
    return true;
  }

  function showError(msg) {
    errText.textContent = msg;
    errDiv.classList.add('show');
  }

  function hideError() {
    errDiv.classList.remove('show');
  }

  // 查詢
  async function doSearch(name) {
    searching = true;
    btn.disabled = true;
    btnText.textContent = '查詢中...';
    resultsDiv.textContent = '';

    // 快取
    var cached = cache.get(name);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      renderResults(cached.data);
      showToast('使用快取資料');
      done();
      return;
    }

    try {
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, TIMEOUT);

      var resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ name: name, exactMatch: true }),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();

      if (data.success && data.data && data.data.length > 0) {
        cache.set(name, { data: data, ts: Date.now() });
        renderResults(data);
        addHistory(name);
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

  // 渲染結果（使用 DOM API，安全無 XSS）
  function renderResults(data) {
    resultsDiv.textContent = '';
    var items = data.data || data;

    items.forEach(function(item, idx) {
      var card = document.createElement('div');
      card.className = 'result-item';

      // header
      var header = document.createElement('div');
      header.className = 'result-header';
      var h3 = document.createElement('h3');
      h3.textContent = item.studentName || '查詢結果';
      if (items.length > 1) {
        h3.textContent += '（第 ' + (item.sessionNumber || idx + 1) + ' 場次）';
      }
      header.appendChild(h3);
      card.appendChild(header);

      // grid
      var grid = document.createElement('div');
      grid.className = 'result-grid';

      // 身分證字號欄位：優先使用 API 提供的欄位，避免同名同姓誤認
      var idno = item.idno || item.idNumber || item.idCard || '';
      var maskedIdno = '';
      if (idno && idno.length === 10) {
        maskedIdno = idno.substring(0, 2) + '****' + idno.substring(6);
      } else if (idno) {
        maskedIdno = idno;
      }

      var fields = [];
      if (maskedIdno) {
        fields.push({ label: '身分證字號', value: maskedIdno, icon: '🪪', hl: false });
      }
      fields = fields.concat([
        { label: '測驗日期', value: item.testDate, icon: '📅', hl: false },
        { label: '報到時間', value: item.checkinTime, icon: '🚶', hl: true },
        { label: '測驗時間', value: item.testTime, icon: '⏰', hl: false },
        { label: '座號', value: item.seatNumber, icon: '💺', hl: false },
        { label: '測驗教室', value: (item.testRoom || '').replace(/第9教室/g, '忠明教室'), icon: '🏫', hl: true },
        { label: '測驗職類', value: item.testClass, icon: '📚', hl: false },
      ]);

      fields.forEach(function(f) {
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

      // 報到提醒
      var tipDiv = document.createElement('div');
      tipDiv.className = 'tip-box tip-info';
      tipDiv.style.margin = '0 24px 24px';
      tipDiv.textContent = '💡 報到時請先詢問櫃檯「考生休息室」在哪，方便在測驗前休息等候。';
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
    h3.textContent = '目前無法找到您的測驗資訊';
    div.appendChild(h3);

    var p1 = document.createElement('p');
    p1.textContent = '可能測驗資訊尚未發布（通常開考前 10 個工作天），或姓名輸入有誤。';
    div.appendChild(p1);

    var p2 = document.createElement('p');
    p2.style.marginTop = '12px';
    p2.textContent = '請直接致電確認：';
    div.appendChild(p2);

    var linkDiv = document.createElement('div');
    linkDiv.style.cssText = 'margin-top:8px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap';

    var a1 = document.createElement('a');
    a1.href = 'tel:04-22608999';
    a1.style.cssText = 'color:var(--primary);font-weight:700;font-size:1.1rem';
    a1.textContent = '📞 04-2260-8999';
    linkDiv.appendChild(a1);

    var a2 = document.createElement('a');
    a2.href = 'tel:04-26336999';
    a2.style.cssText = 'color:var(--primary);font-weight:700;font-size:1.1rem';
    a2.textContent = '📞 04-2633-6999';
    linkDiv.appendChild(a2);

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
    btn2.onclick = function() { location.reload(); };
    div.appendChild(btn2);

    resultsDiv.appendChild(div);
  }

  // 搜尋歷史
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('query_history') || '[]'); }
    catch(e) { return []; }
  }

  function addHistory(name) {
    history = history.filter(function(h) { return h !== name; });
    history.unshift(name);
    history = history.slice(0, MAX_HISTORY);
    try { localStorage.setItem('query_history', JSON.stringify(history)); } catch(e) {}
    renderHistory();
  }

  function renderHistory() {
    if (!history.length) { historyDiv.style.display = 'none'; return; }
    historyDiv.style.display = '';
    historyTags.textContent = '';
    history.forEach(function(name) {
      var tag = document.createElement('button');
      tag.className = 'history-tag';
      tag.textContent = name;
      tag.type = 'button';
      historyTags.appendChild(tag);
    });
  }
})();
