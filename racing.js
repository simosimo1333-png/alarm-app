// カートレース — モード7風の疑似3Dレーシングゲーム（飛騨地域コース集）
(() => {
  'use strict';

  // ===== 定数 =====
  const W = 750, H = 450;          // 内部解像度（高精細化）
  const HORIZON = 172;             // 地平線のy座標
  const FOCAL = 454;               // 焦点距離（投影スケール）
  const CAM_H = 34;                // カメラの高さ
  const CAM_BACK = 70;             // 自機の何ユニット後ろから見るか
  const TEX = 1800;                // コーステクスチャの一辺（ワールドの広さ）
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
  const sctx = document.getElementById('sky').getContext('2d'); // 空（背面レイヤー）
  // 3Dレンダラー（WebGL）。?2d=1 か非対応環境ではモード7にフォールバック
  let GL3D = null;
  if (!new URLSearchParams(location.search).has('2d') && window.KartGL) {
    try {
      GL3D = window.KartGL.create(document.getElementById('game3d'), {
        worldSize: TEX,
        horizonFrac: HORIZON / H,
      });
    } catch (e) { GL3D = null; }
  }
  if (!GL3D) document.getElementById('game3d').style.display = 'none';
  const mmCanvas = document.getElementById('minimap');
  const mmCtx = mmCanvas.getContext('2d');
  const hud = document.getElementById('hud');
  const hudPos = document.getElementById('hud-pos');
  const hudName = document.getElementById('hud-name');
  const hudLap = document.getElementById('hud-lap');
  const hudTime = document.getElementById('hud-time');
  const hudSpeed = document.getElementById('hud-speed');
  const hudItem = document.getElementById('hud-item');
  const msgEl = document.getElementById('message');
  const wrongwayEl = document.getElementById('wrongway');
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
      stars: 1, laps: 3, roadW: 165,
      ctrl: [
        [700, 130], [1010, 170], [1230, 330], [1280, 620], [1180, 880],
        [1260, 1130], [1040, 1290], [760, 1230], [520, 1300], [260, 1240],
        [140, 1010], [210, 770], [120, 520], [230, 290], [460, 160],
      ],
      elev: [[0, 0], [0.15, 0], [0.32, 36], [0.45, 36], [0.6, 8], [0.8, 0]],
      theme: {
        grassA: '#2e7d32', grassB: '#276b2b',
        road: '#5b5b66', curbA: '#d32f2f', curbB: '#f5f5f5',
        line: 'rgba(255,255,255,0.55)',
        skyTop: '#4fc3f7', skyBot: '#c8eefb', fog: '200,238,251',
        ridges: [
          { color: '#9bc4d6', amp: 30, speed: 60, snow: true },
          { color: '#5d8aa0', amp: 20, speed: 110 },
        ],
        deco: [['tree', 6], ['cow', 1], ['flower', 2]],
        ambient: 'fluff', skyFx: 'balloon',
      },
    },
    {
      name: '高山 古い町並みGP',
      desc: '夕暮れの城下町。町家・祭屋台・さるぼぼ・みたらし団子がお出迎え。',
      stars: 2, laps: 3, roadW: 150,
      // 先頭はスタート地点。直線区間に置く（急コーナー上だとwp追跡が乱れる）
      ctrl: [
        [620, 130], [1090, 160], [1270, 330], [1250, 620],
        [1060, 720], [1040, 950], [1240, 1060], [1230, 1270], [900, 1290],
        [560, 1250], [200, 1280], [130, 1040], [330, 930], [310, 700],
        [140, 600], [150, 360], [180, 170],
      ],
      elev: [[0, 0], [0.18, 0], [0.27, 16], [0.34, 0], [0.52, 0], [0.66, 34], [0.78, 34], [0.9, 0]],
      // 宮川（町を南北に流れ、コースは鍛冶橋・中橋で2回渡る）
      river: [[700, 0], [688, 260], [712, 620], [694, 980], [706, 1400]],
      bridges: [[640, 1348], [760, 1348], [645, 68], [758, 68]],
      theme: {
        grassA: '#9c8a72', grassB: '#92805f',
        road: '#45454d', curbA: '#b71c1c', curbB: '#eeeeee',
        line: 'rgba(255,255,255,0.5)',
        skyTop: '#7986cb', skyBot: '#ffcc80', fog: '255,224,178',
        ridges: [
          { color: '#9b8aa8', amp: 26, speed: 60 },
          { color: '#7c6b91', amp: 18, speed: 110 },
        ],
        deco: [['machiya', 3], ['sakagura', 2], ['yatai', 1], ['lantern', 1], ['nakabashi', 1], ['sarubobo', 2], ['dango', 1], ['torii', 1], ['nobori', 1]],
        ambient: 'sakura', skyFx: 'fireworks',
        light: { dir: [-0.75, -0.5, 0.2], color: [1, 0.8, 0.63], amb: 0.55 },
      },
    },
    {
      name: '白川郷 雪のサーキット',
      desc: '合掌造りの里・白川郷をめぐる雪道コース。ところどころ雪のダートですべる！',
      stars: 2, laps: 3, roadW: 160, turnMul: 0.85,
      dirt: { sections: 7, len: 14, mul: 0.68 },
      ctrl: [
        [700, 120], [1100, 180], [1290, 420], [1230, 690],
        [1050, 840], [1130, 1090], [950, 1270], [640, 1300], [330, 1230],
        [150, 1010], [260, 820], [430, 700], [330, 540], [150, 430],
        [170, 250], [300, 180],
      ],
      elev: [[0, 0], [0.2, 0], [0.42, 28], [0.58, 28], [0.78, 0]],
      // 庄川と荻町の合掌集落
      river: [[760, 0], [748, 300], [770, 700], [752, 1050], [762, 1400]],
      village: [560, 780],
      theme: {
        grassA: '#f2f6f7', grassB: '#e3ecef',
        road: '#62707c', curbA: '#1565c0', curbB: '#ffffff',
        line: 'rgba(255,255,255,0.6)',
        skyTop: '#a6cfe3', skyBot: '#f0f8fc', fog: '240,248,252',
        ridges: [
          { color: '#d4e3ec', amp: 32, speed: 60, snow: true },
          { color: '#aac4d4', amp: 20, speed: 110, snow: true },
        ],
        deco: [['gassho', 3], ['snowtree', 3], ['snowman', 1], ['waterwheel', 1]],
        ambient: 'snow', skyFx: 'village',
        light: { dir: [-0.4, -0.85, 0.3], color: [0.93, 0.97, 1], amb: 0.74 },
      },
    },
    {
      name: '乗鞍スカイライン',
      desc: '雲の上を走る天空の山岳道路。ながれるような高速コーナーが続く。',
      stars: 2, laps: 3, roadW: 155,
      // 実際の乗鞍スカイライン: 平湯峠からスイッチバックで登り、
      // 畳平の山頂台地を回って反対側の長い下りで戻る
      ctrl: [
        [700, 1290], [330, 1250], [150, 1080],
        [430, 970], [720, 930], [870, 800],
        [480, 740], [190, 700],
        [400, 540], [700, 490], [880, 360],
        [560, 300], [280, 250],
        [480, 95], [820, 105],
        [1120, 220], [1280, 520], [1240, 900], [1090, 1180],
      ],
      elev: [[0, 0], [0.08, 5], [0.66, 110], [0.76, 110], [0.97, 0]],
      theme: {
        grassA: '#6b7d62', grassB: '#5f7057',
        road: '#4c5258', curbA: '#f9a825', curbB: '#ffffff',
        line: 'rgba(255,255,255,0.55)',
        skyTop: '#1565c0', skyBot: '#bbdefb', fog: '227,242,253',
        ridges: [
          { color: '#e3edf4', amp: 42, speed: 60, snow: true },
          { color: '#90a8ba', amp: 26, speed: 110, snow: true },
        ],
        deco: [['rock', 3], ['snowtree', 2], ['goat', 1], ['flower', 1]],
        ambient: 'mist', skyFx: 'birds',
      },
    },
    {
      name: '奥飛騨 つづら折り峠',
      desc: '紅葉の奥飛騨をのぼる、狭い道とヘアピン連続の難関峠コース。',
      stars: 3, laps: 2, roadW: 132,
      ctrl: [
        [720, 110], [1180, 170],
        [1290, 440], [1230, 800], [1280, 1100], [1060, 1280],
        [620, 1310], [260, 1260],
        [170, 1060], [760, 1000], [900, 840],
        [300, 760], [170, 580], [820, 520],
        [180, 160],
      ],
      elev: [[0, 0], [0.12, 0], [0.35, 0], [0.5, 12], [0.82, 78], [0.86, 78], [0.97, 0]],
      // 蒲田川（谷あいの渓流）
      river: [[1396, 980], [1150, 1010], [980, 1180], [940, 1396]],
      theme: {
        grassA: '#4f7a2e', grassB: '#456c28',
        road: '#50565e', curbA: '#ef6c00', curbB: '#ffffff',
        line: 'rgba(255,255,255,0.55)',
        skyTop: '#5ab0e0', skyBot: '#ffe6c2', fog: '255,230,194',
        ridges: [
          { color: '#8c9fb0', amp: 34, speed: 60, snow: true },
          { color: '#6d8296', amp: 22, speed: 110 },
        ],
        deco: [['autumn', 3], ['tree', 2], ['onsen', 1], ['flower', 1]],
        ambient: 'leaves',
        light: { dir: [-0.55, -0.7, 0.3], color: [1, 0.92, 0.8], amb: 0.6 },
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
  let hillSlope = [];    // 各wpの坂の勾配（登り>0）
  let horY = HORIZON;    // 坂で上下する動的な地平線
  let pads = [];         // ダッシュボード/ジャンプ台 {start, len, type}

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
    // 制御点は1400基準で定義されているのでワールドサイズに合わせて拡大
    const S = TEX / 1400;
    const pts = ctrl.map((p) => [p[0] * S, p[1] * S]);
    // N_WP個を全周に均等配置（端数で重複点を作らない）
    for (let i = 0; i < N_WP; i++) {
      const f = (i / N_WP) * segs;
      const s = Math.floor(f) % segs;
      const p0 = pts[(s - 1 + segs) % segs];
      const p1 = pts[s];
      const p2 = pts[(s + 1) % segs];
      const p3 = pts[(s + 2) % segs];
      const [x, y] = catmullRom(p0, p1, p2, p3, f - Math.floor(f));
      wps.push({ x, y, tx: 0, ty: 0 });
    }
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

    // コース外のにぎやかし: 田畑と池（道路はこの上に描かれる）
    for (let i = 0; i < 12; i++) {
      const x = 120 + rnd() * (TEX - 240);
      const y = 120 + rnd() * (TEX - 240);
      if (i < 3) {
        // 池
        const r = 50 + rnd() * 55;
        t.fillStyle = '#7ba7c9';
        t.beginPath();
        t.ellipse(x, y, r * 1.25, r * 0.85, rnd() * 3, 0, Math.PI * 2);
        t.fill();
        t.fillStyle = '#5b8fb9';
        t.beginPath();
        t.ellipse(x, y, r * 1.05, r * 0.68, 0, 0, Math.PI * 2);
        t.fill();
      } else {
        // 段々の畑（縞模様）
        const fw = 110 + rnd() * 140, fh = 80 + rnd() * 110;
        const ang = rnd() * Math.PI;
        t.save();
        t.translate(x, y);
        t.rotate(ang);
        t.fillStyle = 'rgba(0,0,0,0.13)';
        t.fillRect(-fw / 2 - 4, -fh / 2 - 4, fw + 8, fh + 8);
        for (let s = 0; s < fh; s += 14) {
          t.fillStyle = (s / 14) % 2 ? 'rgba(190,205,120,0.5)' : 'rgba(110,150,80,0.45)';
          t.fillRect(-fw / 2, -fh / 2 + s, fw, 14);
        }
        t.restore();
      }
    }

    // 標高による地表の変化（森林限界の上は岩肌、さらに上は残雪）
    if ((course.elev || []).some((e) => e[1] > 55)) {
      for (let by = 0; by < TEX; by += 8) {
        for (let bx = 0; bx < TEX; bx += 8) {
          const h = heightAt(bx + 4, by + 4);
          if (h > 52) {
            const k = Math.min(1, (h - 52) / 28);
            t.fillStyle = `rgba(124,114,102,${(0.45 * k).toFixed(3)})`;
            t.fillRect(bx, by, 8, 8);
            if (h > 92) {
              t.fillStyle = `rgba(244,248,251,${Math.min(0.85, (h - 92) / 16).toFixed(3)})`;
              t.fillRect(bx, by, 8, 8);
            }
          }
        }
      }
    }

    // 実在の川（宮川・庄川・蒲田川）。道路は後から上に描かれて橋になる
    if (course.river) {
      const S = TEX / 1400;
      const pts = course.river.map((p) => [p[0] * S, p[1] * S]);
      t.lineJoin = 'round';
      t.lineCap = 'round';
      const drawRiver = (width, color) => {
        t.strokeStyle = color;
        t.lineWidth = width;
        t.beginPath();
        t.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const mx = (pts[i - 1][0] + pts[i][0]) / 2;
          const my = (pts[i - 1][1] + pts[i][1]) / 2;
          t.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
        }
        t.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        t.stroke();
      };
      drawRiver(46, '#8a9478');             // 川岸
      drawRiver(34, '#5b8fb9');             // 水面
      drawRiver(30, '#6f9fc8');
      // 流れのきらめき
      t.strokeStyle = 'rgba(255,255,255,0.35)';
      t.lineWidth = 3;
      t.setLineDash([14, 30]);
      drawRiver(3, 'rgba(255,255,255,0.35)');
      t.setLineDash([]);
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

    // ダッシュボード / ジャンプ台
    t.lineCap = 'butt';
    for (const pad of pads) {
      traceSegment(t, pad.start, pad.len);
      t.strokeStyle = pad.type === 'dash' ? '#ff8f00' : pad.type === 'glide' ? '#00acc1' : '#3949ab';
      t.lineWidth = ROADW - 10;
      t.stroke();
      if (pad.type === 'dash') {
        // 進行方向の矢羽根
        t.strokeStyle = '#fff';
        t.lineWidth = 5;
        for (let j = 1; j < pad.len; j += 2) {
          const w = wps[(pad.start + j) % N_WP];
          const rx = -w.ty, ry = w.tx;
          const span = ROADW * 0.26;
          t.beginPath();
          t.moveTo(w.x - rx * span - w.tx * 10, w.y - ry * span - w.ty * 10);
          t.lineTo(w.x + w.tx * 8, w.y + w.ty * 8);
          t.lineTo(w.x + rx * span - w.tx * 10, w.y + ry * span - w.ty * 10);
          t.stroke();
        }
      } else {
        // 横縞 + 踏み切りの黄色いふち
        t.strokeStyle = 'rgba(255,255,255,0.85)';
        t.lineWidth = 3;
        for (let j = 0; j < pad.len; j++) {
          const w = wps[(pad.start + j) % N_WP];
          const rx = -w.ty, ry = w.tx;
          const span = ROADW * 0.4;
          t.beginPath();
          t.moveTo(w.x - rx * span, w.y - ry * span);
          t.lineTo(w.x + rx * span, w.y + ry * span);
          t.stroke();
        }
        const lip = wps[(pad.start + pad.len) % N_WP];
        const rx = -lip.ty, ry = lip.tx;
        t.strokeStyle = '#ffd54a';
        t.lineWidth = 8;
        t.beginPath();
        t.moveTo(lip.x - rx * ROADW * 0.42, lip.y - ry * ROADW * 0.42);
        t.lineTo(lip.x + rx * ROADW * 0.42, lip.y + ry * ROADW * 0.42);
        t.stroke();
      }
    }
    t.lineCap = 'round';

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

  function makeSaruboboSprite() {
    // さるぼぼ（飛騨のお守り人形。顔がないのが特徴）
    const c = document.createElement('canvas');
    c.width = 56;
    c.height = 76;
    const g = c.getContext('2d');
    // 頭巾（黒）
    g.fillStyle = '#26221f';
    g.beginPath();
    g.moveTo(28, 2); g.lineTo(9, 27); g.lineTo(47, 27);
    g.closePath(); g.fill();
    // 顔（赤・のっぺらぼう）
    g.fillStyle = '#d23a2e';
    g.beginPath();
    g.arc(28, 26, 13, 0, Math.PI * 2);
    g.fill();
    // 手足（バンザイのX字）
    g.strokeStyle = '#d23a2e';
    g.lineWidth = 11;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(28, 44); g.lineTo(7, 34);
    g.moveTo(28, 44); g.lineTo(49, 34);
    g.moveTo(28, 56); g.lineTo(11, 72);
    g.moveTo(28, 56); g.lineTo(45, 72);
    g.stroke();
    // 胴体
    g.fillStyle = '#d23a2e';
    g.beginPath();
    g.ellipse(28, 50, 15, 16, 0, 0, Math.PI * 2);
    g.fill();
    // 腹掛け（黒菱形）
    g.fillStyle = '#26221f';
    g.beginPath();
    g.moveTo(28, 40); g.lineTo(38, 52); g.lineTo(28, 64); g.lineTo(18, 52);
    g.closePath(); g.fill();
    return c;
  }

  function makeDangoSprite() {
    // みたらし団子の屋台（宮川朝市の名物）
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 88;
    const g = c.getContext('2d');
    // 赤白の庇
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? '#fff' : '#d23a2e';
      g.fillRect(4 + i * 12, 10, 12, 16);
    }
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(4, 22, 72, 4);
    // 柱とカウンター
    g.fillStyle = '#8d6e63';
    g.fillRect(8, 26, 5, 56);
    g.fillRect(67, 26, 5, 56);
    g.fillStyle = '#6d4c41';
    g.fillRect(8, 60, 64, 22);
    // 看板
    g.fillStyle = '#fff8e1';
    g.fillRect(20, 32, 28, 22);
    g.strokeStyle = '#6d4c41';
    g.lineWidth = 2;
    g.strokeRect(20, 32, 28, 22);
    g.fillStyle = '#5d4037';
    g.font = 'bold 11px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('だんご', 34, 43);
    // みたらし団子の串
    g.strokeStyle = '#a1887f';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(58, 28); g.lineTo(58, 58);
    g.stroke();
    g.fillStyle = '#c98e4a';
    for (const y of [33, 43, 53]) {
      g.beginPath();
      g.arc(58, y, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.45)';
    for (const y of [31, 41, 51]) {
      g.beginPath();
      g.arc(56, y, 2, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  function makeToriiSprite() {
    // 桜山八幡宮の朱の鳥居
    const c = document.createElement('canvas');
    c.width = 84;
    c.height = 76;
    const g = c.getContext('2d');
    g.fillStyle = '#c0392b';
    // 柱
    g.fillRect(14, 20, 9, 56);
    g.fillRect(61, 20, 9, 56);
    // 笠木（上の横木）と黒い屋根
    g.fillRect(2, 10, 80, 9);
    g.fillStyle = '#26221f';
    g.fillRect(0, 7, 84, 5);
    // 貫（下の横木）
    g.fillStyle = '#c0392b';
    g.fillRect(8, 28, 68, 7);
    // 額束
    g.fillStyle = '#fff8e1';
    g.fillRect(37, 19, 10, 12);
    return c;
  }

  function makeGrandstandSprite() {
    // 観客席（スタート地点の応援スタンド）
    const c = document.createElement('canvas');
    c.width = 150;
    c.height = 96;
    const g = c.getContext('2d');
    // 屋根（青白ストライプ）
    g.fillStyle = '#1565c0';
    g.fillRect(0, 0, 150, 16);
    g.fillStyle = '#fff';
    for (let x = 8; x < 150; x += 24) g.fillRect(x, 0, 12, 16);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 13, 150, 3);
    // 支柱
    g.fillStyle = '#78909c';
    g.fillRect(4, 16, 7, 78);
    g.fillRect(139, 16, 7, 78);
    // 段々と観客（カラフルな頭）
    const heads = ['#ef5350', '#ffca28', '#66bb6a', '#42a5f5', '#ab47bc', '#ff7043', '#fff'];
    for (let row = 0; row < 4; row++) {
      const y = 24 + row * 18;
      g.fillStyle = '#90a4ae';
      g.fillRect(8, y + 10, 134, 8);
      for (let i = 0; i < 15; i++) {
        g.fillStyle = heads[(i * 5 + row * 3) % heads.length];
        g.beginPath();
        g.arc(15 + i * 8.6 + ((row * 7 + i * 3) % 4), y + 5, 3.6, 0, Math.PI * 2);
        g.fill();
      }
    }
    return c;
  }

  function makeNoboriSprite() {
    // のぼり旗（祭の応援）
    const c = document.createElement('canvas');
    c.width = 36;
    c.height = 92;
    const g = c.getContext('2d');
    // 竿
    g.fillStyle = '#8d6e63';
    g.fillRect(4, 2, 4, 90);
    g.fillRect(4, 4, 28, 3);
    // 旗（朱地に白文字）
    g.fillStyle = '#d23a2e';
    g.fillRect(10, 8, 22, 62);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.strokeRect(11, 9, 20, 60);
    g.fillStyle = '#fff';
    g.font = 'bold 15px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('祭', 21, 26);
    g.fillText('り', 21, 48);
    return c;
  }

  function makeFlowerSprite() {
    // 花畑のしげみ
    const c = document.createElement('canvas');
    c.width = 56;
    c.height = 36;
    const g = c.getContext('2d');
    g.fillStyle = '#4c7d3a';
    g.beginPath();
    g.ellipse(28, 28, 26, 9, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5b9446';
    g.beginPath();
    g.ellipse(28, 24, 22, 9, 0, 0, Math.PI * 2);
    g.fill();
    const cols = ['#ff8fab', '#fff', '#ffd54a', '#ff8fab', '#fff'];
    for (let i = 0; i < 12; i++) {
      g.fillStyle = cols[i % cols.length];
      g.beginPath();
      g.arc(8 + (i * 37) % 42, 18 + (i * 13) % 12, 2.6, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  function makeWaterwheelSprite() {
    // 水車小屋（白川郷の里山風景）
    const c = document.createElement('canvas');
    c.width = 104;
    c.height = 92;
    const g = c.getContext('2d');
    // 小屋
    g.fillStyle = '#8d6e63';
    g.beginPath();
    g.moveTo(64, 8); g.lineTo(40, 36); g.lineTo(88, 36);
    g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(64, 6); g.lineTo(52, 20); g.lineTo(76, 20);
    g.closePath(); g.fill();
    g.fillStyle = '#efebe9';
    g.fillRect(46, 36, 36, 50);
    g.fillStyle = '#4e342e';
    g.fillRect(58, 62, 14, 24);
    // 水車
    g.strokeStyle = '#5d4037';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(26, 58, 24, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(26, 58);
      g.lineTo(26 + Math.cos(a) * 24, 58 + Math.sin(a) * 24);
      g.stroke();
    }
    g.fillStyle = '#6d4c41';
    g.beginPath();
    g.arc(26, 58, 5, 0, Math.PI * 2);
    g.fill();
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

  // 雪玉（飛び道具）
  function makeSnowballSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 44;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(17, 15, 3, 22, 22, 20);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.7, '#e8f2f8');
    rg.addColorStop(1, '#b9cfdd');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(22, 22, 19, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(160,185,200,0.6)';
    for (const [x, y, r] of [[14, 24, 2], [28, 16, 1.6], [24, 30, 1.8]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }
  const snowballSprite = makeSnowballSprite();

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

  // 熱気球（高原コースの空に浮かぶ）
  function makeBalloonSprite() {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 64;
    const g = c.getContext('2d');
    // 球皮（カラフルな縦縞）
    g.save();
    g.beginPath();
    g.arc(24, 20, 17, 0, Math.PI * 2);
    g.clip();
    const stripes = ['#e74c3c', '#f6c344', '#3aa3dd', '#e74c3c', '#f6c344', '#3aa3dd'];
    for (let i = 0; i < 6; i++) {
      g.fillStyle = stripes[i];
      g.fillRect(7 + i * 6, 2, 6, 38);
    }
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(24, 20, 17, 0, Math.PI * 2);
    g.stroke();
    // 吊りロープとバスケット
    g.strokeStyle = '#6d4c41';
    g.beginPath();
    g.moveTo(16, 34); g.lineTo(20, 50);
    g.moveTo(32, 34); g.lineTo(28, 50);
    g.stroke();
    g.fillStyle = '#8d6e63';
    g.fillRect(18, 50, 12, 9);
    return c;
  }
  const balloonSprite = makeBalloonSprite();

  // コースごとの環境パーティクル（雪・桜・紅葉・綿毛・霧）
  let ambient = [];
  let ambientType = null;
  function buildAmbient() {
    ambientType = theme.ambient || null;
    ambient = [];
    if (!ambientType) return;
    const n = ambientType === 'mist' ? 7 : 42;
    for (let i = 0; i < n; i++) {
      ambient.push({
        x: Math.random() * W,
        y: Math.random() * H,
        v: 0.5 + Math.random(),
        r: Math.random(),
        ph: Math.random() * Math.PI * 2,
      });
    }
  }

  function renderAmbient() {
    if (!ambientType) return;
    const t = performance.now() / 1000;
    for (const p of ambient) {
      if (ambientType === 'snow') {
        p.y += p.v * 1.1;
        p.x += Math.sin(t * 1.5 + p.ph) * 0.5;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 + p.r * 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (ambientType === 'sakura') {
        p.y += p.v * 0.8;
        p.x += 0.6 + Math.sin(t * 2 + p.ph) * 0.9;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(t * 2 + p.ph);
        ctx.fillStyle = p.r > 0.5 ? 'rgba(255,183,197,0.9)' : 'rgba(255,160,180,0.85)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.6 + p.r * 2, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (ambientType === 'leaves') {
        p.y += p.v * 1.3;
        p.x += Math.sin(t * 2.2 + p.ph) * 1.2;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(t * 3 + p.ph);
        ctx.fillStyle = p.r > 0.66 ? '#e07a2f' : p.r > 0.33 ? '#c84f2f' : '#d9a032';
        ctx.fillRect(-3, -2, 6 + p.r * 3, 4);
        ctx.restore();
      } else if (ambientType === 'fluff') {
        p.y += Math.sin(t * 0.9 + p.ph) * 0.3 - 0.1;
        p.x += 0.35 + p.v * 0.25;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.4 + p.r * 1.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (ambientType === 'mist') {
        p.x += 0.35 + p.v * 0.4;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.ellipse(p.x, HORIZON * 0.6 + p.ph * 28, 130 + p.r * 160, 17 + p.r * 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 画面外に出たら反対側から
      if (p.y > H + 12) { p.y = -10; p.x = Math.random() * W; }
      if (p.y < -14) p.y = H + 8;
      if (p.x > W + 180) p.x = -170;
      if (p.x < -180) p.x = W + 170;
    }
  }

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
    sarubobo: { img: makeSaruboboSprite(), w: 42 },
    dango:    { img: makeDangoSprite(), w: 66 },
    torii:    { img: makeToriiSprite(), w: 82 },
    onsen:    { img: makeOnsenSprite(), w: 36 },
    rock:     { img: makeRockSprite(), w: 50 },
    grandstand: { img: makeGrandstandSprite(), w: 150 },
    nobori:   { img: makeNoboriSprite(), w: 30 },
    flower:   { img: makeFlowerSprite(), w: 40 },
    waterwheel: { img: makeWaterwheelSprite(), w: 88 },
    cow:      { img: makeEmojiSprite('🐄'), w: 26 },
    lantern:  { img: makeEmojiSprite('🏮'), w: 20 },
    snowman:  { img: makeEmojiSprite('⛄'), w: 30 },
    goat:     { img: makeEmojiSprite('🐐'), w: 24 },
  };

  // wpの横（lat倍率）に飾りを置く。道路上や場外はスキップ
  function placeDeco(wpIdx, lat, type, size) {
    const w = wps[(wpIdx + N_WP) % N_WP];
    const x = w.x - w.ty * lat;
    const y = w.y + w.tx * lat;
    if (x < 30 || y < 30 || x > TEX - 30 || y > TEX - 30) return;
    if (isRoad(x, y)) return;
    decorations.push({ x, y, type, size: size || 1 });
  }

  function buildDecorations() {
    decorations = [];
    // 出現テーブル（重みつき）
    const table = [];
    for (const [type, weight] of theme.deco) {
      for (let i = 0; i < weight; i++) table.push(type);
    }
    // 森林限界より上では木が生えない（岩肌に合わせて岩へ）
    const highCourse = (course.elev || []).some((e) => e[1] > 55);
    const adjustForAltitude = (type, x, y) => {
      if (!highCourse) return type;
      if (heightAt(x, y) > 56 && DECO[type].w < 90 && type !== 'rock' && type !== 'goat') return 'rock';
      return type;
    };
    for (let i = 26; i < N_WP - 14; i += 4) {
      if (rnd() < 0.35) continue;
      let type = table[(rnd() * table.length) | 0];
      const big = DECO[type].w >= 90;
      const side = rnd() < 0.5 ? -1 : 1;
      // 25%は遠めの2列目に置いて奥行きを出す
      const lat = side * (ROADW / 2 + 34 + (big ? 30 : 0) + rnd() * 55 + (rnd() < 0.25 ? 100 : 0));
      const w = wps[i];
      type = adjustForAltitude(type, w.x - w.ty * lat, w.y + w.tx * lat);
      placeDeco(i, lat, type, 0.85 + rnd() * 0.45);
    }
    // 荻町の合掌集落（白川郷）
    if (course.village) {
      const S = TEX / 1400;
      for (let i = 0; i < 9; i++) {
        const x = (course.village[0] + (rnd() - 0.5) * 280) * S;
        const y = (course.village[1] + (rnd() - 0.5) * 330) * S;
        if (x < 40 || y < 40 || x > TEX - 40 || y > TEX - 40 || isRoad(x, y)) continue;
        decorations.push({ x, y, type: i % 3 === 2 ? 'snowtree' : 'gassho', size: 0.9 + rnd() * 0.35 });
      }
    }
    // 川を渡る場所の橋の欄干（中橋など）
    if (course.bridges) {
      const S = TEX / 1400;
      for (const [bx, by] of course.bridges) {
        const x = bx * S, y = by * S;
        if (!isRoad(x, y)) decorations.push({ x, y, type: 'nakabashi', size: 0.85 });
      }
    }
    // スタート地点: 観客席とのぼり旗の列でにぎやかに
    placeDeco(8, ROADW / 2 + 105, 'grandstand', 1.05);
    placeDeco(18, -(ROADW / 2 + 105), 'grandstand', 1);
    for (let j = -12; j <= 16; j += 4) {
      const side = (j / 4) % 2 ? 1 : -1;
      placeDeco(j, side * (ROADW / 2 + 32), 'nobori', 0.9 + rnd() * 0.2);
    }
    // コースから離れた原野にも散布して、見渡したときの里山の風景をつくる
    for (let i = 0; i < 90; i++) {
      const x = 60 + rnd() * (TEX - 120);
      const y = 60 + rnd() * (TEX - 120);
      if (isRoad(x, y)) continue;
      const type = adjustForAltitude(table[(rnd() * table.length) | 0], x, y);
      decorations.push({ x, y, type, size: 0.8 + rnd() * 0.55 });
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

  // 坂のプロファイル（登り下りで地平線が上下する）
  // 本物の3D地形: コース外のなだらかな丘（コースから離れた場所のみ）
  let hills3d = [];
  function buildTerrain() {
    hills3d = [];
    for (let i = 0; i < 9; i++) {
      hills3d.push({
        x: 160 + rnd() * (TEX - 320),
        z: 160 + rnd() * (TEX - 320),
        amp: (rnd() * 1.5 - 0.5) * 34,
        r: 300 + rnd() * 380,
      });
    }
  }

  function wildAt(x, z) {
    let h = 0;
    for (const b of hills3d) {
      const d2 = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r);
      if (d2 < 1) {
        const t = 1 - d2;
        h += b.amp * t * t;
      }
    }
    return h;
  }

  // コースの標高プロファイル（コースごとに定義。平坦区間と長い登り/下りで構成）
  let trackH = [];
  function buildTrackProfile() {
    const elev = course.elev || [[0, 0]];
    trackH = [];
    for (let i = 0; i < N_WP; i++) {
      const f = i / N_WP;
      let a = elev[elev.length - 1], fa = a[0] - 1, b = elev[0], fb = b[0] + (elev[0][0] > 0 ? 0 : 1);
      for (let j = 0; j < elev.length; j++) {
        const cur = elev[j];
        const nxt = j + 1 < elev.length ? elev[j + 1] : elev[0];
        const f2 = j + 1 < elev.length ? nxt[0] : nxt[0] + 1;
        if (f >= cur[0] && f < f2) { a = cur; fa = cur[0]; b = nxt; fb = f2; break; }
      }
      const t = Math.max(0, Math.min(1, (f - fa) / Math.max(0.0001, fb - fa)));
      const s = 0.5 - 0.5 * Math.cos(t * Math.PI); // なめらかな坂
      trackH.push(a[1] + (b[1] - a[1]) * s);
    }
  }

  // 高さグリッド: コース近傍は「コースの標高」で平坦にし、視界をふさがない。
  // 離れるにつれて荒野の丘へブレンドする
  const HG = 128;
  let hGrid = null;
  function buildHeightGrid() {
    hGrid = new Float32Array((HG + 1) * (HG + 1));
    const corridor = ROADW * 0.5 + 70;
    const blendW = 260;
    for (let j = 0; j <= HG; j++) {
      for (let i = 0; i <= HG; i++) {
        const x = (i / HG) * TEX, z = (j / HG) * TEX;
        let bd = Infinity, bw = 0;
        for (let w = 0; w < N_WP; w += 2) {
          const dx = wps[w].x - x, dz = wps[w].y - z;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; bw = w; }
        }
        const dist = Math.sqrt(bd);
        const th = trackH[bw];
        // コースの標高は周囲の山体にも染み出す（山頂エリアが本物の山になる）
        const massif = th * Math.max(0, 1 - (dist - corridor) / 900);
        let h;
        if (dist < corridor) {
          h = th;
        } else if (dist < corridor + blendW) {
          const t = (dist - corridor) / blendW;
          const s = t * t * (3 - 2 * t);
          h = th * (1 - s) + (wildAt(x, z) + massif) * s;
        } else {
          h = wildAt(x, z) + massif;
        }
        // ワールドの端は0へ
        const m = 130;
        const e = Math.min(x, TEX - x, z, TEX - z);
        if (e < m) h *= Math.max(0, e / m);
        hGrid[j * (HG + 1) + i] = h;
      }
    }
  }

  function heightAt(x, z) {
    if (!hGrid) return 0;
    const fx = Math.max(0, Math.min(HG - 0.001, (x / TEX) * HG));
    const fz = Math.max(0, Math.min(HG - 0.001, (z / TEX) * HG));
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const r = j * (HG + 1);
    const h00 = hGrid[r + i], h10 = hGrid[r + i + 1];
    const h01 = hGrid[r + HG + 1 + i], h11 = hGrid[r + HG + 2 + i];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  function buildHills() {
    // コース沿いの勾配（カメラのピッチ用）を地形からサンプリング
    hillSlope = wps.map((w, i) => {
      const a = wps[(i + 4) % N_WP], b = wps[(i - 4 + N_WP) % N_WP];
      return (heightAt(a.x, a.y) - heightAt(b.x, b.y)) * 0.55;
    });
    horY = HORIZON;
  }

  // ダッシュボードとジャンプ台を「曲率の小さい場所」に自動配置
  function buildPads() {
    pads = [];
    const isStraight = (i) => {
      const a = wps[(i + 9) % N_WP], b = wps[(i - 9 + N_WP) % N_WP];
      let d = Math.atan2(a.ty, a.tx) - Math.atan2(b.ty, b.tx);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d) < 0.22;
    };
    const want = [
      { at: 0.16, type: 'dash' }, { at: 0.3, type: 'jump' }, { at: 0.48, type: 'dash' },
      { at: 0.66, type: 'glide' }, { at: 0.84, type: 'dash' },
    ];
    for (const w of want) {
      const base = Math.round(w.at * N_WP);
      let found = -1;
      for (let off = 0; off < 45 && found < 0; off++) {
        for (const s of [1, -1]) {
          const i = (base + off * s + N_WP) % N_WP;
          if (isStraight(i)) { found = i; break; }
        }
      }
      if (found < 0) continue;
      // アイテムボックスの列（wp 50,150,…）と重なったらずらす
      const m = found % 100;
      if (m >= 42 && m <= 60) found = (found + 16) % N_WP;
      pads.push({ start: found, len: w.type === 'dash' ? 7 : 5, type: w.type });
    }
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
    buildTerrain();
    buildTrackProfile();
    buildHeightGrid();
    buildHills();
    buildPads();
    buildTexture();
    buildDecorations();
    buildSky();
    buildAmbient();
    if (GL3D) {
      GL3D.setCourse({
        trackCanvas: texCanvas,
        grassA: theme.grassA,
        grassB: theme.grassB,
        fog: theme.fog,
        light: theme.light || { dir: [-0.45, -0.8, 0.35], color: [1, 1, 0.96], amb: 0.6 },
        heightAt,
      });
      glDecos = decorations.map((d) => {
        const spec = DECO[d.type];
        const w = spec.w * d.size;
        return {
          x: d.x, z: d.y, y0: heightAt(d.x, d.y),
          canvas: spec.img, w, h: w * spec.img.height / spec.img.width,
        };
      });
    }
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
  let shots = [];        // 雪玉（飛び道具）
  let flashT = 0;        // クラッシュ時の画面フラッシュ
  let flashColor = '255,255,180';
  let crashFxT = 0;      // 「なにに当たったか」表示の残り時間
  let crashFxCause = null;
  let lastZapT = -99;    // かみなりの連発防止
  let wrongWayT = 0;     // 逆走の継続時間
  let lastWrongBeep = 0;
  let finalLapShown = false;
  let state = 'title';   // title | count | race | finished
  let countT = 0;
  let raceTime = 0;
  let finishOrder = [];

  const ITEM_ICONS = {
    boost: '🚀',
    banana: '🍌',
    snowball: '❄️',
    zap: '⚡',
    shield: '🛡️',
  };

  // クラッシュ演出（原因アイテムごとのアイコン・フラッシュ色・効果音）
  const zapSprite = makeEmojiSprite('⚡');
  const CRASH_FX = {
    banana:   { icon: bananaSprite,   flash: '255,200,90',  freq: 180 },
    snowball: { icon: snowballSprite, flash: '190,230,255', freq: 240 },
    zap:      { icon: zapSprite,      flash: '255,255,140', freq: 90 },
  };
  const crashLabels = {
    banana: makeLabelSprite('🍌 バナナ！'),
    snowball: makeLabelSprite('❄️ ゆきだま！'),
    zap: makeLabelSprite('⚡ かみなり！'),
  };

  // 順位が後ろのカートほど強いアイテムが出やすい
  function rollItem(k) {
    const behind = rankOf(k).rank > karts.length / 2;
    const x = Math.random();
    let item;
    if (behind) {
      if (x < 0.34) item = 'boost';
      else if (x < 0.56) item = 'snowball';
      else if (x < 0.70) item = 'banana';
      else if (x < 0.90) item = 'shield';
      else item = 'zap';            // 10%
    } else {
      if (x < 0.24) item = 'boost';
      else if (x < 0.52) item = 'snowball';
      else if (x < 0.80) item = 'banana';
      else if (x < 0.97) item = 'shield';
      else item = 'zap';            // 3%
    }
    // かみなりは直近15秒以内に使われていたら出さない（連発防止）
    if (item === 'zap' && raceTime - lastZapT < 15) item = 'snowball';
    return item;
  }

  // プレイヤー名（入力欄 + localStorage）
  const nameInput = document.getElementById('player-name');
  try { nameInput.value = localStorage.getItem('kartPlayerName') || ''; } catch (e) { /* プライベートモード等 */ }
  nameInput.addEventListener('input', () => {
    try { localStorage.setItem('kartPlayerName', nameInput.value); } catch (e) { /* 同上 */ }
  });
  function getPlayerName() {
    return nameInput.value.trim().slice(0, 8) || 'あなた';
  }

  // カートの上に出す名前ラベル（毎フレームfillTextせず一度だけ描く）
  function makeLabelSprite(name) {
    const c = document.createElement('canvas');
    const probe = c.getContext('2d');
    probe.font = 'bold 26px sans-serif';
    c.width = Math.ceil(probe.measureText(name).width) + 20;
    c.height = 38;
    const g = c.getContext('2d');
    g.font = 'bold 26px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.strokeText(name, c.width / 2, 20);
    g.fillStyle = '#fff';
    g.fillText(name, c.width / 2, 20);
    return c;
  }

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
      label: makeLabelSprite(def.name),
      color: def.body,
      bodyC: def.body,
      helmetC: def.helmet || '#ffffff',
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
      shield: 0,
      aiItemT: 0,
      stuckT: 0,
      reverseT: 0,
      alt: 0,
      vAlt: 0,
      glide: false,
      padT: 0,
      finished: false,
    };
  }

  function resetRace(vs) {
    karts = [];
    bananas = [];
    shots = [];
    finishOrder = [];
    raceTime = 0;
    steerSmooth = 0;
    flashT = 0;
    crashFxT = 0;
    lastZapT = -99;
    wrongWayT = 0;
    finalLapShown = false;
    wrongwayEl.classList.add('hidden');
    remoteTarget = null;
    remoteFinish = null;

    const grid = N_WP - 8;
    if (vs) {
      // 対戦: 自分と相手の2台。ホストが左、ゲストが右
      const myLat = netRole === 'host' ? -22 : 22;
      remoteKart = spawnKart({ name: remoteName || 'あいて', body: '#1e88e5', helmet: '#fff' }, grid, -myLat, false);
      remoteKart.remote = true;
      player = spawnKart({ name: getPlayerName(), body: '#e94560', helmet: '#fff' }, grid, myLat, true);
      karts.push(remoteKart, player);
    } else {
      remoteKart = null;
      karts.push(spawnKart(CPU_DEFS[0], grid + 4, -22, false));
      karts.push(spawnKart(CPU_DEFS[1], grid + 4, 22, false));
      karts.push(spawnKart(CPU_DEFS[2], grid, -22, false));
      player = spawnKart({ name: getPlayerName(), body: '#e94560', helmet: '#fff' }, grid, 22, true);
      karts.push(player);
    }
    hudName.textContent = player.name;

    itemBoxes = [];
    // スタートグリッド付近（終端60wp）には置かない
    for (let i = 50; i < N_WP - 60; i += 100) {
      const w = wps[i];
      const rx = -w.ty, ry = w.tx;
      for (const off of [-ROADW * 0.3, 0, ROADW * 0.3]) {
        const bx = w.x + rx * off, by = w.y + ry * off;
        itemBoxes.push({ x: bx, y: by, y0: heightAt(bx, by), respawn: 0 });
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
    // 道幅が広いと路肩で距離が出るので、まず近傍±40を広めに探索
    const edge = ROADW * 0.5 + 40;
    if (bestD > edge * edge) {
      for (let d = -40; d <= 40; d++) {
        const i = (k.wp + d + N_WP) % N_WP;
        const dx = wps[i].x - k.x, dy = wps[i].y - k.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestD) { bestD = dist; best = i; }
      }
    }
    // それでも遠い＝本当に見失った。全周を再探索して復帰
    if (bestD > 260 * 260) {
      for (let i = 0; i < N_WP; i++) {
        const dx = wps[i].x - k.x, dy = wps[i].y - k.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestD) { bestD = dist; best = i; }
      }
      k.wp = best; // 大ジャンプになるので周回判定はスキップ
      return;
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
    // 正面衝突: 道なり方向へ滑らせて引っかかりを防ぐ
    const w = wps[k.wp];
    const sgn = (Math.cos(k.a) * w.tx + Math.sin(k.a) * w.ty) >= 0 ? 1 : -1;
    const m = Math.hypot(dx, dy) * 0.7;
    const sx = k.x + w.tx * sgn * m, sy = k.y + w.ty * sgn * m;
    if (isRoad(sx, sy)) { k.x = sx; k.y = sy; return 1; }
    return 2;
  }

  function hitWall(k, kind, dt) {
    if (!kind) return;
    // 壁は「減速のみ」。道なりに向きを少し補正して壁から離れやすくする
    const w = wps[k.wp];
    const sgn = (Math.cos(k.a) * w.tx + Math.sin(k.a) * w.ty) >= 0 ? 1 : -1;
    const ta = Math.atan2(w.ty * sgn, w.tx * sgn);
    let da = ta - k.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    k.a += da * Math.min(1, dt * 5);
    k.speed *= Math.max(0, 1 - (kind === 2 ? 3.2 : 1.2) * dt);
    if (k.isPlayer && kind === 2 && Math.abs(k.speed) > 130 && k.wallT <= 0) {
      k.wallT = 0.5;
      beep(110, 0.18, 0.15, 'square');
      buzz(35);
    }
  }

  function updateKart(k, dt) {
    k.wallT = Math.max(0, (k.wallT || 0) - dt);
    k.shield = Math.max(0, (k.shield || 0) - dt);
    k.padT = Math.max(0, (k.padT || 0) - dt);
    if (k.alt > 0 || k.vAlt > 0) {
      // ジャンプ/滑空の上下運動（グライド中は重力が弱く長く飛べる）
      k.alt += k.vAlt * dt;
      k.vAlt -= (k.glide ? 190 : 620) * dt;
      if (k.alt <= 0) {
        k.alt = 0;
        k.vAlt = 0;
        k.glide = false;
        if (k.isPlayer) { buzz(25); beep(220, 0.08, 0.1, 'triangle'); } // 着地
      }
    }
    if (k.spin > 0) {
      k.spin -= dt;
      if (k.spin <= 0) {
        k.spin = 0;
        if (k.spinTotal) k.a = k.spinA; // クラッシュ前の向きに戻す
      } else if (k.spinTotal) {
        // 経過に応じてちょうど2回転 → 終わると自然に元の向きへ
        k.a = k.spinA + (1 - k.spin / k.spinTotal) * Math.PI * 4;
      } else {
        k.a += dt * 10;
      }
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
      // スタック検出: 低速のまま動けなくなったら少しバックして立て直す
      if (state === 'race' && Math.abs(k.speed) < 25) k.stuckT = (k.stuckT || 0) + dt;
      else k.stuckT = 0;
      if (k.reverseT > 0) {
        k.reverseT -= dt;
        steer = -steerForCpu(k).steer; // バック中は逆ハンドルで目標へ向ける
        brake = true;
      } else if (k.stuckT > 1.2) {
        k.stuckT = 0;
        k.reverseT = 0.9;
      } else {
        const ai = steerForCpu(k);
        steer = ai.steer;
        gas = true;
        brake = ai.brake;
      }
      // ランダムなタイミングでアイテム使用
      if (k.item) {
        k.aiItemT -= dt;
        if (k.aiItemT <= 0) useItem(k);
      }
    }

    const airborne = k.alt > 0;
    const onRoad = isRoad(k.x, k.y);
    const onDirt = !airborne && onRoad && isDirt(k.x, k.y);
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
      if (!airborne) {
        limit *= BOOST_MUL;
        k.speed += ACCEL * 2 * dt;
      }
    }

    if (!airborne) {
      // 空中ではアクセルも摩擦も効かない（勢いそのまま飛ぶ）
      if (gas) k.speed += ACCEL * dt;
      else if (brake) k.speed -= BRAKE * dt;
      else k.speed -= Math.sign(k.speed) * FRICTION * dt;

      if (k.speed > limit) k.speed = Math.max(limit, k.speed - BRAKE * 1.5 * dt);
      if (k.speed < -120) k.speed = -120;
      if (!gas && !brake && Math.abs(k.speed) < 4) k.speed = 0;
    }

    // 低速でも最低限ハンドルが効く（壁に正面から刺さっても抜けられる）
    let speedFactor = Math.min(1, Math.abs(k.speed) / (MAX_SPEED * 0.45));
    if (Math.abs(k.speed) > 5) speedFactor = Math.max(speedFactor, 0.3);
    const turnMul = (course.turnMul || 1) * (onDirt ? 0.85 : 1) * (airborne ? 0.25 : 1);
    k.a += steer * TURN_RATE * turnMul * speedFactor * Math.sign(k.speed || 1) * dt;

    hitWall(k, moveWithWalls(k, Math.cos(k.a) * k.speed * dt, Math.sin(k.a) * k.speed * dt), dt);
    k.x = Math.max(16, Math.min(TEX - 16, k.x));
    k.y = Math.max(16, Math.min(TEX - 16, k.y));

    updateNearestWp(k);

    // ダッシュボード / ジャンプ台
    if (!airborne) {
      for (const pad of pads) {
        if ((k.wp - pad.start + N_WP) % N_WP >= pad.len) continue;
        if (pad.type === 'dash') {
          k.boost = Math.max(k.boost, 1.0);
          if (k.isPlayer && k.padT <= 0) {
            k.padT = 1;
            beep(980, 0.15, 0.12, 'sawtooth');
            buzz(20);
          }
        } else if (Math.abs(k.speed) > 60) {
          if (pad.type === 'glide') {
            // グライド台: 高く打ち上げて長い空中走行
            k.vAlt = 165;
            k.glide = true;
            k.speed = Math.max(k.speed, MAX_SPEED * 0.95);
            if (k.isPlayer) { beep(740, 0.3, 0.12, 'sine'); buzz([30, 40, 30]); }
          } else {
            // ジャンプ台: 速いほど高く飛ぶ
            k.vAlt = 140 + Math.max(k.speed, 0) * 0.28;
            k.speed = Math.max(k.speed, MAX_SPEED * 0.85); // 踏み切りの勢い
            if (k.isPlayer) { beep(620, 0.22, 0.12, 'triangle'); buzz(30); }
          }
        }
        break;
      }
    }

    if (k.lap > LAPS && !k.finished) {
      k.finished = true;
      finishOrder.push(k);
      if (k.isPlayer) onPlayerFinish();
    }
  }

  // クラッシュ共通処理。向きを保存し、スピン後に元へ戻す。
  // シールド中・スピン中・ゴール後は無効（falseを返す）
  function crashKart(k, cause, dur, speedMul) {
    if (k.shield > 0 || k.spin > 0 || k.finished) return false;
    k.spin = dur;
    k.spinTotal = dur;
    k.spinA = k.a;       // クラッシュ前の向き（スピン後に復元）
    k.speed *= speedMul;
    k.crashIcon = cause; // 頭上に原因アイテムを表示
    if (k.isPlayer) {
      const fx = CRASH_FX[cause];
      flashT = 0.3;
      flashColor = fx.flash;
      crashFxT = 1.3;
      crashFxCause = cause;
      beep(fx.freq, 0.4, 0.16, 'sawtooth');
      buzz(cause === 'zap' ? [80, 60, 80] : [60, 50, 60]);
    }
    return true;
  }

  // かみなりを受けたときの処理（シールドで防げる）
  function zapKart(o) {
    crashKart(o, 'zap', 0.8, 0.4);
  }

  function useItem(k) {
    if (!k.item) return;
    const item = k.item;
    k.item = null;
    if (k.isPlayer) buzz(30);

    if (item === 'boost') {
      k.boost = 1.6;
      if (k.isPlayer) beep(880, 0.3, 0.12, 'sawtooth');
    } else if (item === 'banana') {
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
    } else if (item === 'snowball') {
      // まっすぐ飛ぶ雪玉。当たるとスピン。
      // ↓（ブレーキ/バック）を押しながら使うと後ろに投げる
      let back = false;
      if (k.isPlayer) {
        back = input.down;
      } else {
        // CPUはすぐ後ろにライバルがいるときだけ後ろに投げる
        back = karts.some((o) => {
          if (o === k || o.finished) return false;
          const gap = progressOf(k) - progressOf(o);
          return gap > 0 && gap < 16;
        });
      }
      const dir = back ? -1 : 1;
      const sp = (back ? 0 : Math.max(k.speed, 0)) + 360;
      const s = {
        x: k.x + Math.cos(k.a) * 34 * dir,
        y: k.y + Math.sin(k.a) * 34 * dir,
        vx: Math.cos(k.a) * sp * dir,
        vy: Math.sin(k.a) * sp * dir,
        life: 2.5,
        owner: k,
        id: k.isPlayer && vsMode ? `${netRole}-s${++netBananaSeq}` : null,
      };
      shots.push(s);
      if (k.isPlayer) {
        beep(back ? 420 : 520, 0.12, 0.12, 'triangle');
        if (s.id) netSend({ t: 'shot', x: s.x, y: s.y, vx: s.vx, vy: s.vy, id: s.id });
      }
    } else if (item === 'shield') {
      k.shield = 6;
      if (k.isPlayer) beep(740, 0.2, 0.1, 'sine');
    } else if (item === 'zap') {
      // 自分以外の全カートを感電させる
      lastZapT = raceTime;
      if (k.isPlayer && vsMode) {
        netSend({ t: 'zap' });
        if (remoteKart) remoteKart.crashIcon = 'zap';
      }
      for (const o of karts) {
        if (o === k || o.remote) continue; // 相手側は相手の画面で判定
        zapKart(o);
      }
      if (k.isPlayer) beep(150, 0.3, 0.14, 'square');
    }
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
          k.item = rollItem(k);
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
        if (k.remote || k.spin > 0 || k.alt > 0) continue; // ジャンプ中は飛び越えられる
        if (Math.hypot(k.x - bn.x, k.y - bn.y) < 20) {
          if (!crashKart(k, 'banana', 1, 0.25) && k.isPlayer) {
            beep(700, 0.1, 0.1, 'sine'); // シールドで防いだ
          }
          if (bn.id) netSend({ t: 'bhit', id: bn.id });
          bananas.splice(i, 1);
          break;
        }
      }
    }

    // 雪玉（ガードレールに当たると割れる）
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life <= 0 || !isRoad(s.x, s.y)) { shots.splice(i, 1); continue; }
      for (const k of karts) {
        if (k.remote || k === s.owner || k.spin > 0 || k.alt > 0) continue;
        if (Math.hypot(k.x - s.x, k.y - s.y) < 24) {
          if (!crashKart(k, 'snowball', 1, 0.25) && k.isPlayer) {
            beep(700, 0.1, 0.1, 'sine'); // シールドで防いだ
          }
          if (s.id) netSend({ t: 'shotHit', id: s.id });
          shots.splice(i, 1);
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
    if (remoteTarget && remoteTarget.al !== undefined) {
      k.alt += (remoteTarget.al - k.alt) * Math.min(1, dt * 10);
      if (k.alt < 0.5 && remoteTarget.al === 0) k.alt = 0;
    }
    k.boost = Math.max(0, k.boost - dt);
    k.spin = Math.max(0, k.spin - dt);
    k.shield = Math.max(0, k.shield - dt);
  }

  // ===== レンダリング =====
  const HOR_MIN = HORIZON - 36; // 坂で地平線が上がる分の余白
  const groundImg = ctx.createImageData(W, H - HOR_MIN);
  const ground32 = new Uint32Array(groundImg.data.buffer);

  function renderGround(camX, camY, dirX, dirY, hor) {
    const rxv = -dirY, ryv = dirX; // カメラの右方向
    const mipD = FOCAL * 1.2;      // これより遠い行は縮小テクスチャから読む
    let p = 0;
    for (let y = hor; y < H; y++) {
      const rowD = (CAM_H * FOCAL) / (y - hor + 1);
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
    ctx.putImageData(groundImg, 0, hor, 0, 0, W, H - hor);
  }

  function renderSky(heading, hor) {
    // 坂による地平線の上下は、空全体を平行移動して表現する
    sctx.save();
    sctx.translate(0, hor - HORIZON);
    sctx.fillStyle = skyGrad;
    sctx.fillRect(0, -40, W, HORIZON + 40);

    // 太陽の光（山の向こうに見える）
    {
      const sunSpan = W * 4;
      let sx = (W * 2.7 - (heading / (Math.PI * 2)) * sunSpan) % sunSpan;
      if (sx < 0) sx += sunSpan;
      sctx.drawImage(glowSprite, sx - 110, HORIZON - 190, 220, 220);
    }

    // 山並み（パララックスつき）
    const ak = HORIZON / 110; // 解像度スケールに山の高さを合わせる
    const span = 1920, segW = 80;
    for (const r of ridges) {
      let offset = (heading * r.speed) % span;
      if (offset < 0) offset += span;
      sctx.fillStyle = r.color;
      sctx.beginPath();
      sctx.moveTo(0, HORIZON);
      for (let x = 0; x <= W; x += 8) {
        const pan = (x + offset) % span;
        const i = (pan / segW) | 0;
        const f = (pan % segW) / segW;
        const hA = r.peaks[i % 24], hB = r.peaks[(i + 1) % 24];
        const hv = hA + (hB - hA) * f;
        sctx.lineTo(x, HORIZON - r.amp * ak * hv);
      }
      sctx.lineTo(W, HORIZON);
      sctx.closePath();
      sctx.fill();
      // 雪をかぶった頂
      if (r.snow) {
        sctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (let i = 0; i < 24; i++) {
          let px = i * segW - offset;
          while (px < -segW) px += span;
          while (px > span - segW) px -= span;
          if (px < -20 || px > W + 20) continue;
          const py = HORIZON - r.amp * ak * r.peaks[i];
          const cap = r.amp * ak * r.peaks[i] * 0.32;
          sctx.beginPath();
          sctx.moveTo(px, py);
          sctx.lineTo(px - cap * 0.8, py + cap);
          sctx.lineTo(px + cap * 0.8, py + cap);
          sctx.closePath();
          sctx.fill();
        }
      }
    }

    // コースごとの空の演出
    const span4 = W * 4;
    const pan = (base, speed) => {
      let x = (base - (heading / (Math.PI * 2)) * span4 * (speed / 100)) % span4;
      if (x < 0) x += span4;
      return x;
    };
    if (theme.skyFx === 'fireworks') {
      renderFireworks(pan);
    } else if (theme.skyFx === 'village') {
      // 遠くに合掌造りの集落のシルエット
      for (const [base, s] of [[300, 13], [430, 10], [560, 16], [1500, 12], [1650, 14], [2400, 11]]) {
        const x = pan(base, 34) - 40;
        if (x < -40 || x > W + 40) continue;
        sctx.fillStyle = '#9db4c2';
        sctx.beginPath();
        sctx.moveTo(x, HORIZON - s);
        sctx.lineTo(x - s * 0.85, HORIZON);
        sctx.lineTo(x + s * 0.85, HORIZON);
        sctx.closePath();
        sctx.fill();
        sctx.fillStyle = 'rgba(255,255,255,0.8)';
        sctx.beginPath();
        sctx.moveTo(x, HORIZON - s);
        sctx.lineTo(x - s * 0.32, HORIZON - s * 0.6);
        sctx.lineTo(x + s * 0.32, HORIZON - s * 0.6);
        sctx.closePath();
        sctx.fill();
      }
    } else if (theme.skyFx === 'balloon') {
      const t = performance.now() / 1000;
      for (const [base, y, s] of [[500, 40, 46], [2300, 66, 32]]) {
        const x = pan(base, 55) - 60;
        if (x < -60 || x > W + 60) continue;
        sctx.drawImage(balloonSprite, x, y + Math.sin(t * 0.7 + base) * 5, s, s * 1.33);
      }
    } else if (theme.skyFx === 'birds') {
      const t = performance.now() / 1000;
      sctx.strokeStyle = 'rgba(45,55,66,0.8)';
      sctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const x = pan(i * 640 + t * 26, 70) - 20;
        if (x < -20 || x > W + 20) continue;
        const y = 42 + (i % 3) * 18 + Math.sin(t * 1.2 + i) * 5;
        const flap = Math.sin(t * 7 + i * 1.7) * 5;
        sctx.beginPath();
        sctx.moveTo(x - 8, y - flap);
        sctx.lineTo(x, y);
        sctx.lineTo(x + 8, y - flap);
        sctx.stroke();
      }
    }

    // 地平線の霞（山すそをやわらかく）
    sctx.fillStyle = hazeGrad;
    sctx.fillRect(0, HORIZON - 52, W, 52);

    // 視点に合わせて流れる雲（大きさに変化をつける）
    const cspan = W * 4;
    for (let i = 0; i < 7; i++) {
      const base = i * cspan / 7;
      let x = (base - heading / (Math.PI * 2) * cspan) % cspan;
      if (x < 0) x += cspan;
      const cw = 52 + (i % 3) * 26;
      sctx.drawImage(cloudSprite, x - cw, ((i * 41) % 64) + 8, cw, cw * 0.53);
    }
    sctx.restore();

    // 地平線から下は霞色で埋める（3Dの地面との継ぎ目が出ないように）
    sctx.fillStyle = `rgb(${theme.fog})`;
    sctx.fillRect(0, Math.max(0, hor - 2), W, H - hor + 2);
  }

  // 高山の夕空に上がる祭りの花火
  let fireworks = [];
  let fwTimer = 1.5;
  function renderFireworks(pan) {
    fwTimer -= 1 / 60;
    if (fwTimer <= 0) {
      fireworks.push({
        base: Math.random() * W * 4,
        y: 18 + Math.random() * 70,
        t: 0,
        hue: [350, 45, 200, 130, 280][(Math.random() * 5) | 0],
      });
      fwTimer = 2.2 + Math.random() * 3;
      beep(140 + Math.random() * 80, 0.25, 0.05, 'triangle'); // 遠くの「ぽん」
    }
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const f = fireworks[i];
      f.t += 1 / 60;
      if (f.t > 1.4) { fireworks.splice(i, 1); continue; }
      const x = pan(f.base, 40);
      if (x < -80 || x > W + 80) continue;
      const ease = 1 - Math.pow(1 - Math.min(1, f.t / 1.1), 2);
      const dist = ease * 44;
      const alpha = Math.max(0, 1 - f.t / 1.4);
      // 開いた直後の中心の閃光
      if (f.t < 0.25) {
        sctx.fillStyle = `rgba(255,255,230,${(0.25 - f.t) * 3})`;
        sctx.beginPath();
        sctx.arc(x, f.y, 14, 0, Math.PI * 2);
        sctx.fill();
      }
      sctx.fillStyle = `hsla(${f.hue}, 95%, 65%, ${alpha})`;
      for (let j = 0; j < 16; j++) {
        const ang = (j / 16) * Math.PI * 2;
        sctx.beginPath();
        sctx.arc(x + Math.cos(ang) * dist, f.y + Math.sin(ang) * dist * 0.85 + ease * 9, 1.8, 0, Math.PI * 2);
        sctx.fill();
      }
    }
  }

  function project(camX, camY, dirX, dirY, ox, oy) {
    const rx = ox - camX, ry = oy - camY;
    const fz = rx * dirX + ry * dirY;          // 前方距離
    const fx = rx * -dirY + ry * dirX;         // 横位置
    if (fz < 12) return null;
    return {
      x: W / 2 + (fx / fz) * FOCAL,
      y: horY + (CAM_H / fz) * FOCAL,
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
    for (const s of shots) {
      const pr = project(camX, camY, dirX, dirY, s.x, s.y);
      if (pr) items.push({ ...pr, type: 'shot' });
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
      } else if (it.type === 'shot') {
        const s = 17 * it.scale;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(it.x, it.y, s * 0.42, s * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(snowballSprite, it.x - s / 2, it.y - s * 1.2, s, s);
      } else {
        drawKart(it.kart, it.x, it.y, it.scale);
      }
    }
  }

  function drawKart(k, x, y, scale) {
    const w = 34 * scale;
    const h = w * (40 / 48);
    // ジャンプ中は放物線で浮く（影は地面に残る）
    const lift = k.alt > 0 ? k.alt * 0.42 * scale : 0;
    ctx.save();
    ctx.translate(x, y);
    if (k.spin > 0) ctx.rotate(Math.sin(k.spin * 18) * 0.7);
    // 影（ソフト。空中では小さく薄く）
    const shScale = lift > 0 ? Math.max(0.55, 1 - lift / (22 * scale)) : 1;
    const shadow = ctx.createRadialGradient(0, h * 0.02, 0, 0, h * 0.02, w * 0.52 * shScale);
    shadow.addColorStop(0, `rgba(0,0,0,${0.34 * shScale})`);
    shadow.addColorStop(0.7, `rgba(0,0,0,${0.15 * shScale})`);
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(0, h * 0.02, w * 0.52 * shScale, h * 0.2 * shScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(0, -lift);
    // ブースト炎
    if (k.boost > 0) {
      ctx.fillStyle = 'rgba(255,140,0,0.85)';
      ctx.beginPath();
      ctx.ellipse(0, h * 0.05, w * 0.3, h * 0.22 + Math.random() * h * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.drawImage(k.sprite, -w / 2, -h, w, h);
    // シールド（切れる直前は点滅）
    if (k.shield > 0) {
      const alpha = k.shield < 1.5
        ? 0.35 + 0.3 * Math.sin(performance.now() / 70)
        : 0.7;
      ctx.strokeStyle = `rgba(80,220,255,${Math.max(0.15, alpha)})`;
      ctx.lineWidth = Math.max(2, w * 0.045);
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.45, w * 0.64, h * 0.66, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(80,220,255,0.1)';
      ctx.fill();
    }
    ctx.restore();
    // 名前ラベル（自分以外。スピンしても回らないよう外で描く）
    if (!k.isPlayer && k.label) {
      const lw = Math.min(120, k.label.width * scale * 0.42);
      const lh = lw * k.label.height / k.label.width;
      ctx.drawImage(k.label, x - lw / 2, y - h - lh - 3 * scale, lw, lh);
    }
    // クラッシュの原因アイテムを頭上に表示
    if (k.spin > 0 && k.crashIcon && CRASH_FX[k.crashIcon]) {
      const img = CRASH_FX[k.crashIcon].icon;
      const s = Math.min(60, 30 * scale);
      const bob = Math.sin(performance.now() / 90) * s * 0.1;
      ctx.globalAlpha = Math.min(1, k.spin * 2.5);
      ctx.drawImage(img, x - s / 2, y - h - s - 18 * Math.min(2.4, scale) + bob, s, s);
      ctx.globalAlpha = 1;
    }
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
    renderPlayerFX(pr);
  }

  // 自機まわりの画面エフェクト（3D/2D共通。前面レイヤーに描く）
  function renderPlayerFX(pr) {
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
    // クラッシュ原因のテキスト（ふわっと上がって消える）
    if (crashFxT > 0 && crashLabels[crashFxCause]) {
      const img = crashLabels[crashFxCause];
      const t = 1.3 - crashFxT;
      const lh = 42;
      const lw = lh * img.width / img.height;
      ctx.globalAlpha = Math.min(1, crashFxT * 1.8);
      ctx.drawImage(img, W / 2 - lw / 2, pr.y - 250 - t * 55, lw, lh);
      ctx.globalAlpha = 1;
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

  function renderFog(hor) {
    ctx.save();
    ctx.translate(0, hor - HORIZON);
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, HORIZON, W, 44);
    ctx.restore();
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

  // 3D描画用に毎フレームの状態を渡す
  let glDecos = [];
  function renderGL(hor) {
    GL3D.render({
      x: player.x, z: player.y, heading: player.a,
      horShift: hor - HORIZON,
      time: performance.now() / 1000,
      karts: karts.map((k) => ({
        x: k.x, z: k.y, a: k.a,
        lift: k.alt,
        glide: k.glide && k.alt > 0,
        roll: k.isPlayer ? steerSmooth * 0.13 : 0,
        body: k.bodyC, helmet: k.helmetC,
        boost: k.boost, shield: k.shield,
        label: !k.isPlayer ? k.label : null,
        icon: k.spin > 0 && k.crashIcon && CRASH_FX[k.crashIcon]
          ? CRASH_FX[k.crashIcon].icon : null,
      })),
      boxes: itemBoxes.filter((b) => b.respawn <= 0).map((b) => ({ x: b.x, z: b.y, y0: b.y0 })),
      bananas: bananas.map((b) => ({ x: b.x, z: b.y })),
      shots: shots.map((s) => ({ x: s.x, z: s.y })),
      decos: glDecos,
      sprites: { star: starSprite, banana: bananaSprite, snowball: snowballSprite },
    });
  }

  function render() {
    // 坂: 勾配に応じて地平線をなめらかに上下（登りで上がる）
    const targetHor = HORIZON - (hillSlope[player.wp] || 0) * 11;
    horY += (targetHor - horY) * 0.08;
    horY = Math.max(HOR_MIN + 2, Math.min(HORIZON + 30, horY));
    const hor = Math.round(horY);

    renderSky(player.a, hor); // 背面レイヤー（空）

    if (GL3D) {
      renderGL(hor);
      ctx.clearRect(0, 0, W, H); // 前面レイヤーはエフェクトのみ
      renderPlayerFX({ x: W / 2, y: H * 0.72 });
    } else {
      // 2Dフォールバック（モード7）
      const dirX = Math.cos(player.a), dirY = Math.sin(player.a);
      const camX = player.x - dirX * CAM_BACK;
      const camY = player.y - dirY * CAM_BACK;
      ctx.clearRect(0, 0, W, hor); // 空を透かす
      renderGround(camX, camY, dirX, dirY, hor);
      renderFog(hor);
      renderSprites(camX, camY, dirX, dirY);
      renderPlayer();
    }

    renderAmbient();
    ctx.drawImage(vignette, 0, 0);
    // クラッシュ時のフラッシュ（原因アイテムごとの色）
    if (flashT > 0) {
      ctx.fillStyle = `rgba(${flashColor},${Math.min(0.6, flashT * 2)})`;
      ctx.fillRect(0, 0, W, H);
    }
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
    const icon = ITEM_ICONS[player.item] || '';
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

  // ===== グランプリ（全コース連戦・合計ポイント制） =====
  let gpMode = false;
  let gpRound = 0;
  let gpPhase = null;      // null | 'final'
  let gpPoints = {};       // キー: '@p'(自分) or CPU名
  let gpAwarded = false;
  const GP_PTS = [10, 6, 3, 1];
  const gpKey = (k) => (k.isPlayer ? '@p' : k.name);

  function showResults() {
    msgEl.textContent = '';
    const { rank, sorted } = rankOf(player);
    const medals = ['🥇', '🥈', '🥉', '4.'];
    if (gpMode) {
      if (!gpAwarded) {
        gpAwarded = true;
        sorted.forEach((k, i) => {
          gpPoints[gpKey(k)] = (gpPoints[gpKey(k)] || 0) + (GP_PTS[i] || 0);
        });
      }
      panelTitle.textContent = `第${gpRound + 1}戦 ${rank === 1 ? '🏆 1位！' : rank + '位'}`;
      panelText.innerHTML = `${course.name}（${gpRound + 1}/${COURSES.length}）<br>タイム: ${fmtTime(playerFinishTime)}`;
      resultsEl.innerHTML = sorted
        .map((k, i) => `<div class="${k.isPlayer ? 'me' : ''}">${medals[i]} ${k.name} ― ${gpPoints[gpKey(k)] || 0}pt</div>`)
        .join('');
      startBtn.textContent = gpRound < COURSES.length - 1 ? 'つぎのコースへ →' : 'グランプリ結果へ 🏆';
    } else {
      panelTitle.textContent = rank === 1 ? '🏆 優勝！' : `${rank}位でゴール！`;
      panelText.innerHTML = `${course.name}<br>タイム: ${fmtTime(playerFinishTime)}`;
      resultsEl.innerHTML = sorted
        .map((k, i) => `<div class="${k.isPlayer ? 'me' : ''}">${medals[i]} ${k.name}</div>`)
        .join('');
      startBtn.textContent = 'もう一度！';
    }
    resultsEl.classList.remove('hidden');
    panel.classList.remove('hidden');
  }

  function showGPFinal() {
    gpPhase = 'final';
    const entries = Object.entries(gpPoints).sort((a, b) => b[1] - a[1]);
    const rank = entries.findIndex(([key]) => key === '@p') + 1;
    panelTitle.textContent = rank === 1 ? '🏆 グランプリ優勝！' : `グランプリ ${rank}位`;
    panelText.innerHTML = `全${COURSES.length}コースの合計ポイント`;
    resultsEl.innerHTML = entries
      .map(([key, p], i) => `<div class="${key === '@p' ? 'me' : ''}">${['🥇', '🥈', '🥉', '4.'][i]} ${key === '@p' ? player.name : key} ― ${p}pt</div>`)
      .join('');
    startBtn.textContent = 'タイトルへ';
    beep(660, 0.15, 0.12, 'square');
    setTimeout(() => beep(880, 0.15, 0.12, 'square'), 150);
    setTimeout(() => beep(1108, 0.35, 0.12, 'square'), 300);
    buzz([60, 60, 60, 60, 120]);
  }

  function exitGP() {
    gpMode = false;
    gpPhase = null;
    courseSelEl.classList.remove('hidden');
    document.getElementById('vs-area').classList.remove('hidden');
    gpBtn.classList.remove('hidden');
    state = 'title';
    hud.classList.add('hidden');
    selectCourse(0);
  }

  function startRace() {
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    leaveNet();
    resetRace(false);
    gpAwarded = false;
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    state = 'count';
    countT = 3.5;
  }

  function onStartClick() {
    if (!gpMode) { startRace(); return; }
    if (gpPhase === 'final') { exitGP(); return; }
    gpRound++;
    if (gpRound >= COURSES.length) { showGPFinal(); return; }
    selectCourse(gpRound);
    startRace();
  }
  startBtn.addEventListener('click', onStartClick);

  const gpBtn = document.getElementById('gp-btn');
  gpBtn.addEventListener('click', () => {
    initAudio();
    gpMode = true;
    gpPhase = null;
    gpRound = 0;
    gpPoints = {};
    courseSelEl.classList.add('hidden');
    document.getElementById('vs-area').classList.add('hidden');
    gpBtn.classList.add('hidden');
    selectCourse(0);
    startRace();
  });

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
  let remoteName = null;   // 相手のプレイヤー名
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
        if (role === 'guest') net.send({ t: 'join', name: getPlayerName() });
      },
      onMsg: onNetMsg,
      onClose: onNetClosed,
    };
    (LOCAL_NET ? openLocal : openPeer)(role, code, cbs);
  }

  function onNetMsg(m) {
    if (!m || !m.t) return;
    if (m.t === 'join' && netRole === 'host' && !vsMode) {
      remoteName = (m.name || '').slice(0, 8) || 'あいて';
      netSendRaw({ t: 'start', course: courseIdx, seed: courseSeed, name: getPlayerName() });
      beginVersus();
    } else if (m.t === 'start' && netRole === 'guest' && !vsMode) {
      remoteName = (m.name || '').slice(0, 8) || 'あいて';
      buildCourse(m.course, m.seed);
      courseBtns.forEach((b, j) => b.classList.toggle('selected', j === m.course));
      beginVersus();
    } else if (m.t === 's' && remoteKart) {
      remoteTarget = m;
      remoteKart.wp = m.wp;
      remoteKart.lap = m.lap;
      if (m.b) remoteKart.boost = 0.2;
      if (m.n) remoteKart.spin = 0.2;
      if (m.sh) remoteKart.shield = 0.3;
      remoteKart.glide = !!m.g;
      if (m.lap > LAPS && !remoteKart.finished) {
        remoteKart.finished = true;
        finishOrder.push(remoteKart);
      }
    } else if (m.t === 'banana') {
      bananas.push({ x: m.x, y: m.y, arm: 0.6, id: m.id });
    } else if (m.t === 'bhit') {
      const i = bananas.findIndex((b) => b.id === m.id);
      if (i >= 0) bananas.splice(i, 1);
      if (remoteKart) remoteKart.crashIcon = 'banana'; // 相手が踏んだ
    } else if (m.t === 'shot') {
      shots.push({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, life: 2.5, owner: remoteKart, id: m.id });
    } else if (m.t === 'shotHit') {
      const i = shots.findIndex((s) => s.id === m.id);
      if (i >= 0) shots.splice(i, 1);
      if (remoteKart) remoteKart.crashIcon = 'snowball'; // 相手に命中
    } else if (m.t === 'zap') {
      zapKart(player);
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
      sh: player.shield > 0 ? 1 : 0,
      al: Math.round(player.alt),
      g: player.glide && player.alt > 0 ? 1 : 0,
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

      // 逆走アナウンス（進行方向と道の向きが0.6秒以上逆）
      const wpv = wps[player.wp];
      const dirDot = Math.cos(player.a) * wpv.tx + Math.sin(player.a) * wpv.ty;
      const wrong = state === 'race' && !player.finished &&
        player.spin <= 0 && player.speed > 40 && dirDot < -0.25;
      wrongWayT = wrong ? wrongWayT + dt : 0;
      const showWrong = wrongWayT > 0.6;
      wrongwayEl.classList.toggle('hidden', !showWrong);
      if (showWrong && now - lastWrongBeep > 900) {
        lastWrongBeep = now;
        beep(310, 0.12, 0.12, 'square');
        buzz(40);
      }

      // ファイナルラップ演出
      if (state === 'race' && !finalLapShown && LAPS > 1 &&
        player.lap === LAPS && !player.finished) {
        finalLapShown = true;
        msgEl.textContent = 'ファイナルラップ！';
        beep(660, 0.12, 0.12, 'square');
        setTimeout(() => beep(880, 0.12, 0.12, 'square'), 130);
        setTimeout(() => beep(1108, 0.25, 0.12, 'square'), 260);
        setTimeout(() => {
          if (msgEl.textContent === 'ファイナルラップ！') msgEl.textContent = '';
        }, 1600);
      }
    }

    flashT = Math.max(0, flashT - dt);
    crashFxT = Math.max(0, crashFxT - dt);
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
    get shots() { return shots; },
    get fireworks() { return fireworks; },
    get pads() { return pads; },
    get horizon() { return horY; },
    get gl() { return !!GL3D; },
    rank: () => rankOf(player).rank,
    give: (t) => { if (player) player.item = t; },
    texURL: () => texCanvas.toDataURL(),
    isDirt, isRoad, heightAt,
  };
})();
