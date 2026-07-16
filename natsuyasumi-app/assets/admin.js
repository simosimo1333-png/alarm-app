// 夏休み調整アプリ — 管理画面(セットアップ / メンバー / 業務予定 / 設定 / 組織)

let adminPin = sessionStorage.getItem('natsu_admin_pin') || '';
let data = null;

const $ = (id) => document.getElementById(id);
const content = () => $('content');

init();

async function init() {
  await refresh();
}

async function refresh() {
  let res;
  try {
    res = await fetch('./api/data').then((r) => r.json());
  } catch {
    return renderNotice('読み込みに失敗しました。時間をおいて再読み込みしてください。');
  }
  if (res.error === 'DB_NOT_CONNECTED') return renderDbMissing();
  if (!res.ok) return renderNotice(res.message || 'エラーが発生しました。');
  if (!res.ready) return renderSetup();

  data = res;
  if (!adminPin) return renderGate();
  renderDashboard();
}

/* ---------- API ヘルパー ---------- */
async function admin(action, params = {}) {
  const res = await fetch('./api/admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, adminPin, ...params }),
  }).then((r) => r.json()).catch(() => ({ ok: false, message: '通信に失敗しました。' }));
  return res;
}

/* ---------- 画面: DB未接続 ---------- */
function renderDbMissing() {
  content().innerHTML = `<div class="card">
    <h2>データベースの接続待ち</h2>
    <p>Vercel でこのプロジェクトを開き、<b>Storage → Create Database → Neon (Postgres)</b> を接続してください。
    接続後にこの画面を再読み込みすると、初期セットアップに進めます。</p>
    <button class="btn" onclick="location.reload()">再読み込み</button>
  </div>`;
}

/* ---------- 画面: 初期セットアップ ---------- */
function renderSetup() {
  content().innerHTML = `<div class="card">
    <h2>初期セットアップ</h2>
    <p>管理用のPIN(4桁)を決めてください。以降、管理画面を開くときに使います。<br>
    セットアップすると、テーブルの作成と「課A・課B」の登録が行われます。</p>
    <div class="field"><label>管理用PIN</label><input id="p1" inputmode="numeric" maxlength="4" placeholder="4桁"></div>
    <div class="field"><label>もう一度</label><input id="p2" inputmode="numeric" maxlength="4" placeholder="4桁"></div>
    <button class="btn primary" id="doSetup">セットアップを実行</button>
  </div>`;
  $('doSetup').onclick = async () => {
    const p1 = $('p1').value, p2 = $('p2').value;
    if (!/^\d{4}$/.test(p1)) return toast('PINは4桁の数字で入力してください。', true);
    if (p1 !== p2) return toast('2つのPINが一致しません。', true);
    const res = await admin('setup', { adminPin: p1 });
    if (!res.ok) return toast(res.message || 'セットアップに失敗しました。', true);
    adminPin = p1; sessionStorage.setItem('natsu_admin_pin', adminPin);
    toast('セットアップ完了しました。');
    await refresh();
  };
}

/* ---------- 画面: 管理PINゲート ---------- */
function renderGate() {
  content().innerHTML = `<div class="card">
    <h2>管理用PIN</h2>
    <div class="field"><label>PIN</label><input id="gpin" inputmode="numeric" maxlength="4" placeholder="4桁"></div>
    <button class="btn primary" id="gEnter">ひらく</button>
  </div>`;
  $('gpin').onkeydown = (e) => { if (e.key === 'Enter') $('gEnter').click(); };
  $('gpin').focus();
  $('gEnter').onclick = async () => {
    const pin = $('gpin').value;
    if (!/^\d{4}$/.test(pin)) return toast('4桁のPINを入力してください。', true);
    adminPin = pin;
    const res = await admin('ping');
    if (!res.ok) { adminPin = ''; return toast(res.message || 'PINが違います。', true); }
    sessionStorage.setItem('natsu_admin_pin', adminPin);
    renderDashboard();
  };
}

