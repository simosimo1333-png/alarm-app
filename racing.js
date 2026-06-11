// カートレース — モード7風の疑似3Dレーシングゲーム（飛騨地域コース集）
(() => {
  'use strict';

  // ===== 定数 =====
  const W = 480, H = 288;          // 内部解像度
  const HORIZON = 110;             // 地平線のy座標
  const FOCAL = 290;               // 焦点距離（投影スケール）
  const CAM_H = 34;                // カメラの高さ
  const CAM_BACK = 70;             // 自機の何ユニット後ろから見るか
  const TEX = 1024;                // コーステクスチャの一辺
  const N_WP = 400;                // ウェイポイント数

  const MAX_SPEED = 270;           // units/s
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
      stars: 1, laps: 3, roadW: 80,
      ctrl: [
        [512, 130], [780, 170], [880, 360], [820, 560], [890, 780],
        [680, 910], [460, 850], [300, 920], [140, 770], [190, 540],
        [120, 330], [310, 180],
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
      stars: 2, laps: 3, roadW: 70,
      ctrl: [
        [150, 150], [500, 120], [870, 150], [890, 420], [700, 470],
        [680, 650], [880, 720], [860, 900], [520, 880], [150, 900],
        [140, 650], [320, 560], [300, 400], [140, 380],
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
        deco: [['machiya', 4], ['lantern', 2]],
      },
    },
    {
      name: '白川郷 雪のサーキット',
      desc: '合掌造りの里・白川郷をめぐる雪道コース。ところどころ雪のダートですべる！',
      stars: 2, laps: 3, roadW: 76, turnMul: 0.85,
      dirt: { sections: 6, len: 9, mul: 0.68 },
      ctrl: [
        [220, 150], [560, 110], [860, 200], [900, 450], [780, 650],
        [820, 870], [560, 920], [300, 840], [330, 650], [450, 540],
        [330, 420], [140, 360], [130, 200],
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
      stars: 2, laps: 3, roadW: 72,
      ctrl: [
        [200, 140], [520, 100], [840, 160], [920, 400], [800, 560],
        [880, 760], [680, 910], [420, 820], [240, 900], [120, 720],
        [230, 560], [120, 400], [160, 220],
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
      stars: 3, laps: 2, roadW: 64,
      ctrl: [
        [150, 140], [560, 100], [880, 160],
        [930, 440], [870, 720], [700, 890],
        [400, 920], [170, 850],
        [150, 700], [560, 650], [650, 530],
        [220, 470], [150, 350], [600, 330],
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
  let hasDirt = false;   // 雪のダートがあるコースか
  let outA32 = 0, outB32 = 0; // テクスチャ範囲外の市松色
  let decorations = [];  // 沿道の飾り {x, y, type, size}
  let ridges = [];       // 山並み（パララックス）
  let skyGrad = null;
  let fogGrad = null;

  // オフスクリーンキャンバスとマスクは使い回す
  // （コース切替のたびに作り直すとモバイルでメモリを圧迫してクラッシュする）
  const texCanvas = document.createElement('canvas');
  texCanvas.width = texCanvas.height = TEX;
  const helperCanvas = document.createElement('canvas');
  helperCanvas.width = helperCanvas.height = TEX;
  const roadMask = new Uint8Array(TEX * TEX); // 1=道路
  const dirtMask = new Uint8Array(TEX * TEX); // 1=雪のダート

  function abgr(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
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
      const start = Math.floor(30 + (s * (N_WP - 70)) / n + Math.random() * 14);
      const len = course.dirt.len + Math.floor(Math.random() * 5);

      traceSegment(t, start, len);
      t.strokeStyle = '#edf3f6';
      t.lineWidth = ROADW - 4;
      t.stroke();
      // 雪の質感（薄い影のまだら）
      for (let j = 0; j < 40; j++) {
        const w = wps[(start + Math.floor(Math.random() * len)) % N_WP];
        const rx = -w.ty, ry = w.tx;
        const lat = (Math.random() - 0.5) * (ROADW - 18);
        t.fillStyle = 'rgba(160,180,190,0.5)';
        t.beginPath();
        t.arc(w.x + rx * lat, w.y + ry * lat, 1 + Math.random() * 2.5, 0, Math.PI * 2);
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

    // 地面（市松模様）
    for (let y = 0; y < TEX; y += 64) {
      for (let x = 0; x < TEX; x += 64) {
        t.fillStyle = ((x ^ y) & 64) ? theme.grassA : theme.grassB;
        t.fillRect(x, y, 64, 64);
      }
    }

    t.lineJoin = 'round';
    t.lineCap = 'round';

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

    // 路面
    tracePath(t);
    t.strokeStyle = theme.road;
    t.lineWidth = ROADW;
    t.stroke();

    // センターライン
    tracePath(t);
    t.strokeStyle = theme.line;
    t.lineWidth = 3;
    t.setLineDash([22, 26]);
    t.stroke();
    t.setLineDash([]);

    // 雪のダート区間（センターラインの上、スタートラインの下に描く）
    buildDirt(t);

    // スタートライン（市松）
    {
      const w0 = wps[0];
      const rx = -w0.ty, ry = w0.tx; // 道の横方向
      const sq = 8;
      for (let row = 0; row < 2; row++) {
        for (let k = -5; k < 5; k++) {
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
    // 高山の町家（格子と暖簾のある木造家屋）
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 80;
    const g = c.getContext('2d');
    // 屋根
    g.fillStyle = '#37474f';
    g.beginPath();
    g.moveTo(0, 30); g.lineTo(50, 12); g.lineTo(100, 30);
    g.lineTo(92, 38); g.lineTo(8, 38);
    g.closePath(); g.fill();
    // 壁（黒っぽい木造）
    g.fillStyle = '#4e342e';
    g.fillRect(8, 38, 84, 40);
    // 格子窓（灯りがともる）
    g.fillStyle = '#ffecb3';
    g.fillRect(16, 48, 30, 22);
    g.strokeStyle = '#3e2723';
    g.lineWidth = 2;
    for (let x = 20; x < 46; x += 6) {
      g.beginPath(); g.moveTo(x, 48); g.lineTo(x, 70); g.stroke();
    }
    // 入口と暖簾
    g.fillStyle = '#3e2723';
    g.fillRect(58, 46, 26, 32);
    g.fillStyle = '#1a237e';
    g.fillRect(58, 46, 26, 12);
    g.fillStyle = '#fff';
    g.fillRect(70, 48, 2, 8);
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
  const cloudSprite = makeEmojiSprite('☁️');

  const DECO = {
    tree:     { img: makeTreeSprite('#2e7d32', '#1b5e20', false), w: 46 },
    autumn:   { img: makeTreeSprite('#ef6c00', '#bf360c', false), w: 46 },
    snowtree: { img: makeTreeSprite('#2e7d32', '#1b5e20', true), w: 46 },
    gassho:   { img: makeGasshoSprite(), w: 120 },
    machiya:  { img: makeMachiyaSprite(), w: 100 },
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
      if (Math.random() < 0.45) continue;
      const type = table[(Math.random() * table.length) | 0];
      const big = DECO[type].w >= 90;
      const w = wps[i];
      const rx = -w.ty, ry = w.tx;
      const side = Math.random() < 0.5 ? -1 : 1;
      const lat = side * (ROADW / 2 + 34 + (big ? 30 : 0) + Math.random() * 55);
      const x = w.x + rx * lat;
      const y = w.y + ry * lat;
      if (x < 30 || y < 30 || x > TEX - 30 || y > TEX - 30) continue;
      if (isRoad(x, y)) continue;
      decorations.push({ x, y, type, size: 0.85 + Math.random() * 0.45 });
    }
  }

  function buildSky() {
    skyGrad = ctx.createLinearGradient(0, 0, 0, HORIZON);
    skyGrad.addColorStop(0, theme.skyTop);
    skyGrad.addColorStop(1, theme.skyBot);
    fogGrad = ctx.createLinearGradient(0, HORIZON, 0, HORIZON + 36);
    fogGrad.addColorStop(0, `rgba(${theme.fog},0.9)`);
    fogGrad.addColorStop(1, `rgba(${theme.fog},0)`);
    // 山並み（飛騨山脈っぽいシルエットを2層）
    ridges = theme.ridges.map((r) => ({
      ...r,
      peaks: Array.from({ length: 24 }, () => 0.35 + Math.random() * 0.65),
    }));
  }

  function buildCourse(idx) {
    courseIdx = idx;
    course = COURSES[idx];
    theme = course.theme;
    ROADW = course.roadW || 80;
    LAPS = course.laps || 3;
    buildTrack(course.ctrl);
    buildTexture();
    buildDecorations();
    buildSky();
  }

  // ===== カートスプライト（後ろ姿） =====
  function makeKartSprite(body, helmet) {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 40;
    const g = c.getContext('2d');
    // タイヤ
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.roundRect(2, 22, 11, 16, 4);
    g.roundRect(35, 22, 11, 16, 4);
    g.fill();
    // 車体
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(9, 18, 30, 16, 5);
    g.fill();
    // リアウィング
    g.fillStyle = body;
    g.fillRect(12, 12, 24, 4);
    g.fillRect(22, 14, 4, 6);
    // ドライバー（ヘルメット）
    g.fillStyle = helmet;
    g.beginPath();
    g.arc(24, 12, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(19, 10, 10, 3);
    // バンパー
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(11, 30, 26, 4);
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
  bindTouch('tc-left', 'left');
  bindTouch('tc-right', 'right');
  bindTouch('tc-gas', 'up');

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

  function resetRace() {
    karts = [];
    bananas = [];
    finishOrder = [];
    raceTime = 0;

    const grid = N_WP - 8;
    karts.push(spawnKart(CPU_DEFS[0], grid + 4, -22, false));
    karts.push(spawnKart(CPU_DEFS[1], grid + 4, 22, false));
    karts.push(spawnKart(CPU_DEFS[2], grid, -22, false));
    player = spawnKart({ name: 'あなた', body: '#e94560', helmet: '#fff' }, grid, 22, true);
    karts.push(player);

    itemBoxes = [];
    for (let i = 50; i < N_WP; i += 100) {
      const w = wps[i];
      const rx = -w.ty, ry = w.tx;
      for (const off of [-22, 0, 22]) {
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
    const target = wps[(k.wp + 7) % N_WP];
    const want = Math.atan2(target.y - k.y, target.x - k.x);
    let diff = want - k.a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return {
      steer: Math.max(-1, Math.min(1, diff * 3)),
      brake: Math.abs(diff) > 1.1 && k.speed > MAX_SPEED * 0.55,
    };
  }

  function updateKart(k, dt) {
    if (k.spin > 0) {
      k.spin -= dt;
      k.a += dt * 10;
      k.speed *= Math.max(0, 1 - 2.5 * dt);
      k.x += Math.cos(k.a) * k.speed * dt * 0.3;
      k.y += Math.sin(k.a) * k.speed * dt * 0.3;
      updateNearestWp(k);
      return;
    }

    let steer = 0, gas = false, brake = false;
    if (k.isPlayer && !DEMO && state === 'race' && !k.finished) {
      steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
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
    if (k.speed < -70) k.speed = -70;
    if (!gas && !brake && Math.abs(k.speed) < 4) k.speed = 0;

    const speedFactor = Math.min(1, Math.abs(k.speed) / (MAX_SPEED * 0.45));
    const turnMul = (course.turnMul || 1) * (onDirt ? 0.85 : 1);
    k.a += steer * TURN_RATE * turnMul * speedFactor * Math.sign(k.speed || 1) * dt;

    k.x += Math.cos(k.a) * k.speed * dt;
    k.y += Math.sin(k.a) * k.speed * dt;
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
      bananas.push({
        x: k.x - Math.cos(k.a) * 42,
        y: k.y - Math.sin(k.a) * 42,
        arm: 0.6,
      });
      if (k.isPlayer) beep(330, 0.15);
    }
    k.item = null;
  }

  function updateWorld(dt) {
    for (const k of karts) updateKart(k, dt);

    // カート同士の押し合い
    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i], b = karts[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < 26) {
          const push = (26 - d) / 2;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          a.speed *= 0.97; b.speed *= 0.97;
        }
      }
    }

    // アイテムボックス
    for (const box of itemBoxes) {
      if (box.respawn > 0) { box.respawn -= dt; continue; }
      for (const k of karts) {
        if (k.item || k.finished) continue;
        if (Math.hypot(k.x - box.x, k.y - box.y) < 22) {
          k.item = Math.random() < 0.6 ? 'boost' : 'banana';
          k.aiItemT = 1.5 + Math.random() * 3;
          box.respawn = 4;
          if (k.isPlayer) { beep(660, 0.12, 0.1, 'triangle'); buzz(20); }
          break;
        }
      }
    }

    // バナナ
    for (let i = bananas.length - 1; i >= 0; i--) {
      const bn = bananas[i];
      bn.arm -= dt;
      if (bn.arm > 0) continue;
      for (const k of karts) {
        if (k.spin > 0) continue;
        if (Math.hypot(k.x - bn.x, k.y - bn.y) < 20) {
          k.spin = 1;
          k.speed *= 0.25;
          bananas.splice(i, 1);
          if (k.isPlayer) { beep(180, 0.4, 0.15, 'sawtooth'); buzz([60, 50, 60]); }
          break;
        }
      }
    }
  }

  // ===== レンダリング =====
  const groundImg = ctx.createImageData(W, H - HORIZON);
  const ground32 = new Uint32Array(groundImg.data.buffer);

  function renderGround(camX, camY, dirX, dirY) {
    const rxv = -dirY, ryv = dirX; // カメラの右方向
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
    ctx.putImageData(groundImg, 0, HORIZON);
  }

  function renderSky(heading) {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, HORIZON);

    // 山並み（パララックスつき）
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
        ctx.lineTo(x, HORIZON - r.amp * hv);
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
          const py = HORIZON - r.amp * r.peaks[i];
          const cap = r.amp * r.peaks[i] * 0.32;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - cap * 0.8, py + cap);
          ctx.lineTo(px + cap * 0.8, py + cap);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // 視点に合わせて流れる雲
    const cspan = W * 4;
    for (let i = 0; i < 6; i++) {
      const base = i * cspan / 6;
      let x = (base - heading / (Math.PI * 2) * cspan) % cspan;
      if (x < 0) x += cspan;
      ctx.drawImage(cloudSprite, x - 44, ((i * 37) % 40) - 12, 28, 28);
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
      if (pr && pr.fz < 1100 && pr.fz > 22) items.push({ ...pr, type: 'deco', deco: d });
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
    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.45, h * 0.16, 0, 0, Math.PI * 2);
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
    const lean = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 0.08;
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
          pr.x + (Math.random() - 0.5) * 130,
          pr.y + 2 + Math.random() * 14,
          1.5 + Math.random() * 3, 0, Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  function renderFog() {
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, HORIZON, W, 36);
  }

  function renderMinimap() {
    const S = 120 / TEX;
    mmCtx.clearRect(0, 0, 120, 120);
    mmCtx.fillStyle = 'rgba(0,0,0,0.35)';
    mmCtx.beginPath();
    mmCtx.roundRect(0, 0, 120, 120, 14);
    mmCtx.fill();
    mmCtx.beginPath();
    mmCtx.moveTo(wps[0].x * S, wps[0].y * S);
    for (let i = 1; i < N_WP; i++) mmCtx.lineTo(wps[i].x * S, wps[i].y * S);
    mmCtx.closePath();
    mmCtx.strokeStyle = 'rgba(255,255,255,0.75)';
    mmCtx.lineWidth = 4;
    mmCtx.stroke();
    for (const k of karts) {
      mmCtx.fillStyle = k.color;
      mmCtx.beginPath();
      mmCtx.arc(k.x * S, k.y * S, k.isPlayer ? 4 : 3, 0, Math.PI * 2);
      mmCtx.fill();
      if (k.isPlayer) {
        mmCtx.strokeStyle = '#fff';
        mmCtx.lineWidth = 1.5;
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
    resetRace();
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    state = 'count';
    countT = 3.5;
  }
  startBtn.addEventListener('click', startRace);

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

  // 観戦モードでは検証用に最低限の状態を公開
  if (DEMO) {
    window.__kart = {
      get player() { return player; },
      isDirt, isRoad,
    };
  }
})();
