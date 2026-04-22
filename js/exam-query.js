// ===== 即測即評測驗日期查詢（龍井教室專用）=====
(function () {
  'use strict';

  // 後端 API（由使用者部署 GAS 後提供）
  var API_URL = 'https://script.google.com/macros/s/AKfycbyoXa2uaz53wa_uVSlIrDPTfuM87f36y-nCVZArj8VG-AWp64vDqaMgJ0GlKXZznPw/exec';
  var CACHE_TTL = 300000;
  var MAX_HISTORY = 5;
  var TIMEOUT = 15000;

  // 職類代碼對照（依勞動部勞動力發展署技能檢定中心公告）
  // 參考：https://web.ccvs.kh.edu.tw/departments/ccvsstgo/immediately/index.htm
  var PNO_MAP = {
    '00100': '冷凍空調裝修',
    '00400': '一般手工電銲',
    '00700': '室內配線',
    '00901': '泥水-砌磚', '00902': '泥水-粉刷', '00903': '泥水-面材舖貼',
    '01000': '電器修護', '01100': '鑄造', '01200': '家具木工',
    '01300': '工業配線', '01500': '冷作', '01600': '自來水管配管',
    '01800': '鋼筋', '01900': '模板',
    '02000': '汽車修護', '02100': '熱處理', '02702': '重機械修護-引擎',
    '02800': '工業電子', '02900': '視聽電子',
    '03000': '化學', '03100': '鍋爐操作', '03200': '變壓器裝修',
    '03600': '工業儀器', '03900': '門窗木工',
    '04000': '配電線路裝修',
    '04200': '測量', '04202': '測量-工程測量', '04203': '測量-地籍測量',
    '04800': '女裝',
    '05000': '石油化學', '05200': '農業機械修護', '05400': '陶瓷-石膏模',
    '06000': '男子理髮',
    '06100': '固定式起重機操作',
    '06200': '移動式起重機操作',
    '06300': '人字臂起重桿操作', '06400': '升降機裝修',
    '06700': '女子美髮', '06900': '建築工程管理',
    '07000': '重機械操作',
    '07001': '重機械操作-推土機', '07004': '重機械操作-鏟裝機',
    '07005': '重機械操作-一般裝載機',
    '07100': '製鞋', '07400': '配電電纜裝修',
    '07601': '中餐烹調-素食', '07602': '中餐烹調-葷食',
    '07800': '眼鏡鏡片製作', '07900': '油壓',
    '08000': '氣壓',
    '08101': '下水道設施維護-管渠系統', '08102': '下水道設施維護-機電設備',
    '08103': '下水道設施維護-處理系統', '08104': '下水道設施維護-水質檢驗',
    '08700': '平版印刷',
    '09100': '氬氣鎢極電銲', '09200': '食品檢驗分析',
    '09700': '半自動電銲', '09800': '職業潛水',
    '09900': '第一種壓力容器操作',
    '10000': '美容',
    '11150': '儀表電子', '11600': '電力電子', '11700': '數位電子',
    '11800': '電腦軟體應用', '11900': '電腦軟體設計',
    '11901': '電腦軟體設計-JAVA', '11902': '電腦軟體設計-C++',
    '12000': '電腦硬體裝修', '12100': '工業用管配管',
    '12200': '氣體燃料導管配管', '12300': '化工', '12400': '電繡',
    '12500': '建築物室內設計', '12600': '建築物室內裝修工程管理',
    '12700': '機械停車設備裝修',
    '13000': '水族養殖', '13300': '園藝', '13400': '農藝',
    '13600': '造園景觀', '13900': '寵物美容',
    '14000': '西餐烹調', '14500': '機器腳踏車修護',
    '14600': '金銀珠寶飾品加工', '14800': '建築塗裝',
    '14902': '會計事務',
    '15100': '堆高機操作', '15200': '電腦輔助立體製圖',
    '15300': '汽車車體板金', '15400': '托育人員',
    '15500': '特定瓦斯器具裝修',
    '15600': '通信技術(電信線路)',
    '15702': '農田灌溉排水-設施維護管理(田間)',
    '15704': '農田灌溉排水-灌溉水質管理及檢驗',
    '15705': '農田灌溉排水-管路灌溉',
    '16100': '製茶技術', '16400': '車輛塗裝', '16500': '工程泵類檢修',
    '16600': '用電設備檢驗', '16700': '變電設備裝修',
    '16800': '輸電地下電纜裝修', '16900': '輸電架空線路裝修',
    '17000': '機電整合', '17100': '裝潢木工', '17200': '網路架設',
    '17300': '網頁設計', '17500': '混凝土', '17600': '飛機修護',
    '17700': '手語翻譯', '17800': '照顧服務員',
    '18000': '營造工程管理', '18100': '門市服務',
    '18200': '銑床', '18201': '銑床-CNC銑床',
    '18300': '車床', '18301': '車床-CNC車床',
    '18400': '模具', '18401': '模具-沖壓模具', '18402': '模具-塑膠射出模具',
    '18500': '機械加工',
    '19000': '地錨', '19200': '網版製版印刷', '19500': '就業服務',
    '19800': '高壓氣體特定設備操作', '19900': '高壓氣體容器操作',
    '20000': '國貿業務', '20100': '視覺傳達設計',
    '20200': '鋼管施工架', '20300': '喪禮服務', '20400': '攝影',
    '20500': '下水道用戶排水設備配管', '20600': '飲料調製',
    '20701': '金屬帷幕牆-帷幕牆項',
    '20800': '電腦輔助機械設計製圖', '20900': '定向行動訓練',
    '21000': '太陽光電設置',
    '21100': '建築製圖應用',
    '21101': '建築製圖應用-電腦繪圖', '21102': '建築製圖應用-手繪圖',
    '21300': '陶瓷手拉杯', '21400': '金屬成形',
    '21500': '餐飲服務', '21600': '旅館客房服務',
    '21800': '食物製備',
    '22200': '職業安全衛生管理',
    '22300': '物理性因子作業環境監測', '22400': '化學性因子作業環境監測',
    '22600': '民俗調理業傳統整復推拿', '22700': '民俗調理腳底按摩'
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
  // 字母對應值（標準字母表順序）：
  // A=10, B=11, C=12, D=13, E=14, F=15, G=16, H=17, I=34, J=18, K=19,
  // L=20, M=21, N=22, O=35, P=23, Q=24, R=25, S=26, T=27, U=28,
  // V=29, W=32, X=30, Y=31, Z=33
  function validateROC(id) {
    var letterMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
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

      // 只針對「測驗日期」與「報到時間」強調（hl:true），其他欄位維持正常
      var fields = [
        { label: '職類 / 級別', value: occ, icon: '📚', hl: false },
        { label: '准考證號', value: cert ? String(cert).trim() : '-', icon: '🎫', hl: false },
        { label: '報到時間', value: checkinTime, icon: '🚶', hl: true },
      ];

      // 學科：所有人都考（含免術科者）
      fields.push({ label: '學科測驗日期', value: formatROCDate(item.writtenDate) || '待公告', icon: '📅', hl: true });
      fields.push({ label: '學科測驗時間', value: item.writtenTime || '待公告', icon: '⏰', hl: false });
      fields.push({ label: '學科測驗教室', value: item.writtenRoom || '龍井教室 2 樓即測即評學科電腦教室', icon: '🏫', hl: false });
      if (item.writtenSession) fields.push({ label: '學科場次', value: item.writtenSession, icon: '🎟️', hl: false });
      if (item.writtenSeat) fields.push({ label: '學科座號', value: item.writtenSeat, icon: '💺', hl: false });

      // 術科：免術科者 (mode.code === 'B') 不顯示術科
      if (mode.code !== 'B') {
        fields.push({ label: '術科測驗日期', value: formatROCDate(item.practicalDate) || '待公告', icon: '📅', hl: true });
        fields.push({ label: '術科測驗時間', value: item.practicalTime || '待公告', icon: '⏰', hl: false });
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
