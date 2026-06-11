// カートレース — モード7風の疑似3Dレーシングゲーム
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
  const ROAD_W = 80;               // 道幅
  const LAPS = 3;

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
  const panelText = panel.querySelector('.panel-text');
  const panelTitle = panel.querySelector('h2');
  const startBtn = document.getElementById('start-btn');
  const resultsEl = document.getElementById('results');

  // ===== コース生成 =====
  // 制御点（テクスチャ座標系のループ）
  const CTRL = [
    [512, 130], [780, 170], [880, 360], [820, 560], [890, 780],
    [680, 910], [460, 850], [300, 920], [140, 770], [190, 540],
    [120, 330], [310, 180],
  ];

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

  const wps = []; // {x, y, tx, ty} 接線つきウェイポイント
  {
    const segs = CTRL.length;
    const per = N_WP / segs;
    for (let s = 0; s < segs; s++) {
      const p0 = CTRL[(s - 1 + segs) % segs];
      const p1 = CTRL[s];
      const p2 = CTRL[(s + 1) % segs];
      const p3 = CTRL[(s + 2) % segs];
      for (let i = 0; i < per; i++) {
        const [x, y] = catmullRom(p0, p1, p2, p3, i / per);
        wps.push({ x, y, tx: 0, ty: 0 });
      }
    }
    for (let i = 0; i < N_WP; i++) {
      const a = wps[(i + 1) % N_WP], b = wps[(i - 1 + N_WP) % N_WP];
      const dx = a.x - b.x, dy = a.y - b.y;
      const len = Math.hypot(dx, dy) || 1;
      wps[i].tx = dx / len;
      wps[i].ty = dy / len;
    }
  }

  // ===== テクスチャ（見た目）と走行マスク =====
  let texData32;       // Uint32Array (ABGR)
  let roadMask;        // Uint8Array 1=道路
  const GRASS_A = 0xff2e7d32, GRASS_B = 0xff276b2b; // 範囲外用の市松グラス(ABGR)

  function tracePath(c) {
    c.beginPath();
    c.moveTo(wps[0].x, wps[0].y);
    for (let i = 1; i < N_WP; i++) c.lineTo(wps[i].x, wps[i].y);
    c.closePath();
  }

  function buildTexture() {
    const tc = document.createElement('canvas');
    tc.width = tc.height = TEX;
    const t = tc.getContext('2d');

    // 草地（市松模様）
    for (let y = 0; y < TEX; y += 64) {
      for (let x = 0; x < TEX; x += 64) {
        t.fillStyle = ((x ^ y) & 64) ? '#2e7d32' : '#276b2b';
        t.fillRect(x, y, 64, 64);
      }
    }

    t.lineJoin = 'round';
    t.lineCap = 'round';

    // 縁石（赤地 + 白の破線）
    tracePath(t);
    t.strokeStyle = '#d32f2f';
    t.lineWidth = ROAD_W + 14;
    t.stroke();
    tracePath(t);
    t.strokeStyle = '#f5f5f5';
    t.lineWidth = ROAD_W + 14;
    t.setLineDash([18, 18]);
    t.stroke();
    t.setLineDash([]);

    // 路面
    tracePath(t);
    t.strokeStyle = '#5b5b66';
    t.lineWidth = ROAD_W;
    t.stroke();

    // センターライン
    tracePath(t);
    t.strokeStyle = 'rgba(255,255,255,0.55)';
    t.lineWidth = 3;
    t.setLineDash([22, 26]);
    t.stroke();
    t.setLineDash([]);

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

    // 走行マスク（縁石まで走行可）
    const mc = document.createElement('canvas');
    mc.width = mc.height = TEX;
    const m = mc.getContext('2d');
    m.fillStyle = '#000';
    m.fillRect(0, 0, TEX, TEX);
    m.lineJoin = 'round';
    m.lineCap = 'round';
    tracePath(m);
    m.strokeStyle = '#fff';
    m.lineWidth = ROAD_W + 14;
    m.stroke();
    const md = m.getImageData(0, 0, TEX, TEX).data;
    roadMask = new Uint8Array(TEX * TEX);
    for (let i = 0; i < TEX * TEX; i++) roadMask[i] = md[i * 4] > 128 ? 1 : 0;
  }

  function isRoad(x, y) {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= TEX || yi >= TEX) return false;
    return roadMask[yi * TEX + xi] === 1;
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
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.key];
    if (k) input[k] = false;
  });

  function bindTouch(id, flag) {
    const el = document.getElementById(id);
    const on = (e) => { e.preventDefault(); initAudio(); input[flag] = true; };
    const off = (e) => { e.preventDefault(); input[flag] = false; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }
  bindTouch('tc-left', 'left');
  bindTouch('tc-right', 'right');
  bindTouch('tc-gas', 'up');
  document.getElementById('tc-item').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    itemPressed = true;
  });

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
      for (const off of [-24, 0, 24]) {
        itemBoxes.push({ x: w.x + rx * off, y: w.y + ry * off, respawn: 0 });
      }
    }
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
    let limit = MAX_SPEED * k.skill * (onRoad ? 1 : OFFROAD_MUL);

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
    k.a += steer * TURN_RATE * speedFactor * Math.sign(k.speed || 1) * dt;

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
          if (k.isPlayer) beep(660, 0.12, 0.1, 'triangle');
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
          if (k.isPlayer) beep(180, 0.4, 0.15, 'sawtooth');
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
          ground32[p++] = (((txi >> 6) ^ (tyi >> 6)) & 1) ? GRASS_A : GRASS_B;
        }
        wx += sx;
        wy += sy;
      }
    }
    ctx.putImageData(groundImg, 0, HORIZON);
  }

  function renderSky(heading) {
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
    g.addColorStop(0, '#4fc3f7');
    g.addColorStop(1, '#c8eefb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HORIZON);
    // 視点に合わせて流れる雲
    ctx.font = '22px serif';
    const span = W * 4;
    for (let i = 0; i < 6; i++) {
      const base = i * span / 6;
      let x = (base - heading / (Math.PI * 2) * span) % span;
      if (x < 0) x += span;
      ctx.fillText('☁️', x - 30, 28 + ((i * 37) % 50));
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
      if (it.x < -80 || it.x > W + 80) continue;
      if (it.type === 'box') {
        const s = 26 * it.scale;
        const bob = Math.sin(performance.now() / 250 + it.fz) * s * 0.08;
        ctx.save();
        ctx.translate(it.x, it.y - s / 2 + bob);
        ctx.fillStyle = `hsla(${(performance.now() / 12) % 360}, 80%, 60%, 0.85)`;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(1, s * 0.07);
        ctx.beginPath();
        ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${s * 0.7}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, s * 0.05);
        ctx.restore();
      } else if (it.type === 'banana') {
        const s = 20 * it.scale;
        ctx.font = `${s}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('🍌', it.x, it.y);
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
  }

  function renderFog() {
    const g = ctx.createLinearGradient(0, HORIZON, 0, HORIZON + 36);
    g.addColorStop(0, 'rgba(200,238,251,0.9)');
    g.addColorStop(1, 'rgba(200,238,251,0)');
    ctx.fillStyle = g;
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
    hudItem.textContent = player.item === 'boost' ? '🍄' : player.item === 'banana' ? '🍌' : '';
  }

  // ===== 進行管理 =====
  let playerFinishTime = 0;

  function onPlayerFinish() {
    playerFinishTime = raceTime;
    state = 'finished';
    msgEl.textContent = 'FINISH!';
    beep(660, 0.2);
    setTimeout(() => beep(880, 0.4), 200);
    setTimeout(showResults, 1800);
  }

  function showResults() {
    msgEl.textContent = '';
    const { rank, sorted } = rankOf(player);
    panelTitle.textContent = rank === 1 ? '🏆 優勝！' : `${rank}位でゴール！`;
    panelText.textContent = `タイム: ${fmtTime(playerFinishTime)}`;
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
  buildTexture();
  resetRace();
  render(); // タイトル背景として1フレーム描画
  requestAnimationFrame(loop);
})();
