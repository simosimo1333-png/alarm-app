// 夏休み調整アプリ — メイン画面(カレンダー / 日別詳細 / 入力)
import { STATUS_ORDER, aggregateDay as calcAggregate, computeWarnings, remainingDays, eventsForDay as calcEvents } from './logic.js';

const PILL_CLASS = { '確定': 'confirm', '◎': 'maru2', '○': 'maru', '△': 'sankaku' };
const STATUS_LABEL = { '確定': '● 確定', '◎': '◎ 絶対', '○': '○ できれば', '△': '△ 候補' };

const state = {
  data: null,          // /api/data の結果
  month: null,         // { y, m } 表示中の月(m は 1-12)
  filterOrg: 'all',    // 'all' | orgId(number)
  meId: null,          // 選択中メンバーID
  pin: '',             // 入力中PIN(メモリ)
  inputMode: false,
  openDay: null,       // 日別詳細で開いている 'YYYY-MM-DD'
};

const $ = (id) => document.getElementById(id);

init();

async function init() {
  bindStaticEvents();
  await load();
}

async function load() {
  let res;
  try {
    res = await fetch('./api/data').then((r) => r.json());
  } catch (err) {
    return showNotice(connErrorHtml());
  }
  if (res.error === 'DB_NOT_CONNECTED') return showNotice(dbMissingHtml());
  if (!res.ok) return showNotice(genericErrorHtml(res.message));
  if (!res.ready) return showNotice(setupNeededHtml());

  state.data = res;
  clearNotice();
  setupAfterLoad();
}

function setupAfterLoad() {
  // 表示月を対象期間の開始月に
  const [sy, sm] = state.data.settings.periodStart.split('-').map(Number);
  if (!state.month) state.month = { y: sy, m: sm };

  // 記憶していた「わたし」を復元
  const savedMe = Number(localStorage.getItem('natsu_me'));
  if (savedMe && state.data.members.some((m) => m.id === savedMe)) state.meId = savedMe;

  buildFilters();
  buildMeSelect();
  $('meArea').hidden = false;
  $('inputModeBtn').hidden = false;
  $('filters').hidden = false;
  $('mainArea').hidden = false;
  renderAll();
}

/* ---------- ヘッダー: 課フィルタ / わたし選択 ---------- */
function buildFilters() {
  const wrap = $('filters');
  wrap.innerHTML = '';
  const mk = (label, val) => {
    const b = document.createElement('button');
    b.className = 'chip' + (String(state.filterOrg) === String(val) ? ' on' : '');
    b.textContent = label;
    b.onclick = () => { state.filterOrg = val; renderAll(); };
    return b;
  };
  wrap.appendChild(mk('全員', 'all'));
  for (const o of state.data.organizations) wrap.appendChild(mk(o.name, o.id));
}

