// カートレース — モード7風の疑似3Dレーシングゲーム（飛騨地域コース集）
(() => {
  'use strict';

  // ===== 定数 =====
  const W = 750, H = 450;          // 内部解像度（高精細化）
  const HORIZON = 172;             // 地平線のy座標
  const FOCAL = 454;               // 焦点距離（投影スケール）
  const CAM_H = 34;                // カメラの高さ
  const CAM_BACK = 70;             // 自機の何ユニット後ろから見るか
  const TEX = 1400;                // コーステクスチャの一辺（ワールドの広さ）
  const MIP = TEX / 2;             // 遠景用の縮小テクスチャの一辺
  const N_WP = 560;                // ウェイポイント数
  const MM = 180;                  // ミニマップの一辺

  const MAX_SPEED = 285;           // units/s
  const ACCEL = 200;
  const BRAKE = 420;
  const FRICTION = 110;
  const TURN_RATE = 2.6;           // rad/s
  const OFFROAD_MUL = 0.45;
  const BOOST_MUL = 1.45;

  // ===== DOM =====
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const mmCanvas = document.getElementById('minimap');
  const mmCtx = mmCanvas.getContext('2d');
  const hud = document.getElementById('hud');
  const hudPos = document.getElementById('hud-pos');
  const hudLap = document.getElementById('hud-lap');
  const hudTime = document.getElementById('hud-time');
  const hudSpeed = document.getElementById('hud-speed');
  const hudItem = document.getElementById('hud-item');
  const msgEl = document.getElementById('message');
  const panel = document.getElementById('panel');
  const panelText = document.getElementById('panel-text');
  const panelTitle = panel.querySelector('h2');
  const startBtn = document.getElementById('start-btn');
  const resultsEl = document.getElementById('results');
  const courseSelEl = document.getElementById('course-select');

  // ===== コース定義（飛騨地域がテーマ） =====
  const COURSES = [
    {
      name: '飛騨高原サーキット',
      desc: '飛騨の高原を駆け抜ける、ゆったり基本コース。',
      stars: 1, laps: 3, roadW: 132,
      ctrl: [
        [700, 130], [1010, 170], [1230, 330], [1280, 620], [1180, 880],
        [1260, 1130], [1040, 1290], [760, 1230], [520, 1300], [260, 1240],
        [140, 1010], [210, 770], [120, 520], [230, 290], [460, 160],
      ],
      theme: {
        grassA: '#2e7d32', grassB: '#276b2b',
        road: '#5b5b66', curbA: '#d32f2f', curbB: '#f5f5f5',
        line: 'rgba(255,255,255,0.55)',
        skyTop: '#4fc3f7', skyBot: '#c8eefb', fog: '200,238,251',
        ridges: [
          { color: '#9bc4d6', amp: 30, speed: 60, snow: true },
          { color: '#5d8aa0', amp: 20, speed: 110 },
        ],
        deco: [['tree', 6], ['cow', 1]],
      },
    },
    {
      name: '高山 古い町並みGP',
      desc: '城下町・高山の古い町並みを夕暮れにめぐる市街地コース。',
      stars: 2, laps: 3, roadW: 120,
      ctrl: [
        [180, 170], [620, 130], [1090, 160], [1270, 330], [1250, 620],
        [1060, 720], [1040, 950], [1240, 1060], [1230, 1270], [900, 1290],
        [560, 1250], [200, 1280], [130, 1040], [330, 930], [310, 700],
        [140, 600], [150, 360],
      ],
      theme: {
        grassA: '#9c8a72', grassB: '#92805f',
        road: '#45454d', curbA: '#b71c1c', curbB: '#eeeeee',
        line: 'rgba(255,255,255,0.5)',
        skyTop: '#7986cb', skyBot: '#ffcc80', fog: '255,224,178',
        ridges: [
          { color: '#9b8aa8', amp: 26, speed: 60 },
          { color: '#7c6b91', amp: 18, speed: 110 },
        ],
        deco: [['machiya', 4], ['sakagura', 2], ['yatai', 1], ['lantern', 2], ['nakabashi', 1]],
      },
    },
    {
      name: '白川郷 雪のサーキット',
      desc: '合掌造りの里・白川郷をめぐる雪道コース。ところどころ雪のダートですべる！',
      stars: 2, laps: 3, roadW: 128, turnMul: 0.85,
      dirt: { sections: 7, len: 14, mul: 0.68 },
      ctrl: [
        [300, 180], [700, 120], [1100, 180], [1290, 420], [1230, 690],
        [1050, 840], [1130, 1090], [950, 1270], [640, 1300], [330, 1230],
        [150, 1010], [260, 820], [430, 700], [330, 540], [150, 430],
        [170, 250],
      ],
      theme: {
        grassA: '#f2f6f7', grassB: '#e3ecef',
        road: '#62707c', curbA: '#1565c0', curbB: '#ffffff',
        line: 'rgba(255,255,255,0.6)',
        skyTop: '#a6cfe3', skyBot: '#f0f8fc', fog: '240,248,252',
        ridges: [
          { color: '#d4e3ec', amp: 32, speed: 60, snow: true },
          { color: '#aac4d4', amp: 20, speed: 110, snow: true },
        ],
        deco: [['gassho', 3], ['snowtree', 3], ['snowman', 1]],
      },
    },
    {
      name: '乗鞍スカイライン',
      desc: '雲の上を走る天空の山岳道路。ながれるような高速コーナーが続く。',
      stars: 2, laps: 3, roadW: 124,
      ctrl: [
        [260, 160], [660, 110], [1080, 160], [1290, 380], [1240, 650],
        [1070, 800], [1220, 1010], [1130, 1250], [800, 1300], [470, 1240],
        [170, 1280], [120, 1020], [300, 860], [160, 640], [130, 400],
      ],
      theme: {
        grassA: '#6b7d62', grassB: '#5f7057',
        road: '#4c5258', curbA: '#f9a825', curbB: '#ffffff',
        line: 'rgba(255,255,255,0.55)',
        skyTop: '#1565c0', skyBot: '#bbdefb', fog: '227,242,253',
        ridges: [
          { color: '#e3edf4', amp: 42, speed: 60, snow: true },
          { color: '#90a8ba', amp: 26, speed: 110, snow: true },
        ],
        deco: [['rock', 3], ['snowtree', 2], ['goat', 1]],
      },
    },
    {
      name: '奥飛騨 つづら折り峠',
      desc: '紅葉の奥飛騨をのぼる、狭い道とヘアピン連続の難関峠コース。',
      stars: 3, laps: 2, roadW: 106,
      ctrl: [
        [180, 160], [720, 110], [1180, 170],
        [1290, 440], [1230, 800], [1280, 1100], [1060, 1280],
        [620, 1310], [260, 1260],
        [170, 1060], [760, 1000], [900, 840],
        [300, 760], [170, 580], [820, 520],
      ],
      theme: {
        grassA: '#4f7a2e', grassB: '#456c28',
        road: '#50565e', curbA: '#ef6c00', curbB: '#ffffff',
        line: 'rgba(255,255,255,0.55)',
        skyTop: '#5ab0e0', skyBot: '#ffe6c2', fog: '255,230,194',
        ridges: [
          { color: '#8c9fb0', amp: 34, speed: 60, snow: true },
          { color: '#6d8296', amp: 22, speed: 110 },
        ],
        deco: [['autumn', 3], ['tree', 2], ['onsen', 1]],
      },
    },
  ];

  // ===== コースの状態（buildCourseで構築） =====
  let courseIdx = 0;
  let course = COURSES[0];
  let theme = course.theme;
  let LAPS = 3;
  let ROADW = 80;
  let wps = [];          // {x, y, tx, ty} 接線つきウェイポイント
  let texData32 = null;  // Uint32Array (ABGR)
  let mip32 = null;      // 遠景用の縮小テクスチャ（チラつき防止）
  let hasDirt = false;   // 雪のダートがあるコースか
  let outA32 = 0, outB32 = 0; // テクスチャ範囲外の市松色
  let decorations = [];  // 沿道の飾り {x, y, type, size}
  let ridges = [];       // 山並み（パララックス）
  let skyGrad = null;
  let fogGrad = null;
  let hazeGrad = null;

  // オフスクリーンキャンバスとマスクは使い回す
  // （コース切替のたびに作り直すとモバイルでメモリを圧迫してクラッシュする）
  const texCanvas = document.createElement('canvas');
  texCanvas.width = texCanvas.height = TEX;
  const helperCanvas = document.createElement('canvas');
  helperCanvas.width = helperCanvas.height = TEX;
  const mipCanvas = document.createElement('canvas');
  mipCanvas.width = mipCanvas.height = MIP;
  const roadMask = new Uint8Array(TEX * TEX); // 1=道路
  const dirtMask = new Uint8Array(TEX * TEX); // 1=雪のダート

  function abgr(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  // 色を明るく/暗く（スプライトの陰影づけ用）
  function shade(hex, amt) {
    const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + amt));
    const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + amt));
    const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + amt));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // シード付き乱数（対戦時に両者のダート・飾り配置を一致させるため）
  let rngState = 1;
  let courseSeed = 1;
  function srand(s) { rngState = s >>> 0 || 1; }
  function rnd() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
      0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3),
    ];
  }

  function buildTrack(ctrl) {
    wps = [];
    const segs = ctrl.length;
    const per = Math.floor(N_WP / segs);
    for (let s = 0; s < segs; s++) {
      const p0 = ctrl[(s - 1 + segs) % segs];
      const p1 = ctrl[s];
      const p2 = ctrl[(s + 1) % segs];
      const p3 = ctrl[(s + 2) % segs];
      for (let i = 0; i < per; i++) {
        const [x, y] = catmullRom(p0, p1, p2, p3, i / per);
        wps.push({ x, y, tx: 0, ty: 0 });
      }
    }
    // セグメント数で割り切れない分は最後を補間して埋める
    while (wps.length < N_WP) wps.push({ ...wps[wps.length - 1] });
    for (let i = 0; i < N_WP; i++) {
      const a = wps[(i + 1) % N_WP], b = wps[(i - 1 + N_WP) % N_WP];
      const dx = a.x - b.x, dy = a.y - b.y;
      const len = Math.hypot(dx, dy) || 1;
      wps[i].tx = dx / len;
      wps[i].ty = dy / len;
    }
  }

  function tracePath(c) {
    c.beginPath();
    c.moveTo(wps[0].x, wps[0].y);
    for (let i = 1; i < N_WP; i++) c.lineTo(wps[i].x, wps[i].y);
    c.closePath();
  }

  function traceSegment(c, start, len) {
    c.beginPath();
    c.moveTo(wps[start % N_WP].x, wps[start % N_WP].y);
    for (let i = 1; i <= len; i++) {
      const w = wps[(start + i) % N_WP];
      c.lineTo(w.x, w.y);
    }
  }

  // 雪のダート区間を路面の上に描き、判定マスクも作る
  function buildDirt(t) {
    hasDirt = !!course.dirt;
    if (!hasDirt) return;
    const m = helperCanvas.getContext('2d');
    m.fillStyle = '#000';
    m.fillRect(0, 0, TEX, TEX);
    m.lineJoin = m.lineCap = 'round';
    m.strokeStyle = '#fff';
    m.lineWidth = ROADW - 4;

    t.lineJoin = t.lineCap = 'round';
    const n = course.dirt.sections;
    for (let s = 0; s < n; s++) {
      // スタートライン付近（wp 0 前後）は避けて配置
      const start = Math.floor(30 + (s * (N_WP - 70)) / n + rnd() * 14);
      const len = course.dirt.len + Math.floor(rnd() * 5);

      traceSegment(t, start, len);
      t.strokeStyle = '#edf3f6';
      t.lineWidth = ROADW - 4;
      t.stroke();
      // 雪の質感（薄い影のまだら）
      for (let j = 0; j < 40; j++) {
        const w = wps[(start + Math.floor(rnd() * len)) % N_WP];
        const rx = -w.ty, ry = w.tx;
        const lat = (rnd() - 0.5) * (ROADW - 18);
        t.fillStyle = 'rgba(160,180,190,0.5)';
        t.beginPath();
        t.arc(w.x + rx * lat, w.y + ry * lat, 1 + rnd() * 2.5, 0, Math.PI * 2);
        t.fill();
      }

      traceSegment(m, start, len);
      m.stroke();
    }

    const md = m.getImageData(0, 0, TEX, TEX).data;
    for (let i = 0; i < TEX * TEX; i++) dirtMask[i] = md[i * 4] > 128 ? 1 : 0;
  }

  function buildTexture() {
    const t = texCanvas.getContext('2d');

    // 地面（市松模様 + ランダムなまだらで質感を出す）
    for (let y = 0; y < TEX; y += 64) {
      for (let x = 0; x < TEX; x += 64) {
        t.fillStyle = ((x ^ y) & 64) ? theme.grassA : theme.grassB;
        t.fillRect(x, y, 64, 64);
      }
    }
    for (let i = 0; i < 2600; i++) {
      t.fillStyle = (i & 1) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      t.beginPath();
      t.arc(rnd() * TEX, rnd() * TEX, 1 + rnd() * 2.2, 0, Math.PI * 2);
      t.fill();
    }

    t.lineJoin = 'round';
    t.lineCap = 'round';

    // ガードレール（縁石の外側の銀色の帯）
    tracePath(t);
    t.strokeStyle = '#5f676e';
    t.lineWidth = ROADW + 34;
    t.stroke();
    tracePath(t);
    t.strokeStyle = '#c9d0d6';
    t.lineWidth = ROADW + 28;
    t.stroke();

    // 縁石（地色 + 白の破線）
    tracePath(t);
    t.strokeStyle = theme.curbA;
    t.lineWidth = ROADW + 14;
    t.stroke();
    tracePath(t);
    t.strokeStyle = theme.curbB;
    t.lineWidth = ROADW + 14;
    t.setLineDash([18, 18]);
    t.stroke();
    t.setLineDash([]);

    // 路面（アスファルトの粒感を散らす）
    tracePath(t);
    t.strokeStyle = theme.road;
    t.lineWidth = ROADW;
    t.stroke();
    for (let i = 0; i < 2400; i++) {
      const w = wps[(rnd() * N_WP) | 0];
      const lat = (rnd() - 0.5) * (ROADW - 14);
      t.fillStyle = (i & 1) ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.07)';
      t.beginPath();
      t.arc(w.x - w.ty * lat, w.y + w.tx * lat, 0.8 + rnd() * 1.6, 0, Math.PI * 2);
      t.fill();
    }

    // センターライン
    tracePath(t);
    t.strokeStyle = theme.line;
    t.lineWidth = 3;
    t.setLineDash([22, 26]);
    t.stroke();
    t.setLineDash([]);

    // 雪のダート区間（センターラインの上、スタートラインの下に描く）
    buildDirt(t);

    // スタートライン（市松・道幅いっぱい）
    {
      const w0 = wps[0];
      const rx = -w0.ty, ry = w0.tx; // 道の横方向
      const sq = 8;
      const half = Math.ceil(ROADW / 2 / sq);
      for (let row = 0; row < 2; row++) {
        for (let k = -half; k < half; k++) {
          t.fillStyle = ((k + row) & 1) ? '#111' : '#fff';
          const cx = w0.x + rx * (k * sq + sq / 2) + w0.tx * (row * sq);
          const cy = w0.y + ry * (k * sq + sq / 2) + w0.ty * (row * sq);
          t.save();
          t.translate(cx, cy);
          t.rotate(Math.atan2(w0.ty, w0.tx));
          t.fillRect(-sq / 2, -sq / 2, sq, sq);
          t.restore();
        }
      }
    }

    texData32 = new Uint32Array(t.getImageData(0, 0, TEX, TEX).data.buffer);
    outA32 = abgr(theme.grassA);
    outB32 = abgr(theme.grassB);

    // 遠景用の縮小テクスチャ（ミップマップ）。遠くの路面のチラつきを抑える
    const mg = mipCanvas.getContext('2d');
    mg.imageSmoothingEnabled = true;
    mg.imageSmoothingQuality = 'high';
    mg.drawImage(texCanvas, 0, 0, MIP, MIP);
    mip32 = new Uint32Array(mg.getImageData(0, 0, MIP, MIP).data.buffer);

    // 走行マスク（縁石まで走行可）
    const m = helperCanvas.getContext('2d');
    m.fillStyle = '#000';
    m.fillRect(0, 0, TEX, TEX);
    m.lineJoin = 'round';
    m.lineCap = 'round';
    tracePath(m);
    m.strokeStyle = '#fff';
    m.lineWidth = ROADW + 14;
    m.stroke();
    const md = m.getImageData(0, 0, TEX, TEX).data;
    for (let i = 0; i < TEX * TEX; i++) roadMask[i] = md[i * 4] > 128 ? 1 : 0;
  }

  function isRoad(x, y) {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= TEX || yi >= TEX) return false;
    return roadMask[yi * TEX + xi] === 1;
  }

  function isDirt(x, y) {
    if (!hasDirt) return false;
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= TEX || yi >= TEX) return false;
    return dirtMask[yi * TEX + xi] === 1;
  }

  // ===== 沿道の飾りスプライト =====
  function makeTreeSprite(top, bottom, snow) {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#6d4c41';
    g.fillRect(21, 48, 6, 14);
    g.fillStyle = bottom;
    g.beginPath();
    g.moveTo(24, 14); g.lineTo(4, 48); g.lineTo(44, 48);
    g.closePath(); g.fill();
    g.fillStyle = top;
    g.beginPath();
    g.moveTo(24, 2); g.lineTo(9, 30); g.lineTo(39, 30);
    g.closePath(); g.fill();
    if (snow) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.moveTo(24, 2); g.lineTo(15, 19); g.lineTo(33, 19);
      g.closePath(); g.fill();
    }
    return c;
  }

  function makeGasshoSprite() {
    // 合掌造り（雪をかぶった茅葺き屋根）
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 96;
    const g = c.getContext('2d');
    // 壁
    g.fillStyle = '#efebe9';
    g.fillRect(28, 62, 64, 28);
    g.fillStyle = '#5d4037';
    g.fillRect(28, 62, 64, 4);
    g.fillRect(56, 70, 10, 20);
    // 屋根
    g.fillStyle = '#8d6e63';
    g.beginPath();
    g.moveTo(60, 4); g.lineTo(8, 64); g.lineTo(112, 64);
    g.closePath(); g.fill();
    // 茅の筋
    g.strokeStyle = 'rgba(93,64,55,0.6)';
    g.lineWidth = 2;
    for (let i = 1; i <= 4; i++) {
      g.beginPath();
      g.moveTo(60 - i * 11, 4 + i * 13);
      g.lineTo(60 + i * 11, 4 + i * 13);
      g.stroke();
    }
    // 屋根の雪
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(60, 2); g.lineTo(40, 26); g.lineTo(80, 26);
    g.closePath(); g.fill();
    // 切妻の窓
    g.fillStyle = '#4e342e';
    g.fillRect(50, 36, 20, 14);
    g.strokeStyle = '#d7ccc8';
    g.lineWidth = 1.5;
    g.strokeRect(50, 36, 20, 14);
    g.beginPath();
    g.moveTo(60, 36); g.lineTo(60, 50);
    g.moveTo(50, 43); g.lineTo(70, 43);
    g.stroke();
    return c;
  }

  function makeMachiyaSprite() {
    // 高山「さんまち」の町家（出格子の二階家・深い軒）
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 96;
    const g = c.getContext('2d');
    // 深い軒の瓦屋根
    g.fillStyle = '#2f3a40';
    g.beginPath();
    g.moveTo(2, 30); g.lineTo(60, 11); g.lineTo(118, 30);
    g.lineTo(112, 39); g.lineTo(8, 39); g.closePath(); g.fill();
    g.fillStyle = '#48565e';
    g.fillRect(8, 34, 104, 5);   // 瓦の段
    g.fillStyle = '#6b4f3a';
    g.fillRect(10, 39, 100, 4);  // 軒裏
    // 二階の出格子（弁柄色の壁＋明るい格子）
    g.fillStyle = '#5b3a2e';
    g.fillRect(10, 43, 100, 22);
    g.fillStyle = '#caa15f';
    g.fillRect(15, 46, 90, 16);
    g.strokeStyle = '#3a2418';
    g.lineWidth = 1.3;
    for (let x = 18; x < 105; x += 5) {
      g.beginPath(); g.moveTo(x, 46); g.lineTo(x, 62); g.stroke();
    }
    // 一階の壁
    g.fillStyle = '#4e342e';
    g.fillRect(10, 65, 100, 30);
    // 格子窓（灯りがともる）
    g.fillStyle = '#ffd38a';
    g.fillRect(15, 71, 42, 20);
    g.strokeStyle = '#2e1d12';
    for (let x = 19; x < 57; x += 5) {
      g.beginPath(); g.moveTo(x, 71); g.lineTo(x, 91); g.stroke();
    }
    // 入口＋藍の暖簾
    g.fillStyle = '#241712';
    g.fillRect(66, 67, 40, 28);
    g.fillStyle = '#28406b';
    g.fillRect(66, 67, 40, 12);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(84, 69, 3, 9);
    // 軒下の赤提灯
    g.fillStyle = '#c62828';
    g.beginPath(); g.ellipse(60, 47, 4, 6, 0, 0, Math.PI * 2); g.fill();
    return c;
  }

  function makeOnsenSprite() {
    // 温泉の看板（奥飛騨温泉郷）
    const c = document.createElement('canvas');
    c.width = 44;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#795548';
    g.fillRect(19, 30, 6, 34);
    g.fillStyle = '#fff8e1';
    g.beginPath();
    g.roundRect(4, 2, 36, 30, 5);
    g.fill();
    g.strokeStyle = '#6d4c41';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#e53935';
    g.font = 'bold 22px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('♨', 22, 18);
    return c;
  }

  function makeRockSprite() {
    const c = document.createElement('canvas');
    c.width = 60;
    c.height = 44;
    const g = c.getContext('2d');
    g.fillStyle = '#78909c';
    g.beginPath();
    g.moveTo(6, 42); g.lineTo(2, 26); g.lineTo(14, 12); g.lineTo(34, 6);
    g.lineTo(52, 16); g.lineTo(58, 32); g.lineTo(50, 42);
    g.closePath(); g.fill();
    g.fillStyle = '#90a4ae';
    g.beginPath();
    g.moveTo(14, 12); g.lineTo(34, 6); g.lineTo(42, 14); g.lineTo(22, 22);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.moveTo(6, 42); g.lineTo(50, 42); g.lineTo(52, 36); g.lineTo(8, 34);
    g.closePath(); g.fill();
    return c;
  }

  function makeYataiSprite() {
    // 高山祭の屋台（金の唐破風屋根・黒漆の山車）
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 112;
    const g = c.getContext('2d');
    // 御所車（車輪）
    g.fillStyle = '#3a2a18';
    g.beginPath(); g.arc(26, 102, 9, 0, Math.PI * 2); g.arc(54, 102, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1c140c';
    g.beginPath(); g.arc(26, 102, 3, 0, Math.PI * 2); g.arc(54, 102, 3, 0, Math.PI * 2); g.fill();
    // 黒漆の本体（下段）
    g.fillStyle = '#15110d';
    g.fillRect(18, 64, 44, 36);
    g.fillStyle = '#c9a227';   // 金の装飾帯
    g.fillRect(18, 64, 44, 5);
    g.fillRect(18, 92, 44, 5);
    g.fillStyle = '#8b1d1d';   // 朱の柱
    g.fillRect(20, 69, 5, 23); g.fillRect(55, 69, 5, 23);
    // 中段（白い幕）
    g.fillStyle = '#efe6d0';
    g.fillRect(22, 52, 36, 14);
    g.fillStyle = '#b8860b';
    g.fillRect(22, 52, 36, 3);
    // 唐破風の屋根（金のグラデ）
    const rg = g.createLinearGradient(0, 30, 0, 54);
    rg.addColorStop(0, '#f4d774'); rg.addColorStop(1, '#b8860b');
    g.fillStyle = rg;
    g.beginPath();
    g.moveTo(8, 54);
    g.quadraticCurveTo(40, 28, 72, 54);
    g.quadraticCurveTo(40, 44, 8, 54);
    g.closePath(); g.fill();
    g.fillStyle = '#7a5a12';    // 棟
    g.fillRect(38, 30, 4, 16);
    g.fillStyle = '#e8c84a';    // てっぺんの飾り
    g.beginPath(); g.arc(40, 28, 4, 0, Math.PI * 2); g.fill();
    // 赤提灯
    g.fillStyle = '#d32f2f';
    g.beginPath();
    g.ellipse(14, 62, 4, 6, 0, 0, Math.PI * 2);
    g.ellipse(66, 62, 4, 6, 0, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  function makeSakaguraSprite() {
    // 造り酒屋（白漆喰・なまこ壁・軒先の杉玉）
    const c = document.createElement('canvas');
    c.width = 112;
    c.height = 88;
    const g = c.getContext('2d');
    // 瓦屋根
    g.fillStyle = '#37434a';
    g.beginPath();
    g.moveTo(2, 26); g.lineTo(56, 8); g.lineTo(110, 26);
    g.lineTo(102, 34); g.lineTo(10, 34); g.closePath(); g.fill();
    g.fillStyle = '#48565e';
    g.fillRect(10, 30, 92, 4);
    // 白漆喰の壁
    g.fillStyle = '#efeae0';
    g.fillRect(12, 34, 88, 52);
    // なまこ壁（腰の格子模様）
    g.fillStyle = '#cfd6db';
    g.fillRect(12, 66, 88, 20);
    g.strokeStyle = '#9aa6ad';
    g.lineWidth = 1.3;
    for (let x = 16; x < 100; x += 8) {
      g.beginPath(); g.moveTo(x, 66); g.lineTo(x + 6, 86); g.stroke();
      g.beginPath(); g.moveTo(x + 6, 66); g.lineTo(x, 86); g.stroke();
    }
    // 扉
    g.fillStyle = '#3a2a1c';
    g.fillRect(46, 56, 22, 30);
    // 杉玉（軒先の緑の玉＝新酒の合図）
    g.fillStyle = '#6e8b3d';
    g.beginPath(); g.arc(30, 42, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.arc(32, 44, 9, 0.1, Math.PI - 0.3); g.fill();
    // 酒の看板
    g.fillStyle = '#5d4037';
    g.fillRect(66, 38, 22, 13);
    g.fillStyle = '#f5deb3';
    g.font = 'bold 10px serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('酒', 77, 45);
    return c;
  }

  function makeNakabashiSprite() {
    // 中橋（宮川にかかる朱塗りの欄干）
    const c = document.createElement('canvas');
    c.width = 124;
    c.height = 56;
    const g = c.getContext('2d');
    g.fillStyle = '#9c3a2a';     // 橋桁
    g.fillRect(4, 36, 116, 8);
    g.fillStyle = '#c0392b';     // 欄干の横木
    g.fillRect(4, 16, 116, 6);
    g.fillRect(4, 27, 116, 4);
    for (const x of [8, 42, 76, 110]) {
      g.fillStyle = '#a93226';   // 親柱
      g.fillRect(x, 14, 6, 26);
      g.fillStyle = '#d4a017';   // 擬宝珠（金）
      g.beginPath(); g.arc(x + 3, 12, 4, 0, Math.PI * 2); g.fill();
    }
    return c;
  }

  // 絵文字は毎フレームfillTextすると巨大なフォントグリフが
  // 大量生成されてモバイルでクラッシュするため、起動時に一度だけ描画しておく
  function makeEmojiSprite(char, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 72;
    const g = c.getContext('2d');
    g.font = '60px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (color) g.fillStyle = color;
    g.fillText(char, 36, 40);
    return c;
  }

  const bananaSprite = makeEmojiSprite('🍌');
  const starSprite = makeEmojiSprite('★', '#fff');

  // ふんわりした雲（絵文字よりやわらかい見た目に）
  function makeCloudSprite() {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(200,214,228,0.6)';
    g.beginPath();
    g.ellipse(60, 50, 40, 9, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.96)';
    for (const [x, y, r] of [[32, 40, 17], [56, 30, 22], [84, 38, 16], [60, 44, 21]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }
  const cloudSprite = makeCloudSprite();

  // 太陽のやわらかい光
  function makeGlowSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 220;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(110, 110, 6, 110, 110, 108);
    rg.addColorStop(0, 'rgba(255,250,228,0.95)');
    rg.addColorStop(0.25, 'rgba(255,244,200,0.5)');
    rg.addColorStop(1, 'rgba(255,244,200,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 220, 220);
    return c;
  }
  const glowSprite = makeGlowSprite();

  // 画面端を少し落とすビネット（画の締まりを出す）
  const vignette = (() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(W / 2, H * 0.46, H * 0.5, W / 2, H * 0.52, H * 1.02);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(10,12,30,0.28)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
    return c;
  })();

  const DECO = {
    tree:     { img: makeTreeSprite('#2e7d32', '#1b5e20', false), w: 46 },
    autumn:   { img: makeTreeSprite('#ef6c00', '#bf360c', false), w: 46 },
    snowtree: { img: makeTreeSprite('#2e7d32', '#1b5e20', true), w: 46 },
    gassho:   { img: makeGasshoSprite(), w: 120 },
    machiya:  { img: makeMachiyaSprite(), w: 108 },
    sakagura: { img: makeSakaguraSprite(), w: 98 },
    yatai:    { img: makeYataiSprite(), w: 60 },
    nakabashi:{ img: makeNakabashiSprite(), w: 106 },
    onsen:    { img: makeOnsenSprite(), w: 36 },
    rock:     { img: makeRockSprite(), w: 50 },
    cow:      { img: makeEmojiSprite('🐄'), w: 26 },
    lantern:  { img: makeEmojiSprite('🏮'), w: 20 },
    snowman:  { img: makeEmojiSprite('⛄'), w: 30 },
    goat:     { img: makeEmojiSprite('🐐'), w: 24 },
  };

  function buildDecorations() {
    decorations = [];
    // 出現テーブル（重みつき）
    const table = [];
    for (const [type, weight] of theme.deco) {
      for (let i = 0; i < weight; i++) table.push(type);
    }
    for (let i = 4; i < N_WP; i += 6) {
      if (rnd() < 0.45) continue;
      const type = table[(rnd() * table.length) | 0];
      const big = DECO[type].w >= 90;
      const w = wps[i];
      const rx = -w.ty, ry = w.tx;
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (ROADW / 2 + 34 + (big ? 30 : 0) + rnd() * 55);
      const x = w.x + rx * lat;
      const y = w.y + ry * lat;
      if (x < 30 || y < 30 || x > TEX - 30 || y > TEX - 30) continue;
      if (isRoad(x, y)) continue;
      decorations.push({ x, y, type, size: 0.85 + rnd() * 0.45 });
    }
  }

  function buildSky() {
    skyGrad = ctx.createLinearGradient(0, 0, 0, HORIZON);
    skyGrad.addColorStop(0, theme.skyTop);
    skyGrad.addColorStop(1, theme.skyBot);
    fogGrad = ctx.createLinearGradient(0, HORIZON, 0, HORIZON + 44);
    fogGrad.addColorStop(0, `rgba(${theme.fog},0.9)`);
    fogGrad.addColorStop(1, `rgba(${theme.fog},0)`);
    hazeGrad = ctx.createLinearGradient(0, HORIZON - 52, 0, HORIZON);
    hazeGrad.addColorStop(0, `rgba(${theme.fog},0)`);
    hazeGrad.addColorStop(1, `rgba(${theme.fog},0.55)`);
    // 山並み（飛騨山脈っぽいシルエット）
    ridges = theme.ridges.map((r) => ({
      ...r,
      peaks: Array.from({ length: 24 }, () => 0.35 + rnd() * 0.65),
    }));
    // いちばん遠い山脈を1枚自動で足して奥行きを出す
    const far = theme.ridges[0];
    ridges.unshift({
      color: shade(far.color, 26),
      amp: far.amp * 1.4,
      speed: 34,
      snow: far.snow,
      peaks: Array.from({ length: 24 }, () => 0.35 + rnd() * 0.65),
    });
  }

  function buildCourse(idx, seed) {
    courseIdx = idx;
    course = COURSES[idx];
    theme = course.theme;
    ROADW = course.roadW || 80;
    LAPS = course.laps || 3;
    courseSeed = seed !== undefined ? seed : ((Math.random() * 0xffffffff) >>> 0);
    srand(courseSeed);
    buildTrack(course.ctrl);
    buildTexture();
    buildDecorations();
    buildSky();
  }

  // ===== カートスプライト（後ろ姿・高精細） =====
  function makeKartSprite(body, helmet) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 80;
    const g = c.getContext('2d');
    // タイヤ
    g.fillStyle = '#15151a';
    g.beginPath();
    g.roundRect(4, 44, 22, 32, 7);
    g.roundRect(70, 44, 22, 32, 7);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.roundRect(8, 48, 14, 6, 3);
    g.roundRect(74, 48, 14, 6, 3);
    g.fill();
    // リアウィング
    g.fillStyle = shade(body, -52);
    g.fillRect(18, 20, 60, 8);
    g.fillRect(30, 26, 6, 12);
    g.fillRect(60, 26, 6, 12);
    g.fillStyle = shade(body, 16);
    g.fillRect(18, 20, 60, 3);
    // 車体（縦グラデで立体感）
    const bg = g.createLinearGradient(0, 32, 0, 72);
    bg.addColorStop(0, shade(body, 36));
    bg.addColorStop(0.45, body);
    bg.addColorStop(1, shade(body, -40));
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(16, 32, 64, 38, 13);
    g.fill();
    // サイドのハイライト
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.roundRect(22, 36, 52, 6, 3);
    g.fill();
    // ドライバー（ヘルメット球体）
    const hg = g.createRadialGradient(43, 14, 2, 48, 20, 17);
    hg.addColorStop(0, shade(helmet, 45));
    hg.addColorStop(1, shade(helmet, -22));
    g.fillStyle = hg;
    g.beginPath();
    g.arc(48, 20, 15, 0, Math.PI * 2);
    g.fill();
    // バイザー
    g.fillStyle = 'rgba(18,28,38,0.85)';
    g.beginPath();
    g.arc(48, 22, 15, Math.PI * 0.12, Math.PI * 0.88);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(39, 15, 9, 3);
    // バンパー
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.roundRect(20, 60, 56, 9, 4);
    g.fill();
    return c;
  }

  // ===== サウンド =====
  let actx = null;
  function initAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 無音で続行 */ }
    }
  }
  function beep(freq, dur, vol = 0.12, type = 'square') {
    if (!actx) return;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur);
  }

  // ===== 入力 =====
  // ?demo=1 で自動操縦（観戦モード）
  const DEMO = new URLSearchParams(location.search).has('demo');
  const input = { left: false, right: false, up: false, down: false };
  let itemPressed = false;

  const KEYMAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
  };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.key];
    if (k) { input[k] = true; e.preventDefault(); }
    if (e.key === ' ') { itemPressed = true; e.preventDefault(); }
    if ((e.key === 'r' || e.key === 'R') && state === 'race') respawnPlayer();
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.key];
    if (k) input[k] = false;
  });

  function bindTouch(id, flag) {
    const el = document.getElementById(id);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      initAudio();
      // 指が少しずれても押しっぱなしが切れないようにキャプチャ
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント等 */ }
      input[flag] = true;
    });
    const off = (e) => { e.preventDefault(); input[flag] = false; };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }
  bindTouch('tc-gas', 'up');
  bindTouch('tc-back', 'down');

  // ドラッグ式のアナログステアバー
  const steerBar = document.getElementById('steer-bar');
  const steerKnob = document.getElementById('steer-knob');
  let touchSteer = 0;       // -1〜1
  let steerPointer = null;  // 操作中のポインタID
  function setKnob(v) {
    steerKnob.style.left = `${50 + v * 32}%`;
  }
  function steerFromEvent(e) {
    const r = steerBar.getBoundingClientRect();
    const half = Math.max(1, r.width / 2 - 30);
    touchSteer = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / half));
    setKnob(touchSteer);
  }
  steerBar.addEventListener('contextmenu', (e) => e.preventDefault());
  steerBar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    try { steerBar.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント等 */ }
    steerPointer = e.pointerId;
    steerFromEvent(e);
  });
  steerBar.addEventListener('pointermove', (e) => {
    if (e.pointerId === steerPointer) steerFromEvent(e);
  });
  const steerOff = (e) => {
    if (e.pointerId !== steerPointer) return;
    steerPointer = null;
    touchSteer = 0;
    setKnob(0);
  };
  steerBar.addEventListener('pointerup', steerOff);
  steerBar.addEventListener('pointercancel', steerOff);

  // ピンチ / ダブルタップによる画面ズームを抑止
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 && e.cancelable) e.preventDefault();
  }, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300 && e.cancelable) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  const tcItem = document.getElementById('tc-item');
  tcItem.addEventListener('contextmenu', (e) => e.preventDefault());
  tcItem.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    itemPressed = true;
  });

  // 全画面ボタン（非対応ブラウザでは隠す）
  const fsBtn = document.getElementById('tc-fs');
  if (document.documentElement.requestFullscreen) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.querySelector('.race-container').requestFullscreen().catch(() => {});
    });
  } else {
    fsBtn.style.display = 'none';
  }

  // バイブ振動（対応端末のみ）
  function buzz(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // ===== ゲーム状態 =====
  let karts = [];
  let player = null;
  let itemBoxes = [];
  let bananas = [];
  let state = 'title';   // title | count | race | finished
  let countT = 0;
  let raceTime = 0;
  let finishOrder = [];

  const CPU_DEFS = [
    { name: 'レッド', body: '#e53935', helmet: '#ffeb3b', skill: 0.97 },
    { name: 'ブルー', body: '#1e88e5', helmet: '#fff',    skill: 0.93 },
    { name: 'グリーン', body: '#43a047', helmet: '#ff9800', skill: 0.89 },
  ];

  function spawnKart(def, wpIdx, lateral, isPlayer) {
    const w = wps[wpIdx];
    const rx = -w.ty, ry = w.tx;
    return {
      name: def.name,
      isPlayer,
      sprite: makeKartSprite(def.body, def.helmet),
      color: def.body,
      skill: def.skill || 1,
      x: w.x + rx * lateral,
      y: w.y + ry * lateral,
      a: Math.atan2(w.ty, w.tx),
      speed: 0,
      wp: wpIdx,
      lap: 0,
      item: null,
      boost: 0,
      spin: 0,
      aiItemT: 0,
      finished: false,
    };
  }

  function resetRace(vs) {
    karts = [];
    bananas = [];
    finishOrder = [];
    raceTime = 0;
    steerSmooth = 0;
    remoteTarget = null;
    remoteFinish = null;

    const grid = N_WP - 8;
    if (vs) {
      // 対戦: 自分と相手の2台。ホストが左、ゲストが右
      const myLat = netRole === 'host' ? -22 : 22;
      remoteKart = spawnKart({ name: 'あいて', body: '#1e88e5', helmet: '#fff' }, grid, -myLat, false);
      remoteKart.remote = true;
      player = spawnKart({ name: 'あなた', body: '#e94560', helmet: '#fff' }, grid, myLat, true);
      karts.push(remoteKart, player);
    } else {
      remoteKart = null;
      karts.push(spawnKart(CPU_DEFS[0], grid + 4, -22, false));
      karts.push(spawnKart(CPU_DEFS[1], grid + 4, 22, false));
      karts.push(spawnKart(CPU_DEFS[2], grid, -22, false));
      player = spawnKart({ name: 'あなた', body: '#e94560', helmet: '#fff' }, grid, 22, true);
      karts.push(player);
    }

    itemBoxes = [];
    for (let i = 50; i < N_WP; i += 100) {
      const w = wps[i];
      const rx = -w.ty, ry = w.tx;
      for (const off of [-ROADW * 0.3, 0, ROADW * 0.3]) {
        itemBoxes.push({ x: w.x + rx * off, y: w.y + ry * off, respawn: 0 });
      }
    }
  }

  function respawnPlayer() {
    // コースに復帰（Rキー）
    const w = wps[player.wp];
    player.x = w.x;
    player.y = w.y;
    player.a = Math.atan2(w.ty, w.tx);
    player.speed = 0;
    player.spin = 0;
  }

  // ===== 物理・進行 =====
  // キー操作は瞬時に±1にせず補間してマイルドに。スライダーはアナログ値をそのまま使う
  let steerSmooth = 0;
  function updatePlayerSteer(dt) {
    if (steerPointer !== null) {
      steerSmooth = touchSteer;
      return steerSmooth;
    }
    const target = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const rate = target === 0 ? 10 : 6; // 戻りは速め、切り込みは緩やかに
    const step = rate * dt;
    const d = target - steerSmooth;
    steerSmooth += Math.max(-step, Math.min(step, d));
    if (target === 0 && Math.abs(steerSmooth) < 0.03) steerSmooth = 0;
    return steerSmooth;
  }

  function progressOf(k) {
    return k.lap * N_WP + k.wp;
  }

  function updateNearestWp(k) {
    let best = k.wp, bestD = Infinity;
    for (let d = -3; d <= 10; d++) {
      const i = (k.wp + d + N_WP) % N_WP;
      const dx = wps[i].x - k.x, dy = wps[i].y - k.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestD) { bestD = dist; best = i; }
    }
    const prev = k.wp;
    k.wp = best;
    // 周回判定（スタートラインをまたいだら ±1）
    if (prev > N_WP - 40 && best < 40) k.lap++;
    else if (prev < 40 && best > N_WP - 40) k.lap--;
  }

  function steerForCpu(k) {
    const target = wps[(k.wp + 9) % N_WP];
    const want = Math.atan2(target.y - k.y, target.x - k.x);
    let diff = want - k.a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return {
      steer: Math.max(-1, Math.min(1, diff * 3)),
      brake: Math.abs(diff) > 1.1 && k.speed > MAX_SPEED * 0.55,
    };
  }

  // ガードレール: 道路マスクの外へは出られない
  // 戻り値 0=通常移動 1=壁ずり 2=正面衝突
  function moveWithWalls(k, dx, dy) {
    const nx = k.x + dx, ny = k.y + dy;
    if (!isRoad(k.x, k.y) || isRoad(nx, ny)) {
      // 既にコース外にいる場合は復帰できるよう自由に動かす
      k.x = nx;
      k.y = ny;
      return 0;
    }
    if (isRoad(nx, k.y)) { k.x = nx; return 1; }
    if (isRoad(k.x, ny)) { k.y = ny; return 1; }
    return 2;
  }

  function hitWall(k, kind, dt) {
    if (kind === 1) {
      k.speed *= Math.max(0, 1 - 2 * dt); // 壁ずりで減速
    } else if (kind === 2) {
      const hard = Math.abs(k.speed) > 80;
      k.speed *= -0.25; // 小さく跳ね返る
      if (k.isPlayer && hard && k.wallT <= 0) {
        k.wallT = 0.5;
        beep(110, 0.2, 0.18, 'square');
        buzz(50);
      }
    }
  }

  function updateKart(k, dt) {
    k.wallT = Math.max(0, (k.wallT || 0) - dt);
    if (k.spin > 0) {
      k.spin -= dt;
      k.a += dt * 10;
      k.speed *= Math.max(0, 1 - 2.5 * dt);
      hitWall(k, moveWithWalls(k, Math.cos(k.a) * k.speed * dt * 0.3, Math.sin(k.a) * k.speed * dt * 0.3), dt);
      updateNearestWp(k);
      return;
    }

    let steer = 0, gas = false, brake = false;
    if (k.isPlayer && !DEMO && state === 'race' && !k.finished) {
      steer = updatePlayerSteer(dt);
      gas = input.up;
      brake = input.down;
      if (itemPressed) { useItem(k); }
    } else if ((!k.isPlayer || DEMO) && state !== 'count') {
      const ai = steerForCpu(k);
      steer = ai.steer;
      gas = true;
      brake = ai.brake;
      // ランダムなタイミングでアイテム使用
      if (k.item) {
        k.aiItemT -= dt;
        if (k.aiItemT <= 0) useItem(k);
      }
    }

    const onRoad = isRoad(k.x, k.y);
    const onDirt = onRoad && isDirt(k.x, k.y);
    let limit = MAX_SPEED * k.skill * (onRoad ? 1 : OFFROAD_MUL);
    if (onDirt) limit *= course.dirt.mul;

    // CPUのラバーバンド（プレイヤーとの差を緩やかに詰める/緩める）
    if (!k.isPlayer && player && !player.finished) {
      const gap = progressOf(player) - progressOf(k);
      if (gap > 30) limit *= 1.07;
      else if (gap < -30) limit *= 0.93;
    }
    if (k.boost > 0) {
      k.boost -= dt;
      limit *= BOOST_MUL;
      k.speed += ACCEL * 2 * dt;
    }

    if (gas) k.speed += ACCEL * dt;
    else if (brake) k.speed -= BRAKE * dt;
    else k.speed -= Math.sign(k.speed) * FRICTION * dt;

    if (k.speed > limit) k.speed = Math.max(limit, k.speed - BRAKE * 1.5 * dt);
    if (k.speed < -120) k.speed = -120;
    if (!gas && !brake && Math.abs(k.speed) < 4) k.speed = 0;

    const speedFactor = Math.min(1, Math.abs(k.speed) / (MAX_SPEED * 0.45));
    const turnMul = (course.turnMul || 1) * (onDirt ? 0.85 : 1);
    k.a += steer * TURN_RATE * turnMul * speedFactor * Math.sign(k.speed || 1) * dt;

    hitWall(k, moveWithWalls(k, Math.cos(k.a) * k.speed * dt, Math.sin(k.a) * k.speed * dt), dt);
    k.x = Math.max(16, Math.min(TEX - 16, k.x));
    k.y = Math.max(16, Math.min(TEX - 16, k.y));

    updateNearestWp(k);

    if (k.lap > LAPS && !k.finished) {
      k.finished = true;
      finishOrder.push(k);
      if (k.isPlayer) onPlayerFinish();
    }
  }

  function useItem(k) {
    if (!k.item) return;
    if (k.isPlayer) buzz(30);
    if (k.item === 'boost') {
      k.boost = 1.6;
      if (k.isPlayer) beep(880, 0.3, 0.12, 'sawtooth');
    } else if (k.item === 'banana') {
      const bn = {
        x: k.x - Math.cos(k.a) * 42,
        y: k.y - Math.sin(k.a) * 42,
        arm: 0.6,
        id: k.isPlayer && vsMode ? `${netRole}-${++netBananaSeq}` : null,
      };
      bananas.push(bn);
      if (k.isPlayer) {
        beep(330, 0.15);
        if (bn.id) netSend({ t: 'banana', x: bn.x, y: bn.y, id: bn.id });
      }
    }
    k.item = null;
  }

  function updateWorld(dt) {
    for (const k of karts) {
      if (k.remote) { lerpRemote(k, dt); continue; }
      updateKart(k, dt);
    }

    // カート同士の押し合い
    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i], b = karts[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < 26) {
          const push = (26 - d) / 2;
          const nx = dx / d, ny = dy / d;
          const ax = a.x, ay = a.y, bx = b.x, by = b.y;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          // ガードレールの外へ押し出されないように
          if (isRoad(ax, ay) && !isRoad(a.x, a.y)) { a.x = ax; a.y = ay; }
          if (isRoad(bx, by) && !isRoad(b.x, b.y)) { b.x = bx; b.y = by; }
          a.speed *= 0.97; b.speed *= 0.97;
        }
      }
    }

    // アイテムボックス（相手の取得は'box'メッセージで同期）
    for (const box of itemBoxes) {
      if (box.respawn > 0) { box.respawn -= dt; continue; }
      for (const k of karts) {
        if (k.remote || k.item || k.finished) continue;
        if (Math.hypot(k.x - box.x, k.y - box.y) < 22) {
          k.item = Math.random() < 0.6 ? 'boost' : 'banana';
          k.aiItemT = 1.5 + Math.random() * 3;
          box.respawn = 4;
          if (k.isPlayer) {
            beep(660, 0.12, 0.1, 'triangle');
            buzz(20);
            netSend({ t: 'box', i: itemBoxes.indexOf(box) });
          }
          break;
        }
      }
    }

    // バナナ（相手のヒット判定は相手側が行い'bhit'で同期）
    for (let i = bananas.length - 1; i >= 0; i--) {
      const bn = bananas[i];
      bn.arm -= dt;
      if (bn.arm > 0) continue;
      for (const k of karts) {
        if (k.remote || k.spin > 0) continue;
        if (Math.hypot(k.x - bn.x, k.y - bn.y) < 20) {
          k.spin = 1;
          k.speed *= 0.25;
          if (bn.id) netSend({ t: 'bhit', id: bn.id });
          bananas.splice(i, 1);
          if (k.isPlayer) { beep(180, 0.4, 0.15, 'sawtooth'); buzz([60, 50, 60]); }
          break;
        }
      }
    }
  }

  // 相手カートは受信した状態へなめらかに補間
  function lerpRemote(k, dt) {
    if (remoteTarget) {
      const f = Math.min(1, dt * 10);
      k.x += (remoteTarget.x - k.x) * f;
      k.y += (remoteTarget.y - k.y) * f;
      let da = remoteTarget.a - k.a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      k.a += da * f;
      k.speed = remoteTarget.sp;
    }
    k.boost = Math.max(0, k.boost - dt);
    k.spin = Math.max(0, k.spin - dt);
  }

  // ===== レンダリング =====
  const groundImg = ctx.createImageData(W, H - HORIZON);
  const ground32 = new Uint32Array(groundImg.data.buffer);

  function renderGround(camX, camY, dirX, dirY) {
    const rxv = -dirY, ryv = dirX; // カメラの右方向
    const mipD = FOCAL * 1.2;      // これより遠い行は縮小テクスチャから読む
    let p = 0;
    for (let y = HORIZON; y < H; y++) {
      const rowD = (CAM_H * FOCAL) / (y - HORIZON + 1);
      const cx = camX + dirX * rowD;
      const cy = camY + dirY * rowD;
      const halfw = (rowD * (W / 2)) / FOCAL;
      let wx = cx - rxv * halfw;
      let wy = cy - ryv * halfw;
      const sx = (rxv * 2 * halfw) / W;
      const sy = (ryv * 2 * halfw) / W;
      if (rowD > mipD) {
        // 遠景: ミップマップでチラつきを抑える
        for (let x = 0; x < W; x++) {
          const txi = wx | 0, tyi = wy | 0;
          if (txi >= 0 && tyi >= 0 && txi < TEX && tyi < TEX) {
            ground32[p++] = mip32[(tyi >> 1) * MIP + (txi >> 1)];
          } else {
            ground32[p++] = (((txi >> 6) ^ (tyi >> 6)) & 1) ? outA32 : outB32;
          }
          wx += sx;
          wy += sy;
        }
      } else {
        for (let x = 0; x < W; x++) {
          const txi = wx | 0, tyi = wy | 0;
          if (txi >= 0 && tyi >= 0 && txi < TEX && tyi < TEX) {
            ground32[p++] = texData32[tyi * TEX + txi];
          } else {
            ground32[p++] = (((txi >> 6) ^ (tyi >> 6)) & 1) ? outA32 : outB32;
          }
          wx += sx;
          wy += sy;
        }
      }
    }
    ctx.putImageData(groundImg, 0, HORIZON);
  }

  function renderSky(heading) {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, HORIZON);

    // 太陽の光（山の向こうに見える）
    {
      const sunSpan = W * 4;
      let sx = (W * 2.7 - (heading / (Math.PI * 2)) * sunSpan) % sunSpan;
      if (sx < 0) sx += sunSpan;
      ctx.drawImage(glowSprite, sx - 110, HORIZON - 190, 220, 220);
    }

    // 山並み（パララックスつき）
    const ak = HORIZON / 110; // 解像度スケールに山の高さを合わせる
    const span = 1920, segW = 80;
    for (const r of ridges) {
      let offset = (heading * r.speed) % span;
      if (offset < 0) offset += span;
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.moveTo(0, HORIZON);
      for (let x = 0; x <= W; x += 8) {
        const pan = (x + offset) % span;
        const i = (pan / segW) | 0;
        const f = (pan % segW) / segW;
        const hA = r.peaks[i % 24], hB = r.peaks[(i + 1) % 24];
        const hv = hA + (hB - hA) * f;
        ctx.lineTo(x, HORIZON - r.amp * ak * hv);
      }
      ctx.lineTo(W, HORIZON);
      ctx.closePath();
      ctx.fill();
      // 雪をかぶった頂
      if (r.snow) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (let i = 0; i < 24; i++) {
          let px = i * segW - offset;
          while (px < -segW) px += span;
          while (px > span - segW) px -= span;
          if (px < -20 || px > W + 20) continue;
          const py = HORIZON - r.amp * ak * r.peaks[i];
          const cap = r.amp * ak * r.peaks[i] * 0.32;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - cap * 0.8, py + cap);
          ctx.lineTo(px + cap * 0.8, py + cap);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // 地平線の霞（山すそをやわらかく）
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, HORIZON - 52, W, 52);

    // 視点に合わせて流れる雲（大きさに変化をつける）
    const cspan = W * 4;
    for (let i = 0; i < 7; i++) {
      const base = i * cspan / 7;
      let x = (base - heading / (Math.PI * 2) * cspan) % cspan;
      if (x < 0) x += cspan;
      const cw = 52 + (i % 3) * 26;
      ctx.drawImage(cloudSprite, x - cw, ((i * 41) % 64) + 8, cw, cw * 0.53);
    }
  }

  function project(camX, camY, dirX, dirY, ox, oy) {
    const rx = ox - camX, ry = oy - camY;
    const fz = rx * dirX + ry * dirY;          // 前方距離
    const fx = rx * -dirY + ry * dirX;         // 横位置
    if (fz < 12) return null;
    return {
      x: W / 2 + (fx / fz) * FOCAL,
      y: HORIZON + (CAM_H / fz) * FOCAL,
      scale: FOCAL / fz,
      fz,
    };
  }

  function renderSprites(camX, camY, dirX, dirY) {
    const items = [];

    for (const d of decorations) {
      const pr = project(camX, camY, dirX, dirY, d.x, d.y);
      // 至近距離は巨大描画になるだけなのでスキップ
      if (pr && pr.fz < 1500 && pr.fz > 22) items.push({ ...pr, type: 'deco', deco: d });
    }
    for (const box of itemBoxes) {
      if (box.respawn > 0) continue;
      const pr = project(camX, camY, dirX, dirY, box.x, box.y);
      if (pr) items.push({ ...pr, type: 'box' });
    }
    for (const bn of bananas) {
      const pr = project(camX, camY, dirX, dirY, bn.x, bn.y);
      if (pr) items.push({ ...pr, type: 'banana' });
    }
    for (const k of karts) {
      if (k.isPlayer) continue;
      const pr = project(camX, camY, dirX, dirY, k.x, k.y);
      if (pr) items.push({ ...pr, type: 'kart', kart: k });
    }

    items.sort((a, b) => b.fz - a.fz); // 遠い順に描画

    for (const it of items) {
      if (it.x < -100 || it.x > W + 100) continue;
      if (it.type === 'deco') {
        const spec = DECO[it.deco.type];
        const wpx = spec.w * it.deco.size * it.scale;
        const hpx = wpx * spec.img.height / spec.img.width;
        ctx.drawImage(spec.img, it.x - wpx / 2, it.y - hpx, wpx, hpx);
      } else if (it.type === 'box') {
        // 至近距離では巨大化して自機に重なるのでフェードアウト
        const fade = Math.min(1, (it.fz - 30) / 50);
        if (fade <= 0) continue;
        const s = 26 * it.scale;
        const bob = Math.sin(performance.now() / 250 + it.fz) * s * 0.08;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(it.x, it.y - s / 2 + bob);
        ctx.fillStyle = `hsla(${(performance.now() / 12) % 360}, 80%, 60%, 0.85)`;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(1, s * 0.07);
        ctx.beginPath();
        ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.18);
        ctx.fill();
        ctx.stroke();
        ctx.drawImage(starSprite, -s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
        ctx.restore();
      } else if (it.type === 'banana') {
        const s = 20 * it.scale;
        ctx.drawImage(bananaSprite, it.x - s / 2, it.y - s, s, s);
      } else {
        drawKart(it.kart, it.x, it.y, it.scale);
      }
    }
  }

  function drawKart(k, x, y, scale) {
    const w = 34 * scale;
    const h = w * (40 / 48);
    ctx.save();
    ctx.translate(x, y);
    if (k.spin > 0) ctx.rotate(Math.sin(k.spin * 18) * 0.7);
    // 影（ソフト）
    const shadow = ctx.createRadialGradient(0, h * 0.02, 0, 0, h * 0.02, w * 0.52);
    shadow.addColorStop(0, 'rgba(0,0,0,0.34)');
    shadow.addColorStop(0.7, 'rgba(0,0,0,0.15)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(0, h * 0.02, w * 0.52, h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // ブースト炎
    if (k.boost > 0) {
      ctx.fillStyle = 'rgba(255,140,0,0.85)';
      ctx.beginPath();
      ctx.ellipse(0, h * 0.05, w * 0.3, h * 0.22 + Math.random() * h * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.drawImage(k.sprite, -w / 2, -h, w, h);
    ctx.restore();
  }

  function renderPlayer() {
    const pr = { x: W / 2, y: HORIZON + (CAM_H / CAM_BACK) * FOCAL, scale: FOCAL / CAM_BACK };
    ctx.save();
    // ハンドル操作で軽く傾ける
    const lean = steerSmooth * 0.1;
    ctx.translate(pr.x, pr.y);
    ctx.rotate(lean);
    ctx.translate(-pr.x, -pr.y);
    drawKart(player, pr.x, pr.y, pr.scale);
    ctx.restore();
    // 雪のダート走行中は雪しぶき
    if (isDirt(player.x, player.y) && Math.abs(player.speed) > 60) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(
          pr.x + (Math.random() - 0.5) * 160,
          pr.y + 2 + Math.random() * 16,
          2 + Math.random() * 3.5, 0, Math.PI * 2
        );
        ctx.fill();
      }
    }
    // ブースト中の火花
    if (player.boost > 0) {
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = (i & 1) ? 'rgba(255,170,40,0.9)' : 'rgba(255,230,120,0.9)';
        ctx.beginPath();
        ctx.arc(
          pr.x + (Math.random() - 0.5) * 90,
          pr.y + 6 + Math.random() * 30,
          2 + Math.random() * 4, 0, Math.PI * 2
        );
        ctx.fill();
      }
    }
    // 最高速付近のスピード線
    if (Math.abs(player.speed) > MAX_SPEED * 0.9) {
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const sy = HORIZON + Math.random() * (H - HORIZON);
        const left = Math.random() < 0.5;
        const x0 = left ? Math.random() * W * 0.15 : W - Math.random() * W * 0.15;
        const len = (30 + Math.random() * 70) * (left ? 1 : -1);
        ctx.beginPath();
        ctx.moveTo(x0, sy);
        ctx.lineTo(x0 + len, sy);
        ctx.stroke();
      }
    }
  }

  function renderFog() {
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, HORIZON, W, 44);
  }

  function renderMinimap() {
    const S = MM / TEX;
    mmCtx.clearRect(0, 0, MM, MM);
    mmCtx.fillStyle = 'rgba(0,0,0,0.35)';
    mmCtx.beginPath();
    mmCtx.roundRect(0, 0, MM, MM, 22);
    mmCtx.fill();
    mmCtx.beginPath();
    mmCtx.moveTo(wps[0].x * S, wps[0].y * S);
    for (let i = 1; i < N_WP; i++) mmCtx.lineTo(wps[i].x * S, wps[i].y * S);
    mmCtx.closePath();
    mmCtx.strokeStyle = 'rgba(255,255,255,0.75)';
    mmCtx.lineWidth = 6;
    mmCtx.stroke();
    for (const k of karts) {
      mmCtx.fillStyle = k.color;
      mmCtx.beginPath();
      mmCtx.arc(k.x * S, k.y * S, k.isPlayer ? 6 : 4.5, 0, Math.PI * 2);
      mmCtx.fill();
      if (k.isPlayer) {
        mmCtx.strokeStyle = '#fff';
        mmCtx.lineWidth = 2;
        mmCtx.stroke();
      }
    }
  }

  function render() {
    const dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    const camX = player.x - dirX * CAM_BACK;
    const camY = player.y - dirY * CAM_BACK;

    renderSky(player.a);
    renderGround(camX, camY, dirX, dirY);
    renderFog();
    renderSprites(camX, camY, dirX, dirY);
    renderPlayer();
    ctx.drawImage(vignette, 0, 0);
    renderMinimap();
  }

  // ===== HUD =====
  function rankOf(target) {
    const sorted = [...karts].sort((a, b) => {
      const af = finishOrder.indexOf(a), bf = finishOrder.indexOf(b);
      if (af !== -1 && bf !== -1) return af - bf;
      if (af !== -1) return -1;
      if (bf !== -1) return 1;
      return progressOf(b) - progressOf(a);
    });
    return { rank: sorted.indexOf(target) + 1, sorted };
  }

  function fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const c = Math.floor((t * 100) % 100);
    return `${m}'${String(s).padStart(2, '0')}"${String(c).padStart(2, '0')}`;
  }

  function updateHud() {
    const { rank } = rankOf(player);
    hudPos.textContent = `${rank}位`;
    hudLap.textContent = `LAP ${Math.min(Math.max(player.lap, 1), LAPS)}/${LAPS}`;
    hudTime.textContent = fmtTime(raceTime);
    hudSpeed.textContent = `${Math.max(0, Math.round(player.speed * 0.6))} km/h`;
    const icon = player.item === 'boost' ? '🚀' : player.item === 'banana' ? '🍌' : '';
    hudItem.textContent = icon;
    tcItem.textContent = icon || '🎁';
    tcItem.classList.toggle('has-item', !!icon);
  }

  // ===== 進行管理 =====
  let playerFinishTime = 0;

  function onPlayerFinish() {
    playerFinishTime = raceTime;
    state = 'finished';
    msgEl.textContent = 'FINISH!';
    netSend({ t: 'fin', time: playerFinishTime });
    buzz(120);
    beep(660, 0.2);
    setTimeout(() => beep(880, 0.4), 200);
    setTimeout(showResults, 1800);
  }

  function showResults() {
    msgEl.textContent = '';
    const { rank, sorted } = rankOf(player);
    panelTitle.textContent = rank === 1 ? '🏆 優勝！' : `${rank}位でゴール！`;
    panelText.innerHTML = `${course.name}<br>タイム: ${fmtTime(playerFinishTime)}`;
    const medals = ['🥇', '🥈', '🥉', '4.'];
    resultsEl.innerHTML = sorted
      .map((k, i) => `<div class="${k.isPlayer ? 'me' : ''}">${medals[i]} ${k.name}</div>`)
      .join('');
    resultsEl.classList.remove('hidden');
    startBtn.textContent = 'もう一度！';
    panel.classList.remove('hidden');
  }

  function startRace() {
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    leaveNet();
    resetRace(false);
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    state = 'count';
    countT = 3.5;
  }
  startBtn.addEventListener('click', startRace);

  // ===== ふたりで対戦（ルームコードでP2P接続） =====
  // 通常は PeerJS（WebRTC）。?local=1 で同一ブラウザのタブ同士
  // （BroadcastChannel）に切り替わる（動作確認用・同じ端末の2窓対戦にも使える）
  const LOCAL_NET = new URLSearchParams(location.search).has('local');
  let net = null;          // {send, close}
  let netRole = null;      // 'host' | 'guest'
  let vsMode = false;
  let remoteKart = null;
  let remoteTarget = null; // 相手の最新状態
  let remoteFinish = null;
  let netBananaSeq = 0;
  let lastNetSend = 0;
  let roomCode = null;

  const vsMenu = document.getElementById('vs-menu');
  const vsStatusEl = document.getElementById('vs-status');
  const vsCodeInput = document.getElementById('vs-code');
  function vsStatus(msg) { vsStatusEl.textContent = msg; }

  function netSend(obj) {
    if (vsMode && net) {
      try { net.send(obj); } catch (e) { /* 切断間際は無視 */ }
    }
  }

  function leaveNet() {
    if (net) {
      try { net.send({ t: 'bye' }); } catch (e) { /* 切断済みなら無視 */ }
      try { net.close(); } catch (e) { /* 同上 */ }
    }
    net = null;
    netRole = null;
    vsMode = false;
    roomCode = null;
    vsStatus('');
  }

  function loadPeerJs() {
    if (window.Peer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function openLocal(role, code, cbs) {
    const bc = new BroadcastChannel('hida-kart-' + code);
    const conn = {
      send: (o) => bc.postMessage({ ...o, _r: role }),
      close: () => bc.close(),
    };
    bc.onmessage = (ev) => {
      if (ev.data && ev.data._r !== role) cbs.onMsg(ev.data);
    };
    setTimeout(() => cbs.onOpen(conn), 30);
  }

  function openPeer(role, code, cbs) {
    loadPeerJs().then(() => {
      const id = 'hida-kart-' + code;
      const peer = new Peer(role === 'host' ? id : undefined);
      const wire = (c) => {
        c.on('open', () => cbs.onOpen({
          send: (o) => c.send(o),
          close: () => { try { c.close(); } catch (e) {} try { peer.destroy(); } catch (e) {} },
        }));
        c.on('data', cbs.onMsg);
        c.on('close', cbs.onClose);
      };
      peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') vsStatus('そのコードのルームが見つかりません');
        else if (e.type === 'unavailable-id') vsStatus('コードが使用中です。もう一度作成してください');
        else vsStatus('接続エラーが発生しました（' + e.type + '）');
      });
      if (role === 'host') {
        peer.on('connection', wire);
      } else {
        peer.on('open', () => wire(peer.connect(id, { reliable: false })));
      }
    }).catch(() => vsStatus('通信ライブラリを読み込めませんでした'));
  }

  function startNet(role) {
    leaveNet();
    netRole = role;
    const code = role === 'host'
      ? String(1000 + Math.floor(Math.random() * 9000))
      : vsCodeInput.value.trim();
    if (!/^\d{4}$/.test(code)) { vsStatus('4けたのコードを入力してね'); return; }
    roomCode = code;
    vsStatus(role === 'host'
      ? `コード「${code}」を友だちに伝えてね。参加を待っています…`
      : '接続中…');
    const cbs = {
      onOpen: (conn) => {
        net = conn;
        if (role === 'guest') net.send({ t: 'join' });
      },
      onMsg: onNetMsg,
      onClose: onNetClosed,
    };
    (LOCAL_NET ? openLocal : openPeer)(role, code, cbs);
  }

  function onNetMsg(m) {
    if (!m || !m.t) return;
    if (m.t === 'join' && netRole === 'host' && !vsMode) {
      netSendRaw({ t: 'start', course: courseIdx, seed: courseSeed });
      beginVersus();
    } else if (m.t === 'start' && netRole === 'guest' && !vsMode) {
      buildCourse(m.course, m.seed);
      courseBtns.forEach((b, j) => b.classList.toggle('selected', j === m.course));
      beginVersus();
    } else if (m.t === 's' && remoteKart) {
      remoteTarget = m;
      remoteKart.wp = m.wp;
      remoteKart.lap = m.lap;
      if (m.b) remoteKart.boost = 0.2;
      if (m.n) remoteKart.spin = 0.2;
      if (m.lap > LAPS && !remoteKart.finished) {
        remoteKart.finished = true;
        finishOrder.push(remoteKart);
      }
    } else if (m.t === 'banana') {
      bananas.push({ x: m.x, y: m.y, arm: 0.6, id: m.id });
    } else if (m.t === 'bhit') {
      const i = bananas.findIndex((b) => b.id === m.id);
      if (i >= 0) bananas.splice(i, 1);
    } else if (m.t === 'box') {
      if (itemBoxes[m.i]) itemBoxes[m.i].respawn = 4;
    } else if (m.t === 'fin') {
      remoteFinish = m.time;
    } else if (m.t === 'bye') {
      onNetClosed();
    }
  }

  // vsMode確定前（start送信時）にも使う生送信
  function netSendRaw(obj) {
    if (net) { try { net.send(obj); } catch (e) { /* 無視 */ } }
  }

  function beginVersus() {
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    vsMode = true;
    resetRace(true);
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    vsMenu.classList.add('hidden');
    state = 'count';
    countT = 3.5;
  }

  function onNetClosed() {
    if (!net) return;
    const wasRacing = vsMode && state !== 'title';
    net = null;
    leaveNet();
    if (wasRacing) {
      msgEl.textContent = '相手との接続が切れました';
      setTimeout(() => {
        msgEl.textContent = '';
        state = 'title';
        hud.classList.add('hidden');
        panel.classList.remove('hidden');
        selectCourse(courseIdx);
      }, 2000);
    } else {
      vsStatus('接続が切れました');
    }
  }

  function netTick(now) {
    if (!vsMode || !net || !player) return;
    if (now - lastNetSend < 66) return; // 約15Hz
    lastNetSend = now;
    netSend({
      t: 's',
      x: player.x, y: player.y, a: player.a, sp: player.speed,
      wp: player.wp, lap: player.lap,
      b: player.boost > 0 ? 1 : 0,
      n: player.spin > 0 ? 1 : 0,
    });
  }

  document.getElementById('vs-btn').addEventListener('click', () => {
    initAudio();
    vsMenu.classList.toggle('hidden');
  });
  document.getElementById('vs-host').addEventListener('click', () => startNet('host'));
  document.getElementById('vs-join').addEventListener('click', () => startNet('guest'));

  // ===== コース選択UI =====
  const courseBtns = COURSES.map((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'course-btn';
    btn.innerHTML = `${c.name}<span>${'★'.repeat(c.stars)}${'☆'.repeat(3 - c.stars)} ・ ${c.laps}周</span>`;
    btn.addEventListener('click', () => selectCourse(i));
    courseSelEl.appendChild(btn);
    return btn;
  });

  function selectCourse(i) {
    buildCourse(i);
    resetRace();
    courseBtns.forEach((b, j) => b.classList.toggle('selected', j === i));
    panelTitle.textContent = '🏎️ カートレース';
    panelText.innerHTML = course.desc;
    resultsEl.classList.add('hidden');
    startBtn.textContent = 'スタート！';
    render(); // 背景プレビューを更新
  }

  // ===== メインループ =====
  let lastTime = performance.now();
  let lastCount = 4;

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (state === 'count') {
      countT -= dt;
      const n = Math.ceil(countT);
      if (n !== lastCount && n > 0) { beep(440, 0.15); lastCount = n; }
      if (countT <= 0) {
        state = 'race';
        msgEl.textContent = 'GO!';
        beep(880, 0.5);
        setTimeout(() => { if (state === 'race') msgEl.textContent = ''; }, 700);
      } else {
        msgEl.textContent = String(n);
      }
    }

    if (state === 'race' || state === 'finished') {
      if (!player.finished) raceTime += dt;
      updateWorld(dt);
      netTick(now);
    }

    if (state !== 'title') {
      render();
      updateHud();
    }
    itemPressed = false;
    requestAnimationFrame(loop);
  }

  // ===== 初期化 =====
  selectCourse(0);
  requestAnimationFrame(loop);

  // 検証用に最低限の状態を公開
  window.__kart = {
    get player() { return player; },
    get karts() { return karts; },
    get room() { return roomCode; },
    get state() { return state; },
    texURL: () => texCanvas.toDataURL(),
    isDirt, isRoad,
  };
})();
