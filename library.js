const APPKEY = '02c3abe21b0c6264bab61906b732e2cc';
const API_BASE = 'https://api.calil.jp';

const locateBtn = document.getElementById('locate-btn');
const prefSelect = document.getElementById('pref-select');
const cityInput = document.getElementById('city-input');
const prefSearchBtn = document.getElementById('pref-search-btn');
const statusEl = document.getElementById('status');
const libraryListEl = document.getElementById('library-list');
const bookSection = document.getElementById('book-section');
const selectedLibName = document.getElementById('selected-lib-name');
const isbnInput = document.getElementById('isbn-input');
const isbnBtn = document.getElementById('isbn-btn');
const bookResult = document.getElementById('book-result');

let selectedLib = null;

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.classList.remove('hidden');
}

function hideStatus() {
  statusEl.classList.add('hidden');
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'calil_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('タイムアウト'));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => { cleanup(); reject(new Error('通信エラー')); };
    document.head.appendChild(script);
  });
}

async function fetchLibraries(params) {
  const query = new URLSearchParams({ appkey: APPKEY, ...params, limit: 20 });
  return jsonp(`${API_BASE}/library?${query}`);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderLibraries(libs, userLat, userLng) {
  libraryListEl.innerHTML = '';
  if (!libs || libs.length === 0) {
    libraryListEl.innerHTML = '<p style="color:#888;text-align:center;padding:12px;">図書館が見つかりませんでした</p>';
    return;
  }

  libs.forEach(lib => {
    const card = document.createElement('div');
    card.className = 'lib-card';

    let distHtml = '';
    if (userLat != null && lib.geocode) {
      const [lngStr, latStr] = lib.geocode.split(',');
      const dist = haversineKm(userLat, userLng, parseFloat(latStr), parseFloat(lngStr));
      distHtml = `<div class="lib-dist">約 ${dist.toFixed(1)} km</div>`;
    }

    card.innerHTML = `
      <div class="lib-name">${lib.formal}</div>
      <div class="lib-addr">${lib.address || '住所不明'}</div>
      ${distHtml}
    `;

    card.addEventListener('click', () => {
      document.querySelectorAll('.lib-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedLib = lib;
      selectedLibName.textContent = lib.formal;
      bookSection.classList.remove('hidden');
      bookResult.innerHTML = '';
    });

    libraryListEl.appendChild(card);
  });
}

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showStatus('お使いのブラウザは位置情報に対応していません', true);
    return;
  }
  showStatus('位置情報を取得中…');
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const { latitude: lat, longitude: lng } = coords;
      showStatus('図書館を検索中…');
      try {
        const libs = await fetchLibraries({ geocode: `${lng},${lat}` });
        hideStatus();
        renderLibraries(libs, lat, lng);
      } catch (e) {
        showStatus('検索に失敗しました: ' + e.message, true);
      }
    },
    (err) => {
      showStatus('位置情報の取得に失敗しました: ' + err.message, true);
    }
  );
});

prefSearchBtn.addEventListener('click', async () => {
  const pref = prefSelect.value;
  const city = cityInput.value.trim();
  if (!pref) {
    showStatus('都道府県を選択してください', true);
    return;
  }
  showStatus('図書館を検索中…');
  try {
    const params = { pref };
    if (city) params.city = city;
    const libs = await fetchLibraries(params);
    hideStatus();
    renderLibraries(libs, null, null);
  } catch (e) {
    showStatus('検索に失敗しました: ' + e.message, true);
  }
});

isbnBtn.addEventListener('click', async () => {
  const isbn = isbnInput.value.trim().replace(/-/g, '');
  if (!isbn) return;
  if (!selectedLib) {
    bookResult.innerHTML = '<p style="color:#888">先に図書館を選択してください</p>';
    return;
  }

  bookResult.innerHTML = '<p style="color:#aaa">検索中…</p>';

  try {
    await pollBookAvailability(isbn, selectedLib.systemid);
  } catch (e) {
    bookResult.innerHTML = `<p class="book-status avail-none">エラー: ${e.message}</p>`;
  }
});

async function pollBookAvailability(isbn, systemid) {
  const query = new URLSearchParams({
    appkey: APPKEY,
    isbn,
    systemid,
    format: 'json',
  });

  async function fetchCheck(session) {
    const params = session
      ? new URLSearchParams({ appkey: APPKEY, session, format: 'json' })
      : query;
    return jsonp(`${API_BASE}/check?${params}`);
  }

  let data = await fetchCheck(null);

  while (data.continue === 1) {
    await new Promise(r => setTimeout(r, 2000));
    data = await fetchCheck(data.session);
  }

  renderBookResult(data, isbn, systemid);
}

const STATUS_LABELS = {
  'OK':      { label: '貸出可能',   cls: 'avail-ok' },
  'Running': { label: '確認中…',    cls: 'avail-wait' },
  'No':      { label: '貸出不可',   cls: 'avail-no' },
  'Exists':  { label: '蔵書あり（貸出状況不明）', cls: 'avail-wait' },
  'Error':   { label: '確認エラー', cls: 'avail-none' },
};

function renderBookResult(data, isbn, systemid) {
  const libs = data[systemid];
  if (!libs) {
    bookResult.innerHTML = '<p class="book-status avail-none">この図書館の情報が取得できませんでした</p>';
    return;
  }

  const bookData = libs[isbn];
  if (!bookData) {
    bookResult.innerHTML = '<p class="book-status avail-none">書籍情報が見つかりませんでした</p>';
    return;
  }

  const status = bookData.status || 'Error';
  const libkeyInfo = bookData.libkey || {};
  const { label, cls } = STATUS_LABELS[status] || { label: status, cls: 'avail-none' };

  let html = `<div class="book-status ${cls}"><strong>${label}</strong></div>`;

  const keys = Object.keys(libkeyInfo);
  if (keys.length > 0) {
    html += '<ul style="margin-top:10px;padding-left:20px;font-size:0.85rem;color:#ccc;">';
    keys.forEach(libkey => {
      html += `<li>${libkey}: ${libkeyInfo[libkey]}</li>`;
    });
    html += '</ul>';
  }

  if (bookData.reserveurl) {
    html += `<a href="${bookData.reserveurl}" target="_blank" rel="noopener"
      style="display:inline-block;margin-top:10px;color:#e94560;font-size:0.85rem;">予約ページへ →</a>`;
  }

  bookResult.innerHTML = html;
}