function buildMeSelect() {
  const sel = $('meSelect');
  sel.innerHTML = '<option value="">(選んでください)</option>';
  const byOrg = groupBy(state.data.members, (m) => m.org_id);
  for (const o of state.data.organizations) {
    const grp = document.createElement('optgroup');
    grp.label = o.name;
    for (const m of (byOrg.get(o.id) || [])) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name}(${m.role})`;
      grp.appendChild(opt);
    }
    sel.appendChild(grp);
  }
  sel.value = state.meId || '';
}

/* ---------- レンダリング ---------- */
function renderAll() {
  buildFilters();
  renderDow();
  renderCalendar();
  renderRemaining();
  refreshInputModeBtn();
  if (state.openDay) renderSheet(state.openDay);
}

function renderDow() {
  const row = $('dowRow');
  if (row.childElementCount) return;
  const names = ['日', '月', '火', '水', '木', '金', '土'];
  names.forEach((n, i) => {
    const d = document.createElement('div');
    d.className = 'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    d.textContent = n;
    row.appendChild(d);
  });
}

function renderCalendar() {
  const { y, m } = state.month;
  $('monthLabel').textContent = `${y}年 ${m}月`;
  const grid = $('calGrid');
  grid.innerHTML = '';

  const first = new Date(y, m - 1, 1);
  const startPad = first.getDay();
  const dim = new Date(y, m, 0).getDate();
  const { periodStart, periodEnd } = state.data.settings;
  const today = todayStr();

  for (let i = 0; i < startPad; i++) {
    const b = document.createElement('div');
    b.className = 'cell blank';
    grid.appendChild(b);
  }

  for (let d = 1; d <= dim; d++) {
    const day = ymd(y, m, d);
    const cell = document.createElement('div');
    const inPeriod = day >= periodStart && day <= periodEnd;
    cell.className = 'cell' + (inPeriod ? '' : ' out');
    if (day === today) cell.classList.add('today');

    const dnum = document.createElement('div');
    dnum.className = 'dnum';
    const wd = new Date(y, m - 1, d).getDay();
    dnum.innerHTML = wd === 0 ? `<span class="sun">${d}</span>` : String(d);
    cell.appendChild(dnum);

    if (inPeriod) {
      const agg = aggregateDay(day);
      // 警告
      const warns = warningsForDay(day);
      const events = eventsForDay(day);
      if (warns.length) cell.classList.add('warn');

      const marks = document.createElement('div');
      marks.className = 'marks';
      if (events.length) marks.appendChild(textSpan('📌'));
      if (warns.length) marks.appendChild(textSpan('⚠️'));
      cell.appendChild(marks);

      const badges = document.createElement('div');
      badges.className = 'badges';
      for (const st of STATUS_ORDER) {
        if (agg.counts[st]) {
          const p = document.createElement('span');
          p.className = 'pill ' + PILL_CLASS[st];
          p.textContent = `${stMark(st)}${agg.counts[st]}`;
          badges.appendChild(p);
        }
      }
      cell.appendChild(badges);

      if (state.meId && agg.mine) cell.classList.add('mine-here');
      cell.onclick = () => openDay(day);
    }
    grid.appendChild(cell);
  }
}

function renderRemaining() {
  const el = $('remaining');
  const r = remainingDays(state.meId, state.data.requests, state.data.settings.maxConfirmedDays);
  if (!r) { el.textContent = ''; return; }
  el.textContent = `残り ${r.left}/${r.max}日`;
  el.classList.toggle('zero', r.left <= 0);
}

/* ---------- 日別詳細シート ---------- */
function openDay(day) {
  state.openDay = day;
  renderSheet(day);
  $('sheet').classList.add('show');
  $('backdrop').classList.add('show');
}
function closeSheet() {
  state.openDay = null;
  $('sheet').classList.remove('show');
  $('backdrop').classList.remove('show');
}

function renderSheet(day) {
  const body = $('sheetBody');
  const membersById = new Map(state.data.members.map((m) => [m.id, m]));
  const orgsById = new Map(state.data.organizations.map((o) => [o.id, o]));
  const warns = warningsForDay(day);
  const events = eventsForDay(day);

  let html = `<h3>${formatJp(day)}</h3>`;

  for (const w of warns) {
    html += `<div class="warnbox"><b>⚠️ ${escapeHtml(w)}</b><br>→ 口頭で確認してください。</div>`;
  }

  // 状態ごとに、フィルタ対象のメンバーを列挙
  const reqs = state.data.requests.filter((r) => r.day === day && passesFilter(membersById.get(r.member_id)));
  for (const st of STATUS_ORDER) {
    const list = reqs.filter((r) => r.status === st);
    if (!list.length) continue;
    html += `<div class="rowline"><span class="lab">${STATUS_LABEL[st]}</span>`;
    for (const r of list) {
      const m = membersById.get(r.member_id);
      if (!m) continue;
      const memo = r.memo ? ` <span class="hint">(${escapeHtml(r.memo)})</span>` : '';
      html += `<span class="name-tag">${escapeHtml(m.name)}<span class="role"> ${escapeHtml(m.role)}</span></span>${memo}`;
    }
    html += `</div>`;
  }
  if (!reqs.length) html += `<div class="rowline hint">この日の希望はまだありません。</div>`;

  for (const ev of events) {
    const org = ev.org_id ? (orgsById.get(ev.org_id)?.name ?? '') : '全体';
    html += `<div class="rowline"><span class="lab">📌 業務</span><span class="ev">${escapeHtml(ev.title)}</span> <span class="hint">(${escapeHtml(org)})</span></div>`;
  }

  // 入力パネル(入力モード + わたし選択済み)
  if (state.inputMode && state.meId) {
    const mine = state.data.requests.find((r) => r.member_id === state.meId && r.day === day);
    const cur = mine ? mine.status : 'none';
    const opts = ['none', '△', '○', '◎', '確定'];
    html += `<div class="input-panel"><b>${escapeHtml(membersById.get(state.meId)?.name ?? '')}さんの希望</b>`;
    html += `<div class="status-btns">`;
    for (const st of opts) {
      const label = st === 'none' ? 'なし' : STATUS_LABEL[st] || st;
      html += `<button class="sb${cur === st ? ' active' : ''}" data-st="${st}" data-day="${day}">${label}</button>`;
    }
    html += `</div><div class="memo-row"><input id="memoInput" maxlength="30" placeholder="メモ(任意 例: 子どもの行事)" value="${escapeHtml(mine?.memo || '')}"><button class="btn btn-sm" id="memoSave">メモ保存</button></div></div>`;
  } else if (!state.inputMode) {
    html += `<div class="rowline hint">自分の希望を入れるには、右上の「✏️ 入力モード」をオンにしてください。</div>`;
  } else if (!state.meId) {
    html += `<div class="rowline hint">「わたし」を選ぶと入力できます。</div>`;
  }

  body.innerHTML = html;

  body.querySelectorAll('.sb').forEach((b) => {
    b.onclick = () => setMyStatus(b.dataset.day, b.dataset.st);
  });
  const memoSave = $('memoSave');
  if (memoSave) {
    memoSave.onclick = () => {
      const mine = state.data.requests.find((r) => r.member_id === state.meId && r.day === day);
      if (!mine) return toast('先に状態(△○◎確定)を選んでください。', true);
      setMyStatus(day, mine.status, $('memoInput').value);
    };
  }
}

/* ---------- 書き込み ---------- */
async function setMyStatus(day, status, memo) {
  if (!state.meId) return toast('「わたし」を選んでください。', true);
  if (!/^\d{4}$/.test(state.pin)) return toast('PIN(4桁)を入力してください。', true);

  const existing = state.data.requests.find((r) => r.member_id === state.meId && r.day === day);
  const payload = {
    memberId: state.meId, pin: state.pin, day, status,
    memo: memo != null ? memo : (existing?.memo || ''),
  };
  let res;
  try {
    res = await fetch('./api/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
  } catch {
    return toast('通信に失敗しました。', true);
  }
  if (!res.ok) {
    if (res.error === 'PIN_MISMATCH') { toast('PINが違います。', true); }
    else toast(res.message || 'エラーが発生しました。', true);
    return;
  }
  // ローカル状態を更新して再描画(全件取得し直さず軽量に)
  applyLocalChange(day, status, payload.memo);
  toast('保存しました。');
  renderAll();
}

function applyLocalChange(day, status, memo) {
  const reqs = state.data.requests;
  const idx = reqs.findIndex((r) => r.member_id === state.meId && r.day === day);
  if (status === 'none') {
    if (idx >= 0) reqs.splice(idx, 1);
  } else if (idx >= 0) {
    reqs[idx].status = status; reqs[idx].memo = memo;
  } else {
    reqs.push({ id: Date.now(), member_id: state.meId, day, status, memo });
  }
}

/* ---------- 集計・警告ロジック(共有 logic.js を利用) ---------- */
function aggregateDay(day) {
  return calcAggregate(day, state.data, state.filterOrg, state.meId);
}
function warningsForDay(day) {
  return computeWarnings(day, state.data);
}
function eventsForDay(day) {
  return calcEvents(day, state.data.events);
}

/* ---------- 入力モード ---------- */
function toggleInputMode() {
  if (!state.meId) return toast('先に「わたし」を選んでください。', true);
  state.inputMode = !state.inputMode;
  $('pinArea').hidden = !state.inputMode;
  refreshInputModeBtn();
  if (state.inputMode) {
    const saved = localStorage.getItem('natsu_pin_' + state.meId);
    if (saved) { state.pin = saved; $('pinInput').value = saved; $('pinRemember').checked = true; }
    $('pinInput').focus();
  }
  if (state.openDay) renderSheet(state.openDay);
}
function refreshInputModeBtn() {
  const b = $('inputModeBtn');
  b.classList.toggle('on', state.inputMode);
  b.textContent = state.inputMode ? '✏️ 入力中(オフにする)' : '✏️ 入力モード';
}

/* ---------- イベント束ね ---------- */
function bindStaticEvents() {
  $('prevBtn').onclick = () => shiftMonth(-1);
  $('nextBtn').onclick = () => shiftMonth(1);
  $('sheetClose').onclick = closeSheet;
  $('backdrop').onclick = closeSheet;
  $('inputModeBtn').onclick = toggleInputMode;
  $('meSelect').onchange = (e) => {
    state.meId = Number(e.target.value) || null;
    if (state.meId) localStorage.setItem('natsu_me', String(state.meId));
    state.inputMode = false; state.pin = ''; $('pinArea').hidden = true;
    renderAll();
    if (state.openDay) renderSheet(state.openDay);
  };
  $('pinInput').oninput = (e) => {
    state.pin = e.target.value.replace(/\D/g, '').slice(0, 4);
    e.target.value = state.pin;
    if ($('pinRemember').checked && state.pin.length === 4) {
      localStorage.setItem('natsu_pin_' + state.meId, state.pin);
    }
  };
  $('pinRemember').onchange = (e) => {
    if (!state.meId) return;
    if (e.target.checked && state.pin.length === 4) localStorage.setItem('natsu_pin_' + state.meId, state.pin);
    else localStorage.removeItem('natsu_pin_' + state.meId);
  };
}

function shiftMonth(delta) {
  let { y, m } = state.month;
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  state.month = { y, m };
  renderCalendar();
}

/* ---------- 状態メッセージ ---------- */
function showNotice(html) {
  $('mainArea').hidden = true;
  $('meArea').hidden = true;
  $('inputModeBtn').hidden = true;
  $('filters').hidden = true;
  $('noticeArea').innerHTML = `<div class="notice">${html}</div>`;
}
function clearNotice() { $('noticeArea').innerHTML = ''; }

function dbMissingHtml() {
  return `<h2>データベースの接続待ちです</h2>
    <p>アプリを使うには、Vercel で Neon(データベース)を接続する必要があります。</p>
    <ol>
      <li>Vercel でこのプロジェクトを開く</li>
      <li><b>Storage</b> タブ → <b>Create Database</b> → <b>Neon (Postgres)</b> を接続</li>
      <li>接続後、この画面を再読み込み → <a class="textlink" href="./admin.html">管理画面</a>で初期セットアップ</li>
    </ol>`;
}
function setupNeededHtml() {
  return `<h2>初期セットアップが必要です</h2>
    <p>データベースはつながっています。次に初期設定を行ってください。</p>
    <p><a class="textlink" href="./admin.html">⚙️ 管理画面をひらいてセットアップする</a></p>`;
}
function connErrorHtml() {
  return `<h2>読み込みに失敗しました</h2><p>時間をおいて再読み込みしてください。</p>`;
}
function genericErrorHtml(msg) {
  return `<h2>エラー</h2><p>${escapeHtml(msg || '不明なエラー')}</p>`;
}

/* ---------- ユーティリティ ---------- */
function memberOf(id) { return state.data.members.find((m) => m.id === id); }
function passesFilter(m) { return m && (state.filterOrg === 'all' || m.org_id === Number(state.filterOrg)); }
function stMark(st) { return st === '確定' ? '●' : st; }
function ymd(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function todayStr() { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function formatJp(day) {
  const [y, m, d] = day.split('-').map(Number);
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${w})`;
}
function groupBy(arr, keyFn) {
  const map = new Map();
  for (const x of arr) { const k = keyFn(x); if (!map.has(k)) map.set(k, []); map.get(k).push(x); }
  return map;
}
function textSpan(t) { const s = document.createElement('span'); s.textContent = t; return s; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}