/* ---------- 画面: ダッシュボード ---------- */
function renderDashboard() {
  const orgs = data.organizations;
  const orgOptions = (sel) => orgs.map((o) => `<option value="${o.id}" ${sel === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  const membersByOrg = new Map();
  for (const m of data.members) {
    if (!membersByOrg.has(m.org_id)) membersByOrg.set(m.org_id, []);
    membersByOrg.get(m.org_id).push(m);
  }

  // メンバー表
  let memberRows = '';
  for (const o of orgs) {
    for (const m of (membersByOrg.get(o.id) || [])) {
      memberRows += `<tr data-id="${m.id}">
        <td><input class="m-name" value="${esc(m.name)}" style="width:110px"></td>
        <td><select class="m-org">${orgOptions(m.org_id)}</select></td>
        <td><select class="m-role">
          ${['課長', '係長', '係員'].map((r) => `<option ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select></td>
        <td>${m.pin_set ? '<span class="pin-ok">設定済</span>' : '<span class="pin-no">未設定</span>'}</td>
        <td class="actions row-actions">
          <button class="btn btn-sm m-save">保存</button>
          <button class="btn btn-sm m-pin">PIN</button>
          <button class="btn btn-sm danger m-del">削除</button>
        </td></tr>`;
    }
  }

  // 業務予定表
  let eventRows = '';
  const orgName = (id) => id ? (orgs.find((o) => o.id === id)?.name ?? '') : '全体';
  for (const ev of data.events) {
    const range = ev.start_date === ev.end_date ? ev.start_date : `${ev.start_date}〜${ev.end_date}`;
    eventRows += `<tr data-id="${ev.id}">
      <td>${esc(ev.title)}</td><td>${esc(orgName(ev.org_id))}</td><td>${range}</td>
      <td class="actions"><button class="btn btn-sm danger e-del">削除</button></td></tr>`;
  }

  const s = data.settings;
  content().innerHTML = `
    <div class="card">
      <h2>メンバー <span class="hint">(名前・課・役職を変えたら「保存」)</span></h2>
      <table class="tbl"><thead><tr><th>名前</th><th>課</th><th>役職</th><th>PIN</th><th></th></tr></thead>
      <tbody id="memberBody">${memberRows || '<tr><td colspan="5" class="hint">まだいません。下から追加してください。</td></tr>'}</tbody></table>
      <div class="inline-add">
        <input id="nm-name" type="text" placeholder="名前">
        <select id="nm-org">${orgOptions()}</select>
        <select id="nm-role">${['係員', '課長', '係長'].map((r) => `<option>${r}</option>`).join('')}</select>
        <input id="nm-pin" inputmode="numeric" maxlength="4" placeholder="PIN(任意)" style="width:110px">
        <button class="btn primary btn-sm" id="addMember">＋ 追加</button>
      </div>
    </div>

    <div class="card">
      <h2>業務予定</h2>
      <table class="tbl"><thead><tr><th>タイトル</th><th>対象</th><th>日付</th><th></th></tr></thead>
      <tbody id="eventBody">${eventRows || '<tr><td colspan="4" class="hint">まだありません。</td></tr>'}</tbody></table>
      <div class="inline-add">
        <input id="ne-title" type="text" placeholder="例: A社納品 締切">
        <select id="ne-org"><option value="">全体</option>${orgOptions()}</select>
        <label class="hint">開始</label><input id="ne-start" type="date" value="${s.periodStart}">
        <label class="hint">終了</label><input id="ne-end" type="date" value="${s.periodStart}">
        <button class="btn primary btn-sm" id="addEvent">＋ 追加</button>
      </div>
    </div>

    <div class="card">
      <h2>設定</h2>
      <div class="field"><label>年度</label><input id="st-year" inputmode="numeric" value="${s.year}" style="width:90px"></div>
      <div class="field"><label>対象期間</label>
        <input id="st-start" type="date" value="${s.periodStart}"> 〜 <input id="st-end" type="date" value="${s.periodEnd}"></div>
      <div class="field"><label>1人の上限</label><input id="st-max" inputmode="numeric" value="${s.maxConfirmedDays}" style="width:70px"> 日(確定できる日数)</div>
      <button class="btn primary btn-sm" id="saveSettings">設定を保存</button>
    </div>

    <div class="card">
      <h2>組織(課) <span class="hint">将来: 部＞課＞係の追加にも対応</span></h2>
      <table class="tbl"><thead><tr><th>名前</th><th>種別</th><th></th></tr></thead>
      <tbody id="orgBody">${orgs.map((o) => `<tr data-id="${o.id}">
        <td><input class="o-name" value="${esc(o.name)}" style="width:130px"></td>
        <td>${o.kind}</td>
        <td class="actions row-actions">
          <button class="btn btn-sm o-save">保存</button>
          <button class="btn btn-sm danger o-del">削除</button>
        </td></tr>`).join('')}</tbody></table>
      <div class="inline-add">
        <input id="no-name" type="text" placeholder="組織名(例: 課C)">
        <select id="no-kind">${['課', '部', '係'].map((k) => `<option>${k}</option>`).join('')}</select>
        <button class="btn primary btn-sm" id="addOrg">＋ 追加</button>
      </div>
    </div>

    <div class="card">
      <h2>管理用PINの変更</h2>
      <div class="field"><label>新しいPIN</label><input id="ap1" inputmode="numeric" maxlength="4" placeholder="4桁"></div>
      <button class="btn btn-sm" id="changeAdmin">変更する</button>
    </div>`;

  bindDashboard();
}

function bindDashboard() {
  // メンバー追加
  $('addMember').onclick = async () => {
    const res = await admin('addMember', {
      orgId: Number($('nm-org').value), name: $('nm-name').value,
      role: $('nm-role').value, pin: $('nm-pin').value || undefined,
    });
    done(res, 'メンバーを追加しました。');
  };
  // メンバー行の操作
  $('memberBody').querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('.m-save')?.addEventListener('click', async () => {
      const res = await admin('updateMember', {
        memberId: id, name: tr.querySelector('.m-name').value,
        orgId: Number(tr.querySelector('.m-org').value), role: tr.querySelector('.m-role').value,
      });
      done(res, '保存しました。');
    });
    tr.querySelector('.m-pin')?.addEventListener('click', async () => {
      const p = prompt('新しいPIN(4桁)を入力してください:');
      if (p == null) return;
      if (!/^\d{4}$/.test(p)) return toast('4桁の数字を入力してください。', true);
      const res = await admin('setMemberPin', { memberId: id, newPin: p });
      done(res, 'PINを設定しました。');
    });
    tr.querySelector('.m-del')?.addEventListener('click', async () => {
      if (!confirm('このメンバーを削除しますか?(希望も消えます)')) return;
      const res = await admin('deleteMember', { memberId: id });
      done(res, '削除しました。');
    });
  });

  // 業務予定
  $('addEvent').onclick = async () => {
    const res = await admin('addEvent', {
      title: $('ne-title').value, orgId: $('ne-org').value || null,
      startDate: $('ne-start').value, endDate: $('ne-end').value,
    });
    done(res, '業務予定を追加しました。');
  };
  $('eventBody').querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.querySelector('.e-del')?.addEventListener('click', async () => {
      const res = await admin('deleteEvent', { eventId: Number(tr.dataset.id) });
      done(res, '削除しました。');
    });
  });

  // 設定
  $('saveSettings').onclick = async () => {
    const res = await admin('updateSettings', {
      year: Number($('st-year').value), periodStart: $('st-start').value,
      periodEnd: $('st-end').value, maxConfirmedDays: Number($('st-max').value),
    });
    done(res, '設定を保存しました。');
  };

  // 組織
  $('addOrg').onclick = async () => {
    const res = await admin('addOrg', { name: $('no-name').value, kind: $('no-kind').value });
    done(res, '組織を追加しました。');
  };
  $('orgBody').querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('.o-save')?.addEventListener('click', async () => {
      const res = await admin('updateOrg', { orgId: id, name: tr.querySelector('.o-name').value });
      done(res, '保存しました。');
    });
    tr.querySelector('.o-del')?.addEventListener('click', async () => {
      if (!confirm('この組織を削除しますか?')) return;
      const res = await admin('deleteOrg', { orgId: id });
      done(res, '削除しました。');
    });
  });

  // 管理PIN変更
  $('changeAdmin').onclick = async () => {
    const p = $('ap1').value;
    if (!/^\d{4}$/.test(p)) return toast('4桁の数字を入力してください。', true);
    const res = await admin('changeAdminPin', { newPin: p });
    if (!res.ok) return toast(res.message || '変更に失敗しました。', true);
    adminPin = p; sessionStorage.setItem('natsu_admin_pin', adminPin);
    toast('管理用PINを変更しました。');
  };
}

async function done(res, okMsg) {
  if (!res.ok) return toast(res.message || 'エラーが発生しました。', true);
  toast(okMsg);
  await refresh();
}

function renderNotice(msg) {
  content().innerHTML = `<div class="card"><h2>お知らせ</h2><p>${esc(msg)}</p>
    <button class="btn" onclick="location.reload()">再読み込み</button></div>`;
}

/* ---------- ユーティリティ ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}
