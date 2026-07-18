import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/* =====================================================================
   ふにゃふにゃアスレチック — Human Fall Flat風 物理アスレチック
   さいだい5人同時プレイ（PeerJS / WebRTC・ホスト権威方式）
   - ホスト（またはひとりプレイ）が全員ぶんの物理を計算して配信
   - ゲストは入力だけ送り、受け取ったスナップショットを補間表示
   ===================================================================== */

/* ===== 定数 ===== */
const MAX_PLAYERS = 5;
const GRAVITY = -11;             // 低めの重力＝ふわっとした本家風ジャンプ・落下
const FIXED_DT = 1 / 60;
/* ── キャラの動きチューニング（HFF風もっさりフィール） ── */
const WALK_SPEED = 3.4;          // 歩行最高速 m/s（2.5〜3.5）
const WALK_ACCEL = 0.085;        // 地上の速度ブレンド係数（最高速まで~0.5秒）
const AIR_ACCEL = 0.035;         // 空中の効きはよわめ
const JUMP_SPEED = 4.8;          // ジャンプ初速（到達 ~1.0m）
const HANG_JUMP = 4.4;           // ぶらさがりから跳ぶとき
const AIR_POSTURE = 0.4;         // ジャンプ・落下中の姿勢維持は30-50%に減衰（脱力）
const HARD_FALL_V = 7.5;         // これより速く落ちて着地→ラグドール脱力
const LIMP_TIME = 0.8;           // 着地脱力の長さ（0.5〜1.0秒）
const ARM_LEN = 0.72;            // うでの長さ（つかみ時のリーチ）
const HAND_REACH = 0.95;         // 手球が肩からはなれられる物理上限（ソフトリミット）
const ARM_VIS_MAX = 1.25;        // 見た目の腕の最大長（これ以上は伸びない）
const OFF_WHITE = 0xf2f0eb;      // キャラの基本色（オフホワイト）
const FALL_Y = -8;               // 物がこれよりしずんだら持ち場へもどる
const WATER_Y = -3.5;            // 海面の高さ（見た目のはいけい）
const RESPAWN_Y = -2.4;          // これより落ちたらチェックポイントからやりなおし（海に落ちる前）
const SKY_DROP = 13;             // 復帰するとき チェックポイントの上 このたかさの空から降ってくる
const SKY_LIMP = 1.35;           // 降ってくるあいだラグドール（着地で起きあがる）
const SNAP_MS = 50;              // ホストの配信間隔 (20Hz)
const INPUT_MS = 50;             // ゲストの入力送信間隔
const INTERP_DELAY = 130;        // ゲスト側の補間遅延(ms)
// スキン: 体の差し色（上半身の色）× ぼうし。先頭＝オフホワイト（デフォルト）
const SKIN_COLORS = [OFF_WHITE, 0xff6b6b, 0x4dabf7, 0x51cf66, 0xffd43b, 0xb197fc, 0xff9f43, 0x3bc9db];
const HAT_NAMES = ['なし', 'ぼうし', 'かんむり', 'ねこみみ', 'ハット'];
function normSkin(s) {
  const c = s && Number.isFinite(+s.c) ? Math.min(SKIN_COLORS.length - 1, Math.max(0, Math.floor(+s.c))) : 0;
  const h = s && Number.isFinite(+s.h) ? Math.min(HAT_NAMES.length - 1, Math.max(0, Math.floor(+s.h))) : 0;
  return { c, h };
}
// チェックポイント・ゾーン・ゴールは選択中のコース定義からセットされる
let CHECKPOINTS = [];
let CP_ZONES = [];
let GOAL = { x0: 0, x1: 0, z0: 0, y: 0 };
const IS_TOUCH = 'ontouchstart' in window;

const LOCAL_NET = new URLSearchParams(location.search).has('local');

/* ===== DOM ===== */
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const panelEl = $('panel');
const hudEl = $('hud');
const hudRoomEl = $('hud-room');
const hudCodeEl = $('hud-code');
const hudPlayersEl = $('hud-players');
const hudMsgEl = $('hud-msg');
const netStatusEl = $('net-status');
const nameInput = $('name');
const codeInput = $('code-input');
const touchEl = $('touch');

function netStatus(msg) { netStatusEl.textContent = msg; }

let msgTimer = 0;
function showMsg(text, ms = 2600) {
  hudMsgEl.textContent = text;
  hudMsgEl.classList.remove('hidden');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => hudMsgEl.classList.add('hidden'), ms);
}

function getPlayerName() {
  return (nameInput.value || '').trim().slice(0, 8) || 'あなた';
}

/* =====================================================================
   サウンド（Web Audio APIでその場合成・アセット不要）
   ===================================================================== */
const Sound = (() => {
  let ctx = null, master = null, muted = false, ambient = null;
  try { muted = localStorage.getItem('hff-muted') === '1'; } catch (e) { /* 保存なしでもOK */ }

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  // 単音（エンベロープつき）
  function tone(freq, dur, o = {}) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.peak || 0.25, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  // ノイズ（ざらざら音・水しぶきや金属音に）
  function noise(dur, o = {}) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1000, t0);
    f.Q.value = o.q || 1;
    if (o.glideTo) f.frequency.exponentialRampToValueAtTime(o.glideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.peak || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  const SFX = {
    click: () => tone(660, 0.06, { type: 'triangle', peak: 0.13 }),
    join: () => { tone(523, 0.1, { type: 'triangle', peak: 0.16 }); tone(784, 0.12, { type: 'triangle', peak: 0.16, delay: 0.08 }); },
    jump: () => tone(300, 0.16, { type: 'sine', peak: 0.2, glideTo: 640 }),
    grab: () => { noise(0.05, { peak: 0.1, filter: 'highpass', freq: 2200 }); tone(900, 0.04, { type: 'square', peak: 0.04 }); },
    land: () => { tone(150, 0.13, { type: 'sine', peak: 0.26, glideTo: 68 }); noise(0.08, { peak: 0.1, filter: 'lowpass', freq: 420 }); },
    splash: () => { noise(0.35, { peak: 0.24, filter: 'bandpass', freq: 1500, glideTo: 480, q: 0.7 }); tone(500, 0.18, { type: 'sine', peak: 0.06, glideTo: 200 }); },
    checkpoint: () => { tone(784, 0.12, { type: 'triangle', peak: 0.2 }); tone(1175, 0.16, { type: 'triangle', peak: 0.2, delay: 0.1 }); },
    goal: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.32, { type: 'triangle', peak: 0.22, delay: i * 0.11 })),
    gate: () => { tone(95, 0.3, { type: 'square', peak: 0.16, glideTo: 55 }); noise(0.28, { peak: 0.1, filter: 'lowpass', freq: 320 }); },
    lever: () => { noise(0.03, { peak: 0.14, filter: 'highpass', freq: 1600 }); tone(220, 0.08, { type: 'square', peak: 0.08, delay: 0.05 }); },
    catapult: () => { noise(0.42, { peak: 0.2, filter: 'bandpass', freq: 300, glideTo: 2600, q: 0.6 }); tone(200, 0.4, { type: 'sawtooth', peak: 0.06, glideTo: 900 }); },
    thud: () => { tone(110, 0.16, { type: 'sine', peak: 0.28, glideTo: 55 }); noise(0.1, { peak: 0.12, filter: 'lowpass', freq: 300 }); },
  };
  const log = []; // 動作確認用: 鳴らそうとした音の記録
  function play(name) {
    log.push(name); if (log.length > 40) log.shift();
    if (muted) return;
    ensure();
    if (!ctx || !SFX[name]) return;
    try { SFX[name](); } catch (e) { /* 生成失敗は無視 */ }
  }
  // うっすら流れる環境音（コースごとにコードがちがう）
  function startAmbient(course) {
    if (muted) return;
    ensure();
    if (!ctx) return;
    stopAmbient();
    const chords = [[98, 147, 196], [110, 165, 247], [73, 110, 174]];
    const base = chords[course] || chords[0];
    const bus = ctx.createGain(); bus.gain.value = 0.0001; bus.connect(master);
    const nodes = [];
    base.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 5;
      o.connect(bus); o.start();
      nodes.push(o);
    });
    bus.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 2.5);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(bus.gain); lfo.start();
    nodes.push(lfo);
    ambient = { bus, nodes };
  }
  function stopAmbient() {
    if (!ambient || !ctx) { ambient = null; return; }
    const a = ambient; ambient = null;
    try {
      a.bus.gain.cancelScheduledValues(ctx.currentTime);
      a.bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      setTimeout(() => a.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* 停止ずみ */ } }), 500);
    } catch (e) { /* 無視 */ }
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('hff-muted', m ? '1' : '0'); } catch (e) { /* 無視 */ }
    if (master) master.gain.value = m ? 0 : 0.5;
    if (m) stopAmbient();
  }
  return { play, ensure, startAmbient, stopAmbient, setMuted, isMuted: () => muted, log };
})();

/* ===== なまえ・スキンの選択と保存 ===== */
let mySkin = { c: 0, h: 0 };
try {
  const sv = JSON.parse(localStorage.getItem('hff-skin') || 'null');
  if (sv) mySkin = normSkin(sv);
  const nm = localStorage.getItem('hff-name');
  if (nm) nameInput.value = nm.slice(0, 8);
} catch (e) { /* プライベートモードなどでは保存なし */ }

function saveProfile() {
  try {
    localStorage.setItem('hff-skin', JSON.stringify(mySkin));
    localStorage.setItem('hff-name', getPlayerName());
  } catch (e) { /* 同上 */ }
}
nameInput.addEventListener('change', () => { saveProfile(); refreshPreview(); });

function buildSkinPicker() {
  const colorRow = $('color-row');
  SKIN_COLORS.forEach((col, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = '#' + col.toString(16).padStart(6, '0');
    b.title = 'いろ ' + (i + 1);
    if (i === mySkin.c) b.classList.add('sel');
    b.addEventListener('click', () => {
      mySkin.c = i;
      [...colorRow.children].forEach((el, j) => el.classList.toggle('sel', j === i));
      saveProfile();
      refreshPreview();
    });
    colorRow.appendChild(b);
  });
  const hatRow = $('hat-row');
  HAT_NAMES.forEach((nm, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = nm;
    if (i === mySkin.h) b.classList.add('sel');
    b.addEventListener('click', () => {
      mySkin.h = i;
      [...hatRow.children].forEach((el, j) => el.classList.toggle('sel', j === i));
      saveProfile();
      refreshPreview();
    });
    hatRow.appendChild(b);
  });
}
buildSkinPicker();

/* ===== Three.js セットアップ ===== */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 1.75)); // スマホは軽めに
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdcebf7);              // 空ドームのそと（ほぼ見えない）
scene.fog = new THREE.Fog(0xe6eff8, 42, 145);              // 遠くは空にとける

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 240); // FOV 50-60°（本家風）

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

/* やわらかい太陽光（暖色 #FFF4E0・強度~1.0）＋空色→地面色のヘミライト。
   陰影のコントラストは弱めにして「おもちゃ/ジオラマ」の質感に */
scene.add(new THREE.HemisphereLight(0xc3dcf2, 0xd9c9ae, 0.95));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
sun.position.set(-22, 38, -6);
sun.castShadow = true;
const shadowRes = IS_TOUCH ? 1024 : 2048;
sun.shadow.mapSize.set(shadowRes, shadowRes);
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -70;
sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0004;
sun.target.position.set(0, 0, 60);
scene.add(sun, sun.target);

/* =====================================================================
   コース（見た目はすぐ作る。物理ボディはホスト開始時に作る）
   手作りのパズルレベル3本: ゆめのおうち / こうじげんば / ゆめのおしろ
   （どのレベルも「ゆめの中の浮き島」。正攻法と力技の複数解を用意する）
   ===================================================================== */
const staticDefs = [];  // {w,h,d,x,y,z,rotX, bounce?}
const dynObjects = [];  // {mesh, kind:'box'|'sphere', size|radius, mass, home:{p,q?}, body, kinematic?, rope?, hinge?}
const GIM = {};         // ギミック定義（buildLevel がコースごとに初期化する）
let levelRoot = new THREE.Group();       // コースの見た目はすべてこの下（コース切替で破棄）
scene.add(levelRoot);

/* 単色フラット（Lambert）・彩度低めのパステル。本家風の「おもちゃ/ジオラマ」感 */
const MAT = {
  grass: new THREE.MeshLambertMaterial({ color: 0xaad391 }),     // あわい草いろ
  dirt: new THREE.MeshLambertMaterial({ color: 0xb08a63 }),      // 浮き島の土の断面
  dirtDark: new THREE.MeshLambertMaterial({ color: 0x91704f }),
  wood: new THREE.MeshLambertMaterial({ color: 0xe8d2a8 }),      // 木＝明るいベージュ
  woodDark: new THREE.MeshLambertMaterial({ color: 0xcfae7d }),
  crate: new THREE.MeshLambertMaterial({ color: 0xdfb87f }),
  plaster: new THREE.MeshLambertMaterial({ color: 0xf4f0e7 }),   // 白かべ
  stone: new THREE.MeshLambertMaterial({ color: 0xc9cfd6 }),     // 石＝ライトグレー
  stoneDark: new THREE.MeshLambertMaterial({ color: 0xa9b2bc }),
  roof: new THREE.MeshLambertMaterial({ color: 0xdb937f }),      // 屋根（くすんだ赤）
  red: new THREE.MeshLambertMaterial({ color: 0xe05a4e }),       // 差し色の赤（ガジェット）
  blue: new THREE.MeshLambertMaterial({ color: 0x6b99d8 }),      // 差し色の青（ガジェット）
  iron: new THREE.MeshLambertMaterial({ color: 0x8d99a6 }),
  ironDark: new THREE.MeshLambertMaterial({ color: 0x6d7883 }),
  hazard: new THREE.MeshLambertMaterial({ color: 0xf2c14e }),    // 工事の黄いろ
  orange: new THREE.MeshLambertMaterial({ color: 0xefa25f }),    // 工事のオレンジ
  concrete: new THREE.MeshLambertMaterial({ color: 0xd6d3ca }),
  brick: new THREE.MeshLambertMaterial({ color: 0xdaa089 }),
  flag: new THREE.MeshLambertMaterial({ color: 0xe86a5e, side: THREE.DoubleSide }),
  cloud: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  leaf: new THREE.MeshLambertMaterial({ color: 0x93c98d }),
  trunk: new THREE.MeshLambertMaterial({ color: 0xb08b62 }),
  gold: new THREE.MeshLambertMaterial({ color: 0xf2cf6b, emissive: 0x4a3c10 }),
};

/* ── チャプター配置トランスフォーム ──────────────────────────────
   コースを「一直線」でなく箱庭（曲がり・分岐・立体）にするため、
   セグメント一式を 90°単位のヨー＋平行移動で置きなおせるようにする。
   place(ox,oz,q) 以後の部品は、デザイン座標 p に対して
   world = (ox,0,oz) + R(q*90°) * p に置かれる（y はそのまま＝絶対値）。 */
let PL = { x: 0, z: 0, q: 0, quat: null };
function place(ox, oz, q = 0) {
  q = ((q % 4) + 4) % 4;
  PL = { x: ox, z: oz, q, quat: q ? [0, Math.sin(q * Math.PI / 4), 0, Math.cos(q * Math.PI / 4)] : null };
}
function tpos(x, y, z) {
  switch (PL.q) {
    case 1: return [PL.x + z, y, PL.z - x];
    case 2: return [PL.x - x, y, PL.z - z];
    case 3: return [PL.x - z, y, PL.z + x];
    default: return [PL.x + x, y, PL.z + z];
  }
}
function tvec(v) {  // 方向ベクトル（速度・回転軸など）を回す
  switch (PL.q) {
    case 1: return [v[2], v[1], -v[0]];
    case 2: return [-v[0], v[1], -v[2]];
    case 3: return [-v[2], v[1], v[0]];
    default: return [v[0], v[1], v[2]];
  }
}
const cpAt = (x, y, z) => { const p = tpos(x, y, z); return { x: p[0], y: p[1], z: p[2] }; };
function cpZone(cp, x0, x1, z0, z1, yMin) {
  const a = tpos(x0, 0, z0), b = tpos(x1, 0, z1);
  return { cp, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[2], b[2]), z1: Math.max(a[2], b[2]), yMin };
}

// 旧コンベア用テクスチャの名残（メインループが offset を動かすため入れ物だけ残す）
const beltTex = new THREE.Texture();

function staticBox(w, h, d, x, y, z, mat, rotX = 0, opts = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const [wx, wy, wz] = tpos(x, y, z);
  m.position.set(wx, wy, wz);
  if (rotX) m.rotation.x = rotX;
  if (opts && opts.rotY) m.rotation.y = opts.rotY;
  if (opts && opts.rotZ) m.rotation.z = opts.rotZ;
  let quat = null;
  if (PL.q) {  // 配置ヨーとローカル回転を合成（物理は quat を使う）
    const q = new THREE.Quaternion().setFromEuler(m.rotation).premultiply(new THREE.Quaternion(...PL.quat));
    m.quaternion.copy(q);
    quat = [q.x, q.y, q.z, q.w];
  }
  m.receiveShadow = true;
  m.castShadow = true;
  levelRoot.add(m);
  staticDefs.push({ w, h, d, x: wx, y: wy, z: wz, rotX, ...(opts || {}), ...(quat ? { quat } : {}) });
  return m;
}

// キネマティック（ホストが動かす）オブジェクトを登録して index を返す
function kinObject(mesh, kind, sizeOrRadius, home) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  levelRoot.add(mesh);
  const p = tpos(...home);
  const o = { mesh, kind, mass: 0, kinematic: true, home: { p }, body: null };
  if (PL.quat) { o.home.q = [...PL.quat]; mesh.quaternion.set(...PL.quat); }
  if (kind === 'sphere') o.radius = sizeOrRadius;
  else o.size = sizeOrRadius;
  mesh.position.set(...p);
  dynObjects.push(o);
  return dynObjects.length - 1;
}

// 見た目だけのワイヤー/棒（毎フレーム2点間に張りなおす）
// from / to: [x,y,z]（固定点・ワールド座標＝place() 適用ずみの値を渡す）
//            or 数値（dynObjects の index） or {i, off}（物のローカル点）
function addRod(from, to, radius, mat) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6), mat);
  mesh.castShadow = true;
  levelRoot.add(mesh);
  GIM.rods.push({ mesh, from, to });
}

// ヒンジ（ちょうつがい）つきの板・とびら・レバーなど。index を返す
// pivot: ヒンジのワールド座標 / localPivot: 板の中心から見たヒンジ位置 / angle0: 初期角度
function hingedBox(w, h, d, mat, mass, pivot, localPivot, axis, angle0, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = m.receiveShadow = true;
  levelRoot.add(m);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), angle0);
  if (PL.quat) q.premultiply(new THREE.Quaternion(...PL.quat));
  const off = new THREE.Vector3(...localPivot).applyQuaternion(q);
  const wp = tpos(...pivot);
  const p = [wp[0] - off.x, wp[1] - off.y, wp[2] - off.z];
  m.position.set(...p);
  m.quaternion.copy(q);
  dynObjects.push({
    mesh: m, kind: 'box', size: [w, h, d], mass,
    home: { p, q: [q.x, q.y, q.z, q.w] },
    // axis はワールド軸（角度判定用）、axisLocal はボディローカル軸（拘束用）
    hinge: { pivot: wp, localPivot, axis: tvec(axis), axisLocal: axis, yawQ: PL.quat ? [...PL.quat] : null, motorForce: opts.motorForce || 0 },
    angularDamping: opts.angularDamping,
    body: null,
  });
  return dynObjects.length - 1;
}

// ヒンジまわりの回転角（1軸回転前提。橋・レバー・アームの判定用・ホストのみ）
function hingeAngle(idx) {
  const o = dynObjects[idx];
  const h = o.hinge;
  const q = o.body.quaternion;
  let x = q.x, y = q.y, z = q.z, w = q.w;
  if (h.yawQ) {  // qRel = q * conj(yawQ) — 配置ヨーを取りのぞいてから軸成分を見る
    const bx = -h.yawQ[0], by = -h.yawQ[1], bz = -h.yawQ[2], bw = h.yawQ[3];
    const nx = w * bx + x * bw + y * bz - z * by;
    const ny = w * by - x * bz + y * bw + z * bx;
    const nz = w * bz + x * by - y * bx + z * bw;
    const nw = w * bw - x * bx - y * by - z * bz;
    x = nx; y = ny; z = nz; w = nw;
  }
  const dot = x * h.axis[0] + y * h.axis[1] + z * h.axis[2]; // sin(θ/2)（軸成分）
  return 2 * Math.atan2(dot, w);
}

function dynBox(w, h, d, x, y, z, mat, mass, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const p = tpos(x, y, z);
  m.position.set(...p);
  if (PL.quat) m.quaternion.set(...PL.quat);
  m.castShadow = true;
  m.receiveShadow = true;
  levelRoot.add(m);
  dynObjects.push({ mesh: m, kind: 'box', size: [w, h, d], mass, home: { p, ...(PL.quat ? { q: [...PL.quat] } : {}) }, body: null, ...opts });
  return dynObjects.length - 1;
}

/* ── 浮き島: 上面＋土の断面（側面・裏面）＋すぼまった底。下から見ても島に見える ── */
function islandBox(w, d, x, topY, z, topMat = MAT.grass, topH = 0.3) {
  staticBox(w, topH, d, x, topY - topH / 2, z, topMat);
  staticBox(w, 1.15, d, x, topY - topH - 0.575, z, MAT.dirt);      // 断面（茶）
  const taper = new THREE.Mesh(new THREE.BoxGeometry(w * 0.68, 1.5, d * 0.68), MAT.dirtDark);
  taper.position.set(...tpos(x, topY - topH - 1.15 - 0.7, z));
  if (PL.quat) taper.quaternion.set(...PL.quat);
  taper.castShadow = true;
  levelRoot.add(taper);                                            // 底のすぼまり（見た目のみ）
}

/* ── くさり/ロープ: 固定点 or 物のローカル点からぶら下がる。先端に鉄球もつけられる ──
   from: {anchor:[x,y,z]} または {idx, local:[x,y,z]} / opts: {ball:{r,mass,mat}, grip, linkMass} */
function chain(from, n, spacing, opts = {}) {
  let sx, sy, sz;
  if (from.anchor) {
    [sx, sy, sz] = tpos(...from.anchor);
  } else {
    const o = dynObjects[from.idx];
    const q = new THREE.Quaternion(...(o.home.q || [0, 0, 0, 1]));
    const off = new THREE.Vector3(...from.local).applyQuaternion(q);
    sx = o.home.p[0] + off.x; sy = o.home.p[1] + off.y; sz = o.home.p[2] + off.z;
  }
  const links = [];
  for (let i = 0; i < n; i++) {
    const isBall = i === n - 1 && opts.ball;
    const isGrip = i === n - 1 && opts.grip;
    const r = isBall ? opts.ball.r : isGrip ? 0.17 : 0.1;
    const mass = isBall ? opts.ball.mass : isGrip ? 2 : (opts.linkMass || 1.2);
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(r, 0.11), isBall ? 16 : 8, isBall ? 12 : 6),
      isBall ? (opts.ball.mat || MAT.ironDark) : MAT.ironDark,
    );
    m.castShadow = true;
    levelRoot.add(m);
    const y = sy - spacing * (i + 1) - (isBall ? opts.ball.r * 0.6 : 0);
    m.position.set(sx, y, sz);
    dynObjects.push({ mesh: m, kind: 'sphere', radius: r, mass, rope: true, noStatic: !!opts.noStatic, home: { p: [sx, y, sz] }, body: null });
    links.push(dynObjects.length - 1);
  }
  GIM.chains.push({ anchor: from.anchor ? [sx, sy, sz] : undefined, attachIdx: from.idx, attachLocal: from.local, links, spacing });
  let prev = from.anchor ? [sx, sy, sz] : { i: from.idx, off: from.local };
  for (const li of links) { addRod(prev, li, 0.045, MAT.ironDark); prev = li; }
  return links;
}

/* ── かべビルダー: 開口部（ドア・まど）つきのかべを箱の組合せで作る ── */
// z一定のかべ（x0..x1, yBase..yBase+h）。openings: [{x0,x1,y0,y1}]
function wallZ(z, x0, x1, yBase, h, mat, openings = [], th = 0.3) {
  const segs = [];
  let cur = x0;
  for (const op of [...openings].sort((a, b) => a.x0 - b.x0)) {
    if (op.x0 > cur) segs.push({ a0: cur, a1: op.x0, y0: yBase, y1: yBase + h });
    if (op.y0 > yBase) segs.push({ a0: op.x0, a1: op.x1, y0: yBase, y1: op.y0 });
    if (op.y1 < yBase + h) segs.push({ a0: op.x0, a1: op.x1, y0: op.y1, y1: yBase + h });
    cur = op.x1;
  }
  if (cur < x1) segs.push({ a0: cur, a1: x1, y0: yBase, y1: yBase + h });
  for (const s of segs) staticBox(s.a1 - s.a0, s.y1 - s.y0, th, (s.a0 + s.a1) / 2, (s.y0 + s.y1) / 2, z, mat);
}
// x一定のかべ（z0..z1）。openings: [{z0,z1,y0,y1}]
function wallX(x, z0, z1, yBase, h, mat, openings = [], th = 0.3) {
  const segs = [];
  let cur = z0;
  for (const op of [...openings].sort((a, b) => a.z0 - b.z0)) {
    if (op.z0 > cur) segs.push({ a0: cur, a1: op.z0, y0: yBase, y1: yBase + h });
    if (op.y0 > yBase) segs.push({ a0: op.z0, a1: op.z1, y0: yBase, y1: op.y0 });
    if (op.y1 < yBase + h) segs.push({ a0: op.z0, a1: op.z1, y0: op.y1, y1: yBase + h });
    cur = op.z1;
  }
  if (cur < z1) segs.push({ a0: cur, a1: z1, y0: yBase, y1: yBase + h });
  for (const s of segs) staticBox(th, s.y1 - s.y0, s.a1 - s.a0, x, (s.y0 + s.y1) / 2, (s.a0 + s.a1) / 2, mat);
}

/* ── ちいさな部品 ── */
function stairs(n, rise, run, w, mat, x, y0, z0, along = 'z', dir = 1) {
  for (let i = 0; i < n; i++) {
    const y = y0 + rise * (i + 1);
    if (along === 'z') staticBox(w, 0.24, run + 0.08, x, y - 0.12, z0 + dir * run * (i + 0.5), mat);
    else staticBox(run + 0.08, 0.24, w, x + dir * run * (i + 0.5), y - 0.12, z0, mat);
  }
}

function tree(x, z, y = 0, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 0.9 * s, 7), MAT.trunk);
  trunk.position.y = 0.45 * s;
  const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85 * s, 0), MAT.leaf);
  leaf.position.y = 1.5 * s;
  leaf.scale.y = 1.25;
  trunk.castShadow = leaf.castShadow = true;
  g.add(trunk, leaf);
  g.position.set(...tpos(x, y, z));
  levelRoot.add(g);
}

function goalFlag(x, y, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.9, 8), MAT.ironDark);
  pole.position.set(...tpos(x, y + 1.45, z));
  pole.castShadow = true;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.78), MAT.flag);
  flag.position.set(...tpos(x + 0.65, y + 2.4, z));
  if (PL.quat) flag.quaternion.set(...PL.quat);
  levelRoot.add(pole, flag);
}

function banner(x, y, z, mat = MAT.red) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 6), MAT.woodDark);
  pole.position.set(...tpos(x, y + 0.85, z));
  pole.castShadow = true;
  const fl = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.66, 4), mat);
  fl.rotation.z = -Math.PI / 2;
  if (PL.quat) fl.quaternion.premultiply(new THREE.Quaternion(...PL.quat));
  fl.position.set(...tpos(x + 0.38, y + 1.5, z));
  levelRoot.add(pole, fl);
}

function trafficCone(x, z, y = 0) {
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.52, 9), MAT.orange);
  c.position.set(...tpos(x, y + 0.29, z));
  c.castShadow = true;
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.48), MAT.orange);
  b.position.set(...tpos(x, y + 0.035, z));
  levelRoot.add(c, b);
}

/* ── 箱庭の小物: ごほうびの星・気球・バウンドきのこ（かざり＋あそび） ── */
function goldStar(x, y, z, s = 1) {
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.42 * s, 0), MAT.gold);
  star.scale.y = 1.35;
  star.position.set(...tpos(x, y + 1.15 * s, z));
  star.castShadow = true;
  levelRoot.add(star);
  GIM.stars.push(star);                                     // くるくる回る（見た目のみ）
  staticBox(0.52 * s, 0.6 * s, 0.52 * s, x, y + 0.3 * s, z, MAT.stone);
}

function balloon(x, y, z, s = 1, mat = MAT.red) {          // 気球（ランドマーク・かざり）
  const g = new THREE.Group();
  const env = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), mat);
  env.scale.y = 1.18;
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.4, 10), mat);
  skirt.rotation.x = Math.PI;
  skirt.position.y = -2.9;
  const basket = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.75, 1.05), MAT.crate);
  basket.position.y = -4.15;
  env.castShadow = basket.castShadow = true;
  g.add(env, skirt, basket);
  for (const [ox, oz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 4), MAT.ironDark);
    r.position.set(ox, -3.2, oz);
    g.add(r);
  }
  g.scale.setScalar(s);
  const p = tpos(x, y, z);
  g.position.set(...p);
  levelRoot.add(g);
  GIM.floaters.push({ g, y0: p[1], ph: x + z });            // ふわふわ上下（見た目のみ）
}

function bounceShroom(x, y, z, power = 9, r = 1.4) {       // 上面 y でバウンド
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * r, 0.42 * r, 3.6, 9), MAT.plaster);
  stem.position.set(...tpos(x, y - 1.9, z));
  stem.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), MAT.red);
  cap.scale.y = 0.52;
  cap.position.set(...tpos(x, y - 0.22, z));
  cap.castShadow = true;
  levelRoot.add(stem, cap);
  const box = staticBox(r * 1.4, 0.3, r * 1.4, x, y - 0.15, z, MAT.red, 0, { bounce: power });
  box.visible = false;                                      // 当たりはキャップの中にかくす
}

function crenels(x, y, z, len, along = 'x') {
  const n = Math.max(1, Math.floor(len / 1.15));
  for (let i = 0; i < n; i += 2) {
    const off = -len / 2 + (i + 0.5) * 1.15;
    if (along === 'x') staticBox(0.85, 0.55, 0.35, x + off, y + 0.275, z, MAT.stoneDark);
    else staticBox(0.35, 0.55, 0.85, x, y + 0.275, z + off, MAT.stoneDark);
  }
}

// 決定的な乱数（かざりの浮き島の配置用。ホスト/ゲストで同じ見た目になる）
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// とおくに浮かぶ かざりの小島。spots: [{x0,x1,z0,z1,n,lo?}]（ワールド座標の矩形。
// コースが箱庭状に曲がるため、通り道とぶつからない場所を各コースが指定する）
function isletDeco(seed, spots) {
  const rng = makeRng(seed);
  for (const sp of spots) {
    for (let i = 0; i < sp.n; i++) {
      const x = sp.x0 + rng() * (sp.x1 - sp.x0);
      const z = sp.z0 + rng() * (sp.z1 - sp.z0);
      const y = (sp.lo || rng() >= 0.35) ? -4 - rng() * 6 : 5 + rng() * 7;
      const s = 2.6 + rng() * 3.2;
      islandBox(s, s * (0.8 + rng() * 0.5), x, y, z);
      if (rng() < 0.7) tree(x + (rng() - 0.5) * s * 0.4, z + (rng() - 0.5) * s * 0.4, y, 0.8 + rng() * 0.6);
    }
  }
}

/* ── ギミック部品 ── */
// 赤い押しボタン（手でおすと作動）＋スライドするとびら
function gimButtonDoor(btnPos, doorHome, doorSize, openY, msg, doorMat = MAT.red, opts = {}) {
  staticBox(0.36, btnPos[1] - 0.18, 0.36, btnPos[0], (btnPos[1] - 0.18) / 2 + 0.02, btnPos[2], MAT.ironDark); // だい
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.28, 12), MAT.red);
  const capIdx = kinObject(cap, 'box', [0.42, 0.28, 0.42], btnPos);
  const door = new THREE.Mesh(new THREE.BoxGeometry(...doorSize), doorMat);
  const doorIdx = kinObject(door, 'box', doorSize, doorHome);
  GIM.buttons.push({ capIdx, pos: tpos(...btnPos), doorIdx, homeY: doorHome[1], openY, msg, objHit: !!opts.objHit });
  return doorIdx;
}

// 床スイッチ（おもみで作動）＋スライドするとびら
function gimPadDoor(padPos, doorHome, doorSize, openY, msg, doorMat = MAT.blue) {
  // わく（上面は床とツライチ＝箱をおしてそのまま乗せられる）
  staticBox(2.0, 0.06, 2.0, padPos[0], padPos[1] + 0.04, padPos[2], MAT.ironDark);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 1.7), MAT.blue);
  const padIdx = kinObject(pad, 'box', [1.7, 0.14, 1.7], [padPos[0], padPos[1], padPos[2]]);
  const door = new THREE.Mesh(new THREE.BoxGeometry(...doorSize), doorMat);
  const doorIdx = kinObject(door, 'box', doorSize, doorHome);
  GIM.pads.push({ padIdx, gateIdx: doorIdx, padPos: tpos(padPos[0], padPos[1] + 0.07, padPos[2]), padHomeY: padPos[1], gateHomeY: doorHome[1], gateOpenY: openY, msg });
  return doorIdx;
}

// レバー（ヒンジ棒）を作って index を返す
function gimLever(x, y, z, angle0 = 0, opts = {}) {
  const baseY = opts.baseY || 0;
  const postH = Math.max(0.2, y - baseY - 0.1);
  // 支柱はよこにオフセット（レバーをおし切るとき体がぶつからない）＋じくの見た目
  staticBox(0.14, postH, 0.14, x + 0.32, baseY + postH / 2, z, MAT.ironDark);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 8), MAT.ironDark);
  axle.rotation.z = Math.PI / 2;
  if (PL.quat) axle.quaternion.premultiply(new THREE.Quaternion(...PL.quat));
  axle.position.set(...tpos(x + 0.18, y, z));
  axle.castShadow = true;
  levelRoot.add(axle);
  // 長めのバー＋低めの支点＝体でおしても、つかんでひいても動かせる
  const idx = hingedBox(0.1, 1.0, 0.1, MAT.red, 0.8, [x, y, z], [0, -0.42, 0], [1, 0, 0], angle0,
    { angularDamping: 0.5 });
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), MAT.red);
  knob.position.y = 0.48;
  dynObjects[idx].mesh.add(knob);
  return idx;
}

/* ゆれるつり橋: 板をくさり状につないだ橋（左右2点のP2P拘束は initPhysics が張る） */
function hangingBridge(x, y, z0, z1, w, n, mat = MAT.woodDark) {
  const step = (z1 - z0) / (n + 1);
  const planks = [];
  for (let i = 0; i < n; i++) {
    // 板は広め（すきま最小）・重め・回転減衰つよめ＝ゆれるが すきまに落ちない
    planks.push(dynBox(w, 0.12, step * 0.9, x, y, z0 + step * (i + 1), mat, 6, { rope: true, angularDamping: 0.65 }));
  }
  GIM.plankBridges.push({ a: tpos(x, y, z0), b: tpos(x, y, z1), planks, joint: step / 2, w, q: PL.quat ? [...PL.quat] : null });
  for (const ze of [z0, z1]) {   // りょうはしの門ばしら（通行のじゃまにならない位置）
    staticBox(0.24, 1.3, 0.24, x - w / 2 - 0.5, y + 0.4, ze, mat);
    staticBox(0.24, 1.3, 0.24, x + w / 2 + 0.5, y + 0.4, ze, mat);
  }
  return planks;
}

/* 回転する床（ターンテーブル）。うえに乗った人もいっしょにまわる */
function spinnerDisc(x, topY, z, r, omega, mat = MAT.hazard) {
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.26, 22), mat);
  const idx = kinObject(disc, 'box', [r * 1.7, 0.26, r * 1.7], [x, topY - 0.13, z]);
  dynObjects[idx].spin = omega;          // 乗った人の足もとを流す（Doll.controlが参照）
  const wc = tpos(x, 0, z);
  dynObjects[idx].spinCenter = [wc[0], wc[2]];
  const mark = new THREE.Mesh(new THREE.BoxGeometry(r * 1.9, 0.09, 0.3), MAT.ironDark);
  mark.position.y = 0.14;
  disc.add(mark);
  GIM.spinners.push({ idx, omega });
  staticBox(0.4, 3.6, 0.4, x, topY - 2.1, z, MAT.ironDark);      // したの支柱
  return idx;
}

/* 往復する足場（時刻でうごきがきまる＝ホスト/ゲストでずれない） */
function moverBox(size, home, axis, amp, omega, phase = 0, mat = MAT.hazard) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  const idx = kinObject(mesh, 'box', size, home);
  const p = dynObjects[idx].home.p;                     // ワールド座標（place 適用ずみ）
  const wAxis = (PL.q % 2) ? (axis === 'x' ? 'z' : 'x') : axis;
  GIM.movers.push({ idx, axis: wAxis, base: wAxis === 'x' ? p[0] : p[2], amp, omega, phase });
  return idx;
}

/* =====================================================================
   コース1「ゆめのおうち」— チュートリアル（邸宅風・5分規模）
   おす→ボタン→はこ運び→つみ上げ→やねのゴール、の順に基本操作を学ぶ
   ===================================================================== */
function buildCourse1() {
  const H = 3.6;                                   // 部屋の高さ
  // ── 浮き島（にわ＋いえ）──
  islandBox(15, 47, 0, 0, 17.5);                   // z -6 .. 41
  tree(-6, -3.5, 0, 1.1); tree(6.2, -2.5, 0, 0.9); tree(-6.4, 39.5, 0, 1.0); tree(6.4, 39, 0, 0.85);
  banner(-2.6, 0, -2.2, MAT.blue); banner(2.6, 0, -2.2, MAT.red);
  staticBox(10.6, 0.14, 33, 0, 0.07, 20.5, MAT.wood);   // いえの木の床（上面 y0.14, z 4..37）

  // ── まえのかべ（z4）: おしてあけるドア（ヒンジ・①） ──
  wallZ(4, -5.3, 5.3, 0, H, MAT.plaster, [{ x0: -0.9, x1: 0.9, y0: 0, y1: 2.35 }]);
  hingedBox(1.66, 2.1, 0.1, MAT.woodDark, 4, [-0.87, 1.27, 4], [-0.8, 0, 0], [0, 1, 0], 0, { angularDamping: 0.7 });
  // よこのかべ: 大きなまど穴（まどから外へ出る力技ルートもOK）
  const win = (z) => ({ z0: z, z1: z + 2.6, y0: 0.95, y1: 2.5 });
  wallX(-5.15, 4, 37, 0, H, MAT.plaster, [win(7.5), win(18.5), win(28)]);
  wallX(5.15, 4, 37, 0, H, MAT.plaster, [win(7.5), win(18.5), win(28)]);
  wallZ(37, -5.3, 5.3, 0, H, MAT.plaster);         // うしろのかべ

  // ── 部屋A（z4..15）: 家具とあそべる小箱 ──
  staticBox(1.7, 0.78, 0.9, -3.6, 0.53, 9, MAT.woodDark);        // テーブル
  dynBox(0.5, 0.5, 0.5, -3.6, 1.2, 9, MAT.blue, 6, { noSleep: true });              // つみき
  dynBox(0.55, 0.55, 0.55, 3.4, 0.45, 7.5, MAT.crate, 10, { noSleep: true });       // 小さなはこ

  // ── かべ z15: 赤い押しボタン（②）でひらくスライドドア ──
  wallZ(15, -5.3, 5.3, 0, H, MAT.plaster, [{ x0: -1.0, x1: 1.0, y0: 0, y1: 2.45 }]);
  gimButtonDoor([2.1, 1.3, 14.35], [0, 1.41, 15], [2.1, 2.55, 0.22], -1.3,
    '🔴 ボタンをおした！あかいドアがひらく…');

  // ── 部屋B（z15..26）: 木箱を床スイッチへ（③） ──
  wallZ(26, -5.3, 5.3, 0, H, MAT.plaster, [{ x0: -1.0, x1: 1.0, y0: 0, y1: 2.45 }]);
  gimPadDoor([2.6, 0.07, 22.3], [0, 1.41, 26], [2.1, 2.55, 0.22], -1.3,
    '⚖️ おもみで あおいとびらがひらいた！（はなれると しまるよ）');
  dynBox(0.72, 0.72, 0.72, 0.8, 0.55, 20, MAT.crate, 12, { noSleep: true });        // 木箱（スイッチ用）
  dynBox(0.72, 0.72, 0.72, -1.6, 0.55, 20.5, MAT.crate, 12, { noSleep: true });

  // ── 部屋C（z26..37）: はこをつんで たかい棚（ロフト 1.95m）へ（④） ──
  staticBox(10.6, 0.2, 6, 0, 1.85, 34, MAT.wood);                // ロフト（上面 y1.95）
  staticBox(2.2, 0.95, 0.8, -4.0, 0.62, 30.4, MAT.woodDark);     // たんす（とちゅうの足場）
  dynBox(0.72, 0.72, 0.72, 2.5, 0.55, 28, MAT.crate, 12, { noSleep: true });        // つみ上げ用の木箱
  dynBox(0.72, 0.72, 0.72, 3.4, 0.55, 29, MAT.crate, 12, { noSleep: true });

  // ── ロフト → やね: 階段箱で屋根の穴から外へ（⑤） ──
  staticBox(1.6, 0.5, 1.1, 3.0, 2.2, 31.9, MAT.woodDark);        // だん1（上面2.45）
  staticBox(1.6, 0.5, 1.1, 3.0, 2.75, 33.0, MAT.woodDark);       // だん2（上面3.0）
  // やね（上面 y3.9。ロフトの上 z31.2..33.8 x1.2..4.8 に穴）
  staticBox(10.6, 0.3, 27.2, 0, 3.75, 17.6, MAT.roof);           // z 4..31.2
  staticBox(6.5, 0.3, 2.6, -2.05, 3.75, 32.5, MAT.roof);         // 穴のよこ（x -5.3..1.2）
  staticBox(0.5, 0.3, 2.6, 5.05, 3.75, 32.5, MAT.roof);          // 穴のよこ（x 4.8..5.3）
  staticBox(10.6, 0.3, 3.2, 0, 3.75, 35.4, MAT.roof);            // z 33.8..37
  // やねのふち（らっかよけの低いパラペット）
  staticBox(10.9, 0.32, 0.25, 0, 4.06, 4.05, MAT.plaster);
  staticBox(4.25, 0.32, 0.25, -3.325, 4.06, 36.95, MAT.plaster);   // うしろは出口をあける
  staticBox(4.25, 0.32, 0.25, 3.325, 4.06, 36.95, MAT.plaster);
  staticBox(0.25, 0.32, 33, -5.28, 4.06, 20.5, MAT.plaster);
  staticBox(0.25, 0.32, 33, 5.28, 4.06, 20.5, MAT.plaster);
  // えんとつ
  staticBox(0.9, 1.1, 0.9, -3.4, 4.4, 8.5, MAT.brick);

  banner(-4.2, 3.9, 35.6, MAT.blue);                             // 屋上（ここは中間地点）
  goldStar(-4.1, 1.95, 35.6, 0.7);                               // よりみちのごほうび（ロフトのおく）

  /* ═══ 第2章（東へまがる）: 屋根のすべり台 → うらにわ ═══
     ここからコースは家のうしろで直角にまがり、うらにわが東にひろがる（箱庭化） */
  place(-37.4, 38.0, 1);
  // ── ⑥ うらにわ: 屋根からすべり台でおりる（東むき） ──
  staticBox(2.4, 0.22, 8.8, 0, 1.82, 40.9, MAT.wood, 0.42);      // すべり台
  staticBox(0.16, 0.34, 8.8, -1.28, 1.98, 40.9, MAT.woodDark, 0.42);
  staticBox(0.16, 0.34, 8.8, 1.28, 1.98, 40.9, MAT.woodDark, 0.42);
  islandBox(18, 20, 0, 0.03, 54);                                // うらにわ（家の島と少しかさなってつながる）
  tree(-7.4, 47, 0, 1.1); tree(7.2, 49, 0, 0.9); tree(-6.8, 60, 0, 0.95);
  staticBox(1.9, 0.42, 0.7, -5.5, 0.21, 52, MAT.woodDark);       // ベンチ
  staticBox(0.55, 0.35, 0.55, 5.5, 0.17, 46.5, MAT.red);         // 花だん
  staticBox(0.55, 0.35, 0.55, 6.6, 0.17, 47.4, MAT.blue);
  staticBox(0.55, 0.35, 0.55, 5.9, 0.17, 48.6, MAT.gold);
  // よじ登り①: にわの塀（1.45m）。ジャンプではとどかない＝掴んでのぼる練習
  staticBox(18, 1.45, 0.5, 0, 0.725, 56, MAT.brick);
  staticBox(18.2, 0.12, 0.62, 0, 1.51, 56, MAT.plaster);         // 塀の笠石

  // ── ⑦ まとあて: 箱をなげて 高いボタンにあてると 生けがきの門がひらく ──
  wallZ(62, -9, 9, 0, 2.6, MAT.leaf, [{ x0: -1.1, x1: 1.1, y0: 0, y1: 2.25 }], 0.6);
  gimButtonDoor([2.6, 3.15, 61.35], [0, 1.16, 62], [2.3, 2.3, 0.34], -1.2,
    null, MAT.leaf, { objHit: true });
  dynBox(0.45, 0.45, 0.45, -2.0, 0.5, 58.5, MAT.red, 5, { noSleep: true });   // なげる用の箱
  dynBox(0.45, 0.45, 0.45, -1.2, 0.5, 59.3, MAT.blue, 5, { noSleep: true });
  // 門のさきは ふたまたの分かれ道（みなみ=あか / きた=あお）
  banner(6.4, 0, 63.2, MAT.red);
  banner(-6.4, 0, 63.2, MAT.blue);

  /* ═══ 第3章A みなみルート: シーソー橋 → 果樹園 → ゆれるつり橋 ═══ */
  place(-37.4, 31.6, 1);
  // ── ⑧ シーソー橋: バランスをとってわたる ──
  staticBox(0.55, 3.4, 0.55, 0, -1.3, 67.5, MAT.woodDark);       // 中心の支柱
  staticBox(2.5, 0.3, 1.2, 0, 0.15, 63.4, MAT.stone);            // ふみ石（島→板さきの段さしけし）
  hingedBox(2.3, 0.16, 7.6, MAT.wood, 8, [0, 0.68, 67.5], [0, 0, 0], [1, 0, 0], -0.13,
    { angularDamping: 0.55 });
  islandBox(14, 8, 0, 0, 75);                                    // 果樹園の島
  tree(-4.5, 73, 0, 1.2); tree(4.2, 76.5, 0, 1.05); tree(0.5, 77.5, 0, 0.8);
  // よじ登り②: 果樹園の石垣（1.45m・島のはば全体）
  staticBox(14, 1.45, 0.6, 0, 0.725, 74.6, MAT.stoneDark);
  // ── ⑨ ゆれるつり橋 ──
  hangingBridge(0, 0.0, 79, 87, 2.4, 5, MAT.wood);

  /* ═══ 第3章B きたルート: バウンドきのこの空とび（あたらしいあそび） ═══ */
  place(-37.4, 44.4, 1);
  bounceShroom(0, -1.1, 66.4, 9);
  islandBox(3.4, 3.4, 0, -0.2, 69.5);                            // とちゅうの小島
  bounceShroom(0, -1.1, 73, 9);
  islandBox(4.5, 4.5, 0, -0.2, 77);                              // 休けいの小島（中間地点）
  banner(0, -0.2, 76.2, MAT.blue);
  bounceShroom(0, -1.1, 81, 9);
  islandBox(3.4, 3.4, 0, -0.2, 84);                              // さいごの小島 → テラスへジャンプ

  /* ═══ ごうりゅう: にわのテラス（ここからまた北へまがる） ═══ */
  place(0, 0, 0);
  islandBox(8, 18, 53.6, 0, 38);                                 // テラス（x49.6..57.6, z29..47）
  banner(50.6, 0, 34, MAT.red); tree(50.8, 44.5, 0, 1.0);
  // よじ登り③: テラスの高台（1.5m）。のぼった先からターザンへ
  staticBox(4, 1.5, 6, 55, 0.75, 41, MAT.grass);
  // ── ⑩ くさりターザンで大ジャンプ（高台のきたはしからとびつく） ──
  staticBox(0.5, 8, 0.5, 52.4, 3, 46.2, MAT.woodDark);           // やぐら
  staticBox(0.5, 8, 0.5, 57.6, 3, 46.2, MAT.woodDark);
  staticBox(5.6, 0.4, 0.5, 55, 6.8, 46.2, MAT.woodDark);
  chain({ anchor: [55, 6.6, 46.2] }, 9, 0.55, { grip: true });   // 長め: とびついてつかみやすく

  // ── ⑪ そらのテラス: あずまやの旗がゴール ──
  islandBox(12, 8.5, 55, 0, 52.75);                              // x49..61, z48.5..57
  staticBox(0.22, 2.4, 0.22, 53.7, 1.2, 52.6, MAT.wood);         // あずまや
  staticBox(0.22, 2.4, 0.22, 56.3, 1.2, 52.6, MAT.wood);
  staticBox(0.22, 2.4, 0.22, 53.7, 1.2, 55.2, MAT.wood);
  staticBox(0.22, 2.4, 0.22, 56.3, 1.2, 55.2, MAT.wood);
  const gzRoof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.4, 6), MAT.roof);
  gzRoof.position.set(55, 3.1, 53.9);
  gzRoof.castShadow = true;
  levelRoot.add(gzRoof);
  tree(50.4, 55.8, 0, 0.9); tree(59.6, 55, 0, 0.9);
  banner(51.4, 0, 50.5, MAT.red);                                // あずまや島は中間地点になった

  /* ═══ 第4章（延長・北へ→東へL字）: つり橋 → 北の庭 → 動く足場 → 東の島 → ターザン → ゴール
     （place() は使わずワールド座標で組む。北へ→北東かどから東へまがる） ═══ */
  // ⑫ あずまや島（z57）の北へ ゆれるつり橋でわたる
  hangingBridge(55, 0.0, 57.3, 63.3, 2.4, 4, MAT.wood);
  islandBox(13, 11, 55, 0, 69);                                  // 北の庭 x48.5..61.5, z63.5..74.5
  tree(50.2, 66, 0, 1.05); banner(60, 0, 65.5, MAT.blue);
  staticBox(0.55, 0.35, 0.55, 59, 0.17, 72, MAT.gold);           // 花だん（かざり）
  // よじ登り④: 北の庭の石垣（1.45m・こえた先に北がわの庭がつづく）
  staticBox(13, 1.45, 0.5, 55, 0.725, 70.5, MAT.brick);
  staticBox(13.2, 0.12, 0.62, 55, 1.51, 70.5, MAT.plaster);
  // ⑬ 北東かどから 東へ: 動く足場（X方向に往復）で東の島へわたる
  moverBox([3, 0.3, 3], [62, 0.05, 72.5], 'x', 3.5, 0.5, 0, MAT.wood);   // x58.5..65.5
  islandBox(10, 12, 71, 0, 72);                                  // 東の島 x66..76, z66..78
  tree(74, 68, 0, 0.95); banner(67, 0, 69, MAT.red);
  // ⑭ くさりターザンで 東へ大ジャンプ（東の島 → ゴール見晴らし台）
  staticBox(0.5, 7, 0.5, 68.6, 3, 72, MAT.woodDark);
  staticBox(0.5, 7, 0.5, 73.4, 3, 72, MAT.woodDark);
  staticBox(5.2, 0.4, 0.5, 71, 5.8, 72, MAT.woodDark);
  chain({ anchor: [71, 5.6, 72] }, 9, 0.55, { grip: true });
  // ── 見晴らし台: あずまやの旗がゴール（さらに東 x82） ──
  islandBox(12, 10, 82, 0, 72);                                  // x76..88, z67..77
  staticBox(0.22, 2.4, 0.22, 80.7, 1.2, 70.7, MAT.wood);         // あずまや
  staticBox(0.22, 2.4, 0.22, 83.3, 1.2, 70.7, MAT.wood);
  staticBox(0.22, 2.4, 0.22, 80.7, 1.2, 73.3, MAT.wood);
  staticBox(0.22, 2.4, 0.22, 83.3, 1.2, 73.3, MAT.wood);
  const gz2Roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.4, 6), MAT.roof);
  gz2Roof.position.set(82, 3.1, 72);
  gz2Roof.castShadow = true;
  levelRoot.add(gz2Roof);
  tree(78, 75, 0, 0.95); tree(86, 74.5, 0, 0.9);
  goalFlag(82, 0, 72);

  /* ═══ よりみち: テラスのみなみに ほしの小島（ごほうび） ═══ */
  islandBox(2.2, 2.2, 54.2, -0.6, 25.8);                         // とび石
  islandBox(2.2, 2.2, 56.2, -1.1, 22.4);
  islandBox(5.5, 5, 55, -1.2, 18.6);                             // ほしの小島
  goldStar(55, -1.2, 17.6, 1.3);
  staticBox(0.55, 0.35, 0.55, 53.4, -1.05, 18.2, MAT.red);       // 花だん
  staticBox(0.55, 0.35, 0.55, 56.7, -1.05, 19.2, MAT.blue);
  bounceShroom(55.2, -0.9, 20.6, 10);                            // きのこでテラスへもどる

  /* ── ランドマークとかざり ── */
  balloon(30, 14.5, 10, 1.6, MAT.red);                           // 気球（スタートから見える）
  balloon(64, 11.5, 47, 1.1, MAT.blue);
  isletDeco(11, [
    { x0: -30, x1: -16, z0: -6, z1: 50, n: 4 },                  // 西のそら
    { x0: 2, x1: 40, z0: 62, z1: 76, n: 3 },                     // きたのそら
    { x0: 68, x1: 84, z0: 10, z1: 56, n: 3, lo: true },          // ゴールのひがし（ひくめ）
  ]);

  CHECKPOINTS = [
    { x: 0, y: 0.9, z: 0.5 },        // スタート（にわ）
    { x: 0, y: 0.9, z: 16.5 },       // 部屋B
    { x: 0, y: 0.9, z: 27.5 },       // 部屋C
    { x: 3, y: 2.9, z: 34.5 },       // ロフト
    { x: 9.1, y: 0.9, z: 38 },       // うらにわ（すべり台のさき）
    { x: 25.8, y: 0.9, z: 38 },      // いけがきの門のさき（分かれ道）
    { x: 35.4, y: 0.9, z: 31.6 },    // 果樹園（みなみルート）
    { x: 51.4, y: 0.9, z: 38 },      // ごうりゅうのテラス
    { x: 55, y: 0.9, z: 50.5 },      // あずまや島（中間地点）
    { x: 55, y: 0.9, z: 68 },        // 北の庭
    { x: 71, y: 0.9, z: 72 },        // 東の島（ターザンのまえ）
  ];
  CP_ZONES = [
    { cp: 1, x0: -5, x1: 5, z0: 15.2, z1: 18, yMin: -0.5 },
    { cp: 2, x0: -5, x1: 5, z0: 26.2, z1: 29, yMin: -0.5 },
    { cp: 3, x0: 0.5, x1: 5.3, z0: 31, z1: 36, yMin: 1.6 },
    { cp: 4, x0: 7.1, x1: 11.1, z0: 30, z1: 46, yMin: -0.5 },    // うらにわ
    { cp: 5, x0: 25, x1: 26.6, z0: 35.5, z1: 40.5, yMin: -0.5 }, // 門のさき
    { cp: 6, x0: 33.8, x1: 36.8, z0: 24.6, z1: 38.6, yMin: -0.5 },  // 果樹園（ルートA）
    { cp: 6, x0: 37.4, x1: 41.8, z0: 42.2, z1: 46.6, yMin: -1.0 },  // きのこの休けい島（ルートB）
    { cp: 7, x0: 49.8, x1: 53.2, z0: 29, z1: 47, yMin: -0.5 },   // テラス（ごうりゅう）
    { cp: 8, x0: 50, x1: 60, z0: 48.6, z1: 56.5, yMin: -0.5 },   // あずまや島（中間地点）
    { cp: 9, x0: 49, x1: 61, z0: 63.5, z1: 74.5, yMin: -0.5 },   // 北の庭
    { cp: 10, x0: 66, x1: 76, z0: 66, z1: 78, yMin: -0.5 },      // 東の島
  ];
  GOAL = { x0: 76, x1: 88, z0: 67, y: -0.6 };
}

/* =====================================================================
   コース2「こうじげんば」— 工事現場・解体（8分規模・箱庭化）
   まんなかの大タワークレーンのまわりを らせん（北→東→南→西）にのぼる。
   リフト → 鉄球スイング → こわせるかべ → ウィンチ/空中の梁 → てっぺんへ
   ===================================================================== */
function buildCourse2() {
  /* ═══ 第1章（北へ）: ヤード → リフト → デッキ1 ═══ */
  // ── スタートのヤード（コンクリの浮き島） ──
  islandBox(13, 14, 0, 0, 1, MAT.concrete);        // z -6..8
  trafficCone(1.6, 6.4); trafficCone(-2.2, 7.0); trafficCone(4.2, -2.5); trafficCone(-4.5, 2);
  staticBox(1.8, 0.9, 1.2, -4.6, 0.45, -2.5, MAT.brick);   // レンガのパレット（かざり）
  staticBox(2.6, 0.18, 0.8, 4.2, 0.09, 3.2, MAT.hazard);   // 黄色いしま板

  // ── ① 貨物リフト: レバーの角度で上下（z8..12のすきまをわたる） ──
  const liftLever = gimLever(2.4, 0.85, 7.2, -0.45);
  const liftMesh = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.25, 2.6), MAT.hazard);
  const liftIdx = kinObject(liftMesh, 'box', [2.6, 0.25, 2.6], [0, -0.125, 10]);
  GIM.lifts.push({ leverIdx: liftLever, liftIdx, y0: -0.125, y1: 2.875, target: -0.125, speed: 1.2 });
  // リフトのやぐら（かざり）
  staticBox(0.3, 12, 0.3, -1.65, 2, 10, MAT.orange);
  staticBox(0.3, 12, 0.3, 1.65, 2, 10, MAT.orange);
  staticBox(3.6, 0.3, 0.3, 0, 8.1, 10, MAT.orange);
  // 力技ルート: 足場ブロックとび（0.9きざみ）
  staticBox(1.4, 0.25, 1.4, -4.6, 0.78, 9.0, MAT.iron);
  staticBox(1.4, 0.25, 1.4, -4.6, 1.68, 10.6, MAT.iron);
  staticBox(1.4, 0.25, 1.4, -4.6, 2.58, 12.2, MAT.iron);

  // ── デッキ1（y3.0, z12..26）: 鉄骨のうえのコンクリ床 ──
  staticBox(7, 0.4, 14, 0, 2.8, 19, MAT.concrete);
  for (const [cx, cz] of [[-3, 13], [3, 13], [-3, 25], [3, 25]]) {
    staticBox(0.45, 7, 0.45, cx, -0.9, cz, MAT.ironDark);        // 柱（虚空へのびる）
  }
  staticBox(7.3, 0.28, 0.28, 0, 3.15, 12.2, MAT.hazard);          // ふちの黄しま
  trafficCone(2.6, 15, 3.0); trafficCone(-2.7, 23.2, 3.0);
  staticBox(0.5, 0.55, 3.2, -3.1, 3.28, 17, MAT.orange);          // よこづみの鉄骨（かざり）
  // よじ登り①: 資材コンテナのかべ（1.5m・デッキのはば全体）
  staticBox(3.5, 1.5, 2.4, -1.75, 3.75, 21, MAT.orange);
  staticBox(3.5, 1.5, 2.4, 1.75, 3.75, 21, MAT.blue);

  /* ═══ 第2章（東へまがる）: 鉄球 → デッキ2 → こわせるかべ → ウィンチ → 屋上 ═══ */
  place(-22.5, 24, 1);
  // ── ② 鉄球（レッキングボール）: くさりにとびついてスイング（デッキ1の東のすきま） ──
  staticBox(0.55, 12, 0.55, 3.9, 2.5, 28.25, MAT.hazard);         // クレーンのマスト
  staticBox(8.4, 0.4, 0.55, 0, 8.6, 28.25, MAT.hazard);           // クレーンのうで
  chain({ anchor: [0, 8.4, 28.25] }, 7, 0.6, { ball: { r: 0.6, mass: 14, mat: MAT.iron } });
  staticBox(0.42, 0.25, 5.6, 2.9, 2.875, 28.25, MAT.orange);      // 正攻法: 細い鉄骨のはり渡り

  // ── デッキ2（y3.0・東うで） ──
  staticBox(7, 0.4, 10.7, 0, 2.8, 35.85, MAT.concrete);
  for (const [cx, cz] of [[-3, 31.5], [3, 31.5], [-3, 40.5], [3, 40.5]]) {
    staticBox(0.45, 7, 0.45, cx, -0.9, cz, MAT.ironDark);
  }

  // ── ③ こわせるかべ: 鉄球や木箱をぶつけてくずす ──
  GIM.breakables.push({ hit: false, announced: false });
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const off = row % 2 ? 0.42 : 0;
      dynBox(1.62, 0.6, 0.4, -2.55 + col * 1.7 + off, 3.31 + row * 0.62, 36.2, MAT.brick, 7, { breakGroup: 0 });
    }
  }
  dynBox(0.7, 0.7, 0.7, 2.5, 3.6, 33.5, MAT.crate, 12, { noSleep: true });           // 投げる/ぶつける用の木箱
  dynBox(0.7, 0.7, 0.7, -2.5, 3.6, 34.2, MAT.crate, 12, { noSleep: true });

  // ── ④ ウィンチ: ハンドル（ヒンジ）の角度でゴンドラがゆっくり上下（乗って移動できる） ──
  const winchLever = gimLever(1.8, 3.85, 40.4, -0.45, { baseY: 3.0 });
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.25, 2.3), MAT.hazard);
  const gondolaIdx = kinObject(gondola, 'box', [2.3, 0.25, 2.3], [0, 2.875, 42.4]);
  GIM.lifts.push({ leverIdx: winchLever, liftIdx: gondolaIdx, y0: 2.875, y1: 6.175, target: 2.875, speed: 0.5 });
  addRod(tpos(0, 8.6, 42.4), gondolaIdx, 0.04, MAT.ironDark);      // つりワイヤー（見た目）
  staticBox(0.35, 6, 0.35, -1.5, 5.6, 42.4, MAT.ironDark);
  staticBox(0.35, 6, 0.35, 1.5, 5.6, 42.4, MAT.ironDark);
  staticBox(3.4, 0.3, 0.35, 0, 8.75, 42.4, MAT.ironDark);

  // ── ⑤ 鉄骨のはり: とびうつってのぼる（ひとりでも上がれる正攻法・きた側） ──
  staticBox(1.3, 0.28, 1.0, -4.6, 3.9, 41.4, MAT.orange);
  staticBox(1.3, 0.28, 1.0, -4.6, 4.8, 42.6, MAT.orange);
  staticBox(1.3, 0.28, 1.0, -4.6, 5.7, 43.8, MAT.orange);

  // ── ビルの屋上（y6.3・北東かど）: ここがふたまたの分かれ道 ──
  staticBox(7, 0.4, 6.8, 0, 6.1, 47.1, MAT.concrete);
  for (const [cx, cz] of [[-3, 44.5], [3, 44.5], [-3, 50], [3, 50]]) {
    staticBox(0.45, 13.4, 0.45, cx, -0.4, cz, MAT.ironDark);
  }
  staticBox(7.3, 0.28, 0.28, 0, 6.45, 43.85, MAT.hazard);
  trafficCone(2.4, 48.5, 6.3); trafficCone(-2.5, 45.5, 6.3);
  // みかんせいの鉄骨フレーム（かざり）
  staticBox(0.4, 4, 0.4, -3, 8.3, 50, MAT.orange);
  staticBox(0.4, 4, 0.4, 3, 8.3, 50, MAT.orange);
  staticBox(6.4, 0.35, 0.4, 0, 10.3, 50, MAT.orange);

  /* ═══ 第3章A（南へまがる・正面ルート）: バランス梁 → 回転床 → おもりエレベーター ═══ */
  place(24.6, 71, 2);
  // ── ⑥ せまい梁のバランス渡り＋回転する床（y6.3） ──
  staticBox(0.5, 0.25, 6.4, -1.2, 6.175, 53.7, MAT.orange);      // せまい梁A
  spinnerDisc(0, 6.3, 58.7, 1.9, 0.65);                          // 回転する床1
  staticBox(0.5, 0.25, 6.4, 1.2, 6.175, 63.9, MAT.orange);       // せまい梁B
  spinnerDisc(0, 6.3, 68.9, 1.9, -0.75);                         // 回転する床2（ぎゃく回転）
  staticBox(5.5, 0.4, 4, 0, 6.1, 73, MAT.concrete);              // 休けいデッキ
  staticBox(0.45, 13, 0.45, -2.4, 0, 73, MAT.ironDark);
  staticBox(0.45, 13, 0.45, 2.4, 0, 73, MAT.ironDark);
  trafficCone(-2.1, 72, 6.3);

  // ── ⑦ おもりエレベーター: かごに木箱をつむと リフトがあがる ──
  const balMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 2.4), MAT.hazard);
  const balIdx = kinObject(balMesh, 'box', [2.4, 0.25, 2.4], [0, 6.175, 76.2]);
  const balZone = tpos(3.3, 0, 73.4);
  GIM.balances.push({ liftIdx: balIdx, zone: [balZone[0], balZone[2]], rx: 1.05, rz: 1.05, yMin: 6.0, yMax: 8.2, needMass: 25, y0: 6.175, y1: 10.075 });
  staticBox(1.7, 0.22, 1.7, 3.3, 6.19, 73.4, MAT.ironDark);      // おもりのかご
  staticBox(1.7, 0.3, 0.08, 3.3, 6.45, 72.55, MAT.ironDark);
  staticBox(1.7, 0.3, 0.08, 3.3, 6.45, 74.25, MAT.ironDark);
  staticBox(0.08, 0.3, 1.7, 2.45, 6.45, 73.4, MAT.ironDark);
  staticBox(0.08, 0.3, 1.7, 4.15, 6.45, 73.4, MAT.ironDark);
  dynBox(0.7, 0.7, 0.7, -1.7, 6.9, 72.3, MAT.crate, 15, { noSleep: true });   // おもり用の木箱
  dynBox(0.7, 0.7, 0.7, -2.3, 6.9, 73.8, MAT.crate, 15, { noSleep: true });
  staticBox(0.35, 6.5, 0.35, -1.4, 9.4, 76.2, MAT.orange);       // やぐら
  staticBox(0.35, 6.5, 0.35, 1.4, 9.4, 76.2, MAT.orange);
  staticBox(3.2, 0.3, 0.35, 0, 12.5, 76.2, MAT.orange);
  addRod(tpos(0, 12.35, 76.2), balIdx, 0.04, MAT.ironDark);
  // 力技ルート: 鉄骨ステップ（0.9きざみ）
  staticBox(1.3, 0.28, 1.0, -3.6, 7.2, 74.8, MAT.orange);
  staticBox(1.3, 0.28, 1.0, -3.6, 8.15, 76.0, MAT.orange);
  staticBox(1.3, 0.28, 1.0, -3.6, 9.1, 77.2, MAT.orange);
  staticBox(1.3, 0.28, 1.0, -3.6, 10.0, 78.4, MAT.orange);

  // ── 高層の鉄骨フロア（y10.2・りょうルートの合流） ──
  staticBox(7, 0.4, 10, 0, 10.0, 82.6, MAT.concrete);
  staticBox(0.45, 21, 0.45, -3, -0.2, 78.5, MAT.ironDark);
  staticBox(0.45, 21, 0.45, 3, -0.2, 78.5, MAT.ironDark);
  staticBox(0.45, 21, 0.45, -3, -0.2, 86.5, MAT.ironDark);
  staticBox(0.45, 21, 0.45, 3, -0.2, 86.5, MAT.ironDark);
  trafficCone(2.6, 80, 10.2);
  staticBox(0.5, 0.5, 3.0, 3.0, 10.45, 80, MAT.orange);          // よこづみの鉄骨（かざり）
  // よじ登り②: 高層フロアのコンテナごえ（1.5m・合流のさき）
  staticBox(3.5, 1.5, 2.4, -1.75, 10.95, 83.4, MAT.blue);
  staticBox(3.5, 1.5, 2.4, 1.75, 10.95, 83.4, MAT.orange);

  /* ═══ 第3章B（近道ルート・ワールド座標): 屋上のコンテナをよじのぼり
         空中の細い梁づたいに高層フロアへ（すきまとびが2回） ═══ */
  place(0, 0, 0);
  staticBox(2.4, 1.5, 2.4, 26.4, 7.05, 25.9, MAT.blue);          // よじ登りコンテナ1（→7.8）
  staticBox(2.4, 1.5, 2.4, 26.4, 8.55, 23.4, MAT.orange);        // よじ登りコンテナ2（→9.3）
  trafficCone(25.4, 26.6, 6.3);
  banner(27.4, 6.3, 26.6, MAT.orange);                           // 分かれ道のめじるし
  staticBox(2.2, 0.3, 2.2, 29.4, 9.75, 23.2, MAT.orange);        // はりのスタート台
  staticBox(0.55, 0.28, 9.6, 29.8, 9.76, 17.2, MAT.orange);      // 空中の梁1（z12.4..22）
  staticBox(0.55, 0.28, 9.4, 29.8, 9.76, 6.1, MAT.orange);       // 梁2（z1.4..10.8・すきま1.6）
  staticBox(0.55, 0.28, 8.6, 29.8, 9.76, -4.4, MAT.orange);      // 梁3（z-8.7..-0.1・すきま1.5）
  staticBox(1.8, 0.25, 1.8, 28.6, 10.05, -7.6, MAT.orange);      // 高層フロアへの合流パッド

  /* ═══ よりみち: 休けいデッキの東 おやつのだい（ごほうび） ═══ */
  staticBox(4.4, 0.22, 0.5, 29.5, 6.19, -2.6, MAT.orange);       // ほそい梁
  staticBox(3, 0.35, 3, 33.2, 6.12, -2.6, MAT.concrete);         // おやつのだい
  goldStar(33.2, 6.3, -3.3, 1.0);
  staticBox(0.8, 0.75, 0.8, 34, 6.67, -1.8, MAT.red);            // じはんき（かざり）
  trafficCone(32.2, -1.6, 6.3);

  /* ═══ 第4章（西へまがる）: ゆれる鉄骨 → うごく足場 → ゴールの最上階 ═══ */
  place(108.7, -13, 3);
  // ── ⑧ ゆれる鉄骨をよけながら せまい梁をわたる ──
  staticBox(0.5, 0.25, 6.2, 0, 10.07, 90.7, MAT.orange);         // せまい梁
  const swingIdx = moverBox([3.6, 0.5, 0.8], [0, 10.75, 90.7], 'x', 2.6, 0.85, 0, MAT.ironDark);
  addRod(tpos(0, 16, 90.7), swingIdx, 0.05, MAT.ironDark);       // つりワイヤー（見た目）
  staticBox(8, 0.4, 0.5, 0, 16.1, 90.7, MAT.hazard);             // うえのクレーン梁
  staticBox(7, 0.4, 5.8, 0, 10.0, 96.7, MAT.concrete);           // 着地フロア
  staticBox(0.45, 21, 0.45, -3, -0.2, 94.8, MAT.ironDark);
  staticBox(0.45, 21, 0.45, 3, -0.2, 98.6, MAT.ironDark);

  // ── ⑨ うごく足場で大ギャップをわたる ──
  moverBox([3, 0.3, 3], [0, 10.05, 104.5], 'z', 3.3, 0.45, 0, MAT.hazard);

  // ── ゴールの最上階 ──
  staticBox(7, 0.4, 6, 0, 10.0, 112.4, MAT.concrete);
  staticBox(0.45, 22, 0.45, -3, -0.6, 110.4, MAT.ironDark);
  staticBox(0.45, 22, 0.45, 3, -0.6, 110.4, MAT.ironDark);
  staticBox(0.45, 22, 0.45, -3, -0.6, 114.4, MAT.ironDark);
  staticBox(0.45, 22, 0.45, 3, -0.6, 114.4, MAT.ironDark);
  staticBox(0.4, 4, 0.4, -3, 12.3, 114.5, MAT.orange);
  staticBox(0.4, 4, 0.4, 3, 12.3, 114.5, MAT.orange);
  staticBox(6.4, 0.35, 0.4, 0, 14.3, 114.5, MAT.orange);
  trafficCone(-2.4, 111, 10.2);
  // よじ登り③: 最上階の高台（1.5m・フロアはばいっぱい）。ここは中間地点になった
  staticBox(7, 1.5, 6, 0, 10.95, 113.4, MAT.concrete);
  banner(0, 11.7, 113.4, MAT.hazard);

  /* ═══ 第5章（延長・北へ→西へL字）: 中継フロア → よじ登りコンテナ → 動く足場 →
     さらに高いゴールの塔（place は使わずワールド座標。高台 world(-4.7,z-13) の北へつづく） ═══ */
  place(0, 0, 0);
  // ⑩ 高台のきたへ 中継フロアAへおりる
  staticBox(5, 0.4, 5, -4.7, 10.0, -20, MAT.concrete);          // フロアA world z-22.5..-17.5
  staticBox(0.45, 22, 0.45, -6.6, -0.5, -18.5, MAT.ironDark);
  staticBox(0.45, 22, 0.45, -6.6, -0.5, -21.5, MAT.ironDark);
  trafficCone(-3, -18.5, 10.0);
  // よじ登り④: 資材コンテナのかべ（1.5m・フロアはばいっぱい＝フロアA→フロアB）
  staticBox(5, 1.5, 0.6, -4.7, 10.95, -22.3, MAT.blue);
  staticBox(5, 0.4, 4, -4.7, 10.0, -24.5, MAT.concrete);        // フロアB world z-26.5..-22.5
  staticBox(0.45, 22, 0.45, -6.6, -0.5, -25.5, MAT.ironDark);
  staticBox(0.5, 0.5, 3, -3.0, 10.45, -24.5, MAT.orange);       // よこづみ鉄骨（かざり）
  // ⑪ 西へまがる: うごく足場（world -x）でゴールの塔へわたる
  moverBox([3, 0.3, 3], [-10, 10.05, -24.5], 'x', 2.8, 0.5, 0, MAT.hazard);   // x-12.8..-7.2
  // ── ゴールの塔屋上（world x-16・らせんの一番たかいところ） ──
  staticBox(6.5, 0.4, 6, -16, 10.0, -24.5, MAT.concrete);
  staticBox(0.45, 22, 0.45, -18.5, -0.5, -22.5, MAT.ironDark);
  staticBox(0.45, 22, 0.45, -18.5, -0.5, -26.5, MAT.ironDark);
  staticBox(0.45, 22, 0.45, -13.5, -0.5, -22.5, MAT.ironDark);
  staticBox(0.45, 22, 0.45, -13.5, -0.5, -26.5, MAT.ironDark);
  staticBox(0.4, 4, 0.4, -18.5, 12.3, -26.6, MAT.orange);
  staticBox(0.4, 4, 0.4, -13.5, 12.3, -26.6, MAT.orange);
  staticBox(5.4, 0.35, 0.4, -16, 14.3, -26.6, MAT.orange);
  trafficCone(-14, -23, 10.0);
  goalFlag(-16, 10.0, -24.5);
  // よりみち: ゴールの塔の北 ほしのだい（ごほうび）
  staticBox(3.5, 0.22, 0.5, -16, 10.19, -28.6, MAT.orange);     // ほそい梁
  staticBox(3, 0.35, 3, -16, 10.12, -31, MAT.concrete);
  goldStar(-16, 10.3, -31.7, 1.0);

  /* ═══ ランドマーク: らせんのまんなかにそびえる 大タワークレーン（かざり） ═══ */
  place(0, 0, 0);
  {
    const g = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.15, 26, 1.15), MAT.hazard);
    mast.position.y = 10;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 1.7), MAT.orange);
    cab.position.y = 22.6;
    const jib = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 19), MAT.orange);
    jib.position.set(0, 23.6, 7.5);
    const cjib = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 5.5), MAT.orange);
    cjib.position.set(0, 23.6, -4.2);
    const weight = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.6, 1.4), MAT.concrete);
    weight.position.set(0, 22.6, -6.2);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 9, 4), MAT.ironDark);
    cable.position.set(0, 18.7, 15.5);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.8), MAT.ironDark);
    hook.position.set(0, 13.8, 15.5);
    for (const m of [mast, cab, jib, cjib, weight, cable, hook]) { m.castShadow = true; g.add(m); }
    g.position.set(12.5, -3, 1);
    g.rotation.y = 0.85;
    levelRoot.add(g);
  }
  isletDeco(22, [
    { x0: -32, x1: -18, z0: -12, z1: 30, n: 3, lo: true },       // 西のそら（ひくめ）
    { x0: 38, x1: 52, z0: -18, z1: 28, n: 3 },                   // 東のそら
    { x0: 4, x1: 30, z0: 34, z1: 46, n: 3, lo: true },           // 北のそら（ひくめ）
  ]);

  CHECKPOINTS = [
    { x: 0, y: 0.9, z: 0.5 },       // ヤード
    { x: 0, y: 3.9, z: 14 },        // デッキ1
    { x: 9.5, y: 3.9, z: 24 },      // デッキ2（東うで）
    { x: 22.5, y: 7.2, z: 24 },     // 屋上（分かれ道）
    { x: 24.6, y: 7.2, z: -1.8 },   // 休けいデッキ（南うで）
    { x: 24.6, y: 11.1, z: -8.5 },  // 高層フロア（合流）
    { x: 13.5, y: 11.1, z: -13 },   // ゆれる鉄骨のあと（西うで）
    { x: -1.6, y: 11.1, z: -13 },   // 最上階（中間地点）
    { x: -4.7, y: 10.6, z: -20 },   // 中継フロアA
    { x: -4.7, y: 10.6, z: -24.5 }, // 中継フロアB
  ];
  CP_ZONES = [
    { cp: 1, x0: -3.5, x1: 3.5, z0: 12, z1: 16, yMin: 2.5 },
    { cp: 2, x0: 8, x1: 11.5, z0: 20.5, z1: 27.5, yMin: 2.5 },     // デッキ2
    { cp: 3, x0: 21.2, x1: 23.5, z0: 20.5, z1: 27.5, yMin: 5.8 },  // 屋上
    { cp: 4, x0: 21.85, x1: 27.35, z0: -4, z1: 0, yMin: 5.8 },     // 休けいデッキ（ルートA）
    { cp: 4, x0: 28.9, x1: 30.7, z0: 1.4, z1: 10.8, yMin: 9.3 },   // 空中の梁2（ルートB）
    { cp: 5, x0: 21.1, x1: 28.1, z0: -10, z1: -6.6, yMin: 9.7 },   // 高層フロア（合流）
    { cp: 6, x0: 9.1, x1: 14.9, z0: -16.5, z1: -9.5, yMin: 9.7 },  // ゆれる鉄骨のあと
    { cp: 7, x0: -6.7, x1: -0.7, z0: -16.5, z1: -9.5, yMin: 9.7 }, // 最上階（中間地点）
    { cp: 8, x0: -7.2, x1: -2.2, z0: -22.5, z1: -17.5, yMin: 9.5 },// 中継フロアA
    { cp: 9, x0: -7.2, x1: -2.2, z0: -26.5, z1: -22.5, yMin: 9.5 },// 中継フロアB
  ];
  GOAL = { x0: -19.5, x1: -13.2, z0: -28, y: 10.0 };
}

/* =====================================================================
   コース3「ゆめのおしろ」— 中世の城（10分規模・箱庭化）
   まんなかにうかぶ古い天守をかこんで 北→東→南とまわる回遊コース。
   くさり→カタパルト→はねばし→塔→（分岐: 空中さんどう/すいどうばし）
   →ターザン→つり橋→べっかん→はねばし2→大聖塔の旗へ
   ===================================================================== */
function buildCourse3() {
  // ── スタートの草原島 ──
  islandBox(13, 14, 0, 0, 1, MAT.grass);           // z -6..8
  banner(-3, 0, -2.5, MAT.red); banner(3, 0, -2.5, MAT.blue);
  tree(-5, -3, 0, 1.0); tree(5.2, -1.5, 0, 0.85);
  staticBox(1.6, 0.3, 1.2, 0, 0.15, 7.3, MAT.stone);              // ふみ切り台

  // ── ① くさりぶら下がりで堀1（z8..13）をわたる ──
  staticBox(0.6, 10, 0.6, -3.0, 1.0, 10.5, MAT.stoneDark);        // 石の柱（虚空から）
  staticBox(0.6, 10, 0.6, 3.0, 1.0, 10.5, MAT.stoneDark);
  staticBox(6.8, 0.45, 0.6, 0, 6.2, 10.5, MAT.woodDark);          // はり
  chain({ anchor: [0, 6.0, 10.5] }, 8, 0.55, { grip: true });
  // 力技ルート: とび石
  islandBox(1.3, 1.3, -4.7, 0, 9.4); islandBox(1.3, 1.3, -4.7, 0, 11); islandBox(1.3, 1.3, -4.7, 0, 12.6);

  // ── 前庭（z13..27） ──
  islandBox(16, 14, 0, 0, 20, MAT.grass);
  tree(6.6, 14.5, 0, 1.0); banner(6.8, 0, 19, MAT.red);
  // よじ登り①: くずれた城壁あと（1.5m・島のはば全体）
  staticBox(16, 1.5, 0.9, 0, 0.75, 17.5, MAT.stoneDark);
  staticBox(1.1, 0.45, 0.75, -5.2, 1.72, 17.5, MAT.stone);       // くずれのこり
  staticBox(1.8, 0.3, 0.75, 3.4, 1.65, 17.5, MAT.stone);
  staticBox(0.9, 0.4, 0.9, 1.2, 0.2, 18.6, MAT.stone);           // くずれた石（かざり）

  // ── ② カタパルト: おもりをのせると発射！じぶんをはねばしへ飛ばす ──
  staticBox(0.4, 1.3, 0.4, -3.3, 0.65, 21, MAT.woodDark);         // 台
  staticBox(0.4, 1.3, 0.4, -1.7, 0.65, 21, MAT.woodDark);
  const armIdx = hingedBox(1.05, 0.14, 3.8, MAT.woodDark, 6, [-2.5, 1.2, 21], [0, 0, 0], [1, 0, 0], -0.48,
    { angularDamping: 0.4, motorForce: 90 });
  {  // かごのふち（うでの見た目の子メッシュ）
    const armMesh = dynObjects[armIdx].mesh;
    for (const [lx, lz, w, d] of [[0, -1.82, 1.1, 0.12], [-0.52, -1.5, 0.12, 0.7], [0.52, -1.5, 0.12, 0.7]]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), MAT.woodDark);
      rim.position.set(lx, 0.2, lz);
      armMesh.add(rim);
    }
  }
  // 岩のおもり（ころがして うでの先へおとす）
  const rock = (x, y, z) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), MAT.stoneDark);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    levelRoot.add(m);
    dynObjects.push({ mesh: m, kind: 'sphere', radius: 0.42, mass: 30, noSleep: true, home: { p: [x, y, z] }, body: null });
    return dynObjects.length - 1;
  };
  const w1 = rock(-2.9, 2.9, 23.7);
  const w2 = rock(-2.1, 2.9, 23.7);
  GIM.catapults.push({
    idx: armIdx, rest: -0.48, weights: [w1, w2],
    pad: [-2.5, 2.1, 22.85], basket: [-2.5, 0.35, 19.2], vel: [1.5, 11.2, 6.4],
    readyAt: 0, fireAt: 0, launched: false,
  });
  // おもりのたな（うしろから階段でのぼって、まえ＝うでの先へころがしおとす）
  staticBox(2.4, 0.3, 1.8, -2.5, 2.3, 23.8, MAT.woodDark);
  staticBox(2.4, 0.24, 0.1, -2.5, 2.57, 24.65, MAT.woodDark);    // うしろのふち
  staticBox(0.1, 0.24, 1.8, -3.65, 2.57, 23.8, MAT.woodDark);    // よこのふち
  staticBox(0.1, 0.24, 1.8, -1.35, 2.57, 23.8, MAT.woodDark);
  staticBox(0.35, 2.2, 0.35, -3.5, 1.1, 24.5, MAT.woodDark);
  staticBox(0.35, 2.2, 0.35, -1.5, 1.1, 24.5, MAT.woodDark);
  stairs(4, 0.55, 0.5, 2.2, MAT.woodDark, -2.5, 0, 26.6, 'z', -1);

  // ── ③ はねばし（z27..31.4の堀2）: くさりをつかんで体重でひきおろす ──
  islandBox(1.4, 1.4, 0.9, 0, 29.3);                              // 堀の中のとび石（くさりのま下ちかく）
  const bridgeIdx = hingedBox(3.2, 0.2, 4.4, MAT.woodDark, 5, [0, 0.12, 31.4], [0, 0, 2.2], [1, 0, 0], 1.22,
    { angularDamping: 0.5, motorForce: 60 });
  const bridgeChain = chain({ idx: bridgeIdx, local: [0, 0, -2.15] }, 5, 0.45, { grip: true, noStatic: true });
  GIM.drawbridges.push({ idx: bridgeIdx, upAngle: 1.22, grabIdxs: [...bridgeChain, bridgeIdx], open: false });

  // ── おしろの島（z31.4..58.4） ──
  islandBox(20, 27, 0, 0, 44.9, MAT.grass);
  // 城門のかべ（z31.4・とびら穴つき）と 見張り塔
  wallZ(31.4, -9.6, 9.6, 0, 6, MAT.stone, [{ x0: -1.7, x1: 1.7, y0: 0, y1: 3.9 }], 0.9);
  crenels(-5.6, 6.27, 31.4, 7.2, 'x'); crenels(5.6, 6.27, 31.4, 7.2, 'x');
  for (const tx of [-2.9, 2.9]) {
    staticBox(2.2, 8, 2.2, tx, 4, 31.4, MAT.stone);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.0, 6), MAT.roof);
    cone.position.set(tx, 9, 31.4);
    cone.castShadow = true;
    levelRoot.add(cone);
    banner(tx, 8, 30.2, MAT.red);
  }
  // 中庭のまわりのかべ
  wallX(-9.6, 31.4, 52, 0, 5, MAT.stone, [], 0.8);
  wallX(9.6, 31.4, 52, 0, 5, MAT.stone, [], 0.8);
  wallZ(58, -9.6, 9.6, 0, 5, MAT.stone, [], 0.8);
  // 中庭のかざり: いど・木箱・木
  staticBox(1.6, 0.85, 1.6, 5, 0.42, 44, MAT.stone);
  const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.0, 4), MAT.roof);
  wellRoof.position.set(5, 2.1, 44); wellRoof.rotation.y = Math.PI / 4; wellRoof.castShadow = true;
  levelRoot.add(wellRoof);
  tree(-5, 34.5, 0, 1.0); tree(7.5, 34.5, 0, 0.9);
  dynBox(0.72, 0.72, 0.72, 4, 0.55, 40, MAT.crate, 12, { noSleep: true });
  dynBox(0.72, 0.72, 0.72, 4.9, 0.55, 41, MAT.crate, 12, { noSleep: true });

  // ── ④ 塔への道: 正攻法（階段→城壁の通路→わたり廊下）＋力技（正面のかべのぼり） ──
  stairs(10, 0.42, 0.55, 2.2, MAT.stone, -7.6, 0, 40, 'z', 1);    // 中庭 → 城壁上（y4.2）
  staticBox(3.4, 0.35, 6.5, -7.4, 4.03, 48.75, MAT.stone);        // 城壁の通路（上面4.2）
  crenels(-9.0, 4.47, 48.75, 6.5, 'z');
  staticBox(2.6, 0.3, 1.4, -5.1, 4.05, 52.4, MAT.stone);          // わたり石だたみ
  staticBox(1.5, 0.3, 3.2, -3.8, 4.05, 53.6, MAT.stone);          // 塔のバルコニー
  // 塔（そびえる本体）と、外がわの浮き階段
  staticBox(6, 7.2, 6, 0, 3.6, 55, MAT.stone);
  stairs(4, 0.7, 0.75, 1.3, MAT.stone, -3.45, 4.2, 55.2, 'z', 1); // バルコニー → 塔のかど（y7.0）
  staticBox(1.3, 0.24, 1.0, -2.2, 7.08, 58.4, MAT.stone);         // かどの足場 → 屋上へ
  // 力技: 正面（z52がわ）のよじのぼりレッジ
  for (let i = 0; i < 7; i++) {
    staticBox(1.5, 0.14, 0.34, i % 2 ? 1.15 : -1.15, 0.9 * (i + 1), 51.83, MAT.stoneDark);
  }
  crenels(0, 7.47, 52.15, 5.6, 'x');                              // 塔の屋上のふち
  crenels(0, 7.47, 57.85, 5.6, 'x');
  crenels(-2.85, 7.47, 55, 5.6, 'z');
  crenels(2.85, 7.47, 52.7, 1.4, 'z');   // ひがしのふちは まんなかをあけて ルートAの出口に
  crenels(2.85, 7.47, 57.3, 1.4, 'z');

  banner(-2.2, 7.2, 53.4, MAT.red); banner(2.2, 7.2, 53.4, MAT.blue);   // 塔1は中間地点

  /* ここが分かれ道: 塔1のうえから ひがしへ2ルート（あか=うき石の空中さんどう / あお=すいどうばし） */
  staticBox(2.2, 0.24, 1.7, 5.1, 6.73, 55, MAT.stone);            // ルートA: うき石レッジ（ひろめ）
  staticBox(1.5, 0.24, 1.5, 7.9, 6.58, 55, MAT.stone);
  banner(5.4, 6.85, 54.0, MAT.red);
  staticBox(2.0, 0.25, 2.0, 2.2, 6.9, 59.6, MAT.stone);           // ルートB: きたのパッド
  banner(1.1, 7.03, 60.3, MAT.blue);

  /* ═══ 第2章（ひがしへまがる）: 空中さんどう/すいどうばし → ターザン → つり橋 → べっかん ═══ */
  place(-50, 55, 1);
  // ── ⑤A ルートA: 柱とびの空中さんどうで下りていく ──
  const pillar = (x, top, z) => {
    staticBox(1.7, 0.4, 1.7, x, top - 0.2, z, MAT.stone);
    staticBox(0.75, 9, 0.75, x, top - 4.9, z, MAT.stoneDark);
  };
  pillar(0, 6.7, 60.8);
  pillar(1.4, 6.1, 63.4);
  pillar(-1.2, 5.5, 66);
  pillar(0.6, 4.9, 68.4);
  staticBox(4, 0.4, 6, 0, 4.4, 73.0, MAT.stone);                 // 列柱ろうか1（上面4.6）
  staticBox(0.75, 9, 0.75, -1.4, 0, 73.0, MAT.stoneDark);
  staticBox(0.75, 9, 0.75, 1.4, 0, 73.0, MAT.stoneDark);
  crenels(-1.85, 4.87, 73.0, 5.6, 'z'); crenels(1.85, 4.87, 73.0, 5.6, 'z');

  // ── ⑥ くさりターザンで大堀をわたる（ルートAのやま場） ──
  staticBox(1.6, 0.3, 1.2, 0, 5.2, 75.7, MAT.stone);             // ふみ切り台（たかめ: とびついてつかむ）
  staticBox(0.6, 14, 0.6, -2.6, 4, 78.9, MAT.stoneDark);
  staticBox(0.6, 14, 0.6, 2.6, 4, 78.9, MAT.stoneDark);
  staticBox(5.6, 0.45, 0.6, 0, 10.8, 78.9, MAT.woodDark);
  chain({ anchor: [0, 10.6, 78.9] }, 10, 0.55, { grip: true });   // 長め: とびついてつかみやすく
  staticBox(4, 0.4, 5, 0, 4.4, 82.9, MAT.stone);                 // 列柱ろうか2（ごうりゅう・ひろめ）
  staticBox(0.75, 9, 0.75, 0, 0, 82.9, MAT.stoneDark);

  // ── ⑤B ルートB: すいどうばし（アーチの石橋）。すきまとび2回で ろうか2へ ──
  const aqSpan = (zc, len, top) => {
    staticBox(2.0, 0.55, len, -6, top - 0.275, zc, MAT.stone);
    crenels(-6.82, top, zc, len - 0.6, 'z');                     // きたがわの手すり
    staticBox(0.85, 8, 0.85, -6, top - 4.55, zc - len / 2 + 0.7, MAT.stoneDark);
    staticBox(0.85, 8, 0.85, -6, top - 4.55, zc + len / 2 - 0.7, MAT.stoneDark);
  };
  aqSpan(57, 10, 6.85);
  aqSpan(68.1, 9.8, 6.55);                                       // すきま1.2
  aqSpan(78.6, 9.6, 6.25);                                       // すきま0.8
  staticBox(1.4, 0.24, 1.4, -3.7, 5.28, 83.4, MAT.stone);        // 段さがり → ろうか2

  // ── ⑦ 朽ちたつり橋 → べっかんの島 ──
  hangingBridge(0, 4.3, 85.4, 91.4, 2.4, 4, MAT.woodDark);
  islandBox(18, 16, 0, 4.2, 99.4, MAT.grass);                    // べっかんの島
  tree(-6.5, 94, 4.2, 1.0); banner(6.5, 4.2, 93.5, MAT.red);
  // べっかんの城壁と 落とし格子（床スイッチ＋木箱でひらく）
  wallZ(98.4, -9, 9, 4.2, 4.6, MAT.stone, [{ x0: -1.6, x1: 1.6, y0: 4.2, y1: 7.5 }], 0.7);
  crenels(-5.3, 9.07, 98.4, 7.4, 'x'); crenels(5.3, 9.07, 98.4, 7.4, 'x');
  gimPadDoor([3.4, 4.13, 96.8], [0, 5.9, 98.4], [3.1, 3.35, 0.28], 2.6,
    null, MAT.ironDark);
  dynBox(0.72, 0.72, 0.72, -3.2, 4.75, 95, MAT.crate, 12, { noSleep: true });
  dynBox(0.72, 0.72, 0.72, -4, 4.75, 95.9, MAT.crate, 12, { noSleep: true });
  tree(5.5, 101, 4.2, 0.9);
  // よじ登り②: くずれた基壇の二段のぼり（1.4m→1.3mの連続。こえた先が はねばし2）
  staticBox(18, 1.5, 3.2, 0, 4.95, 104.6, MAT.stone);            // 一段め（上面5.7）
  staticBox(18, 1.3, 1.6, 0, 6.35, 105.4, MAT.stone);            // 二段め（上面7.0）
  banner(-6, 7.0, 105.4, MAT.blue);

  /* ═══ 第3章（みなみへまがる）: はねばし2 → 大聖塔の島 ═══ */
  place(56, 153.4, 2);
  // ── ⑧ さいごのはねばし（堀）: くさりをつかんでひきおろす ──
  islandBox(1.4, 1.4, -1.15, 4.1, 110);                          // 堀のとび石
  // 橋は基壇ごしのルートの先（島のひがしのおび）に下りる
  const b2 = hingedBox(2.2, 0.2, 4.9, MAT.woodDark, 5, [-1.3, 4.34, 112.2], [0, 0, 2.45], [1, 0, 0], 1.22,
    { angularDamping: 0.5, motorForce: 60 });
  const b2chain = chain({ idx: b2, local: [0, 0, -2.4] }, 6, 0.45, { grip: true, noStatic: true });
  GIM.drawbridges.push({ idx: b2, upAngle: 1.22, grabIdxs: [...b2chain, b2], open: false });

  // ── ⑨ 大聖塔の島: 階段の正攻法＋かべのぼりの力技 ──
  islandBox(16, 16, 0, 4.2, 120.4, MAT.grass);
  banner(-5, 4.2, 113.2, MAT.red); banner(5, 4.2, 113.2, MAT.blue);
  // よじ登り③: 大聖塔まえのくずれた城壁（1.5m・島のはば全体）
  staticBox(16, 1.5, 0.8, 0, 4.95, 114.4, MAT.stoneDark);
  staticBox(1.4, 0.4, 0.7, 4.6, 5.9, 114.4, MAT.stone);          // くずれのこり
  staticBox(1.0, 0.35, 0.9, -2.2, 4.38, 115.3, MAT.stone);       // くずれた石
  tree(-6, 118, 4.2, 1.0); tree(6.2, 124, 4.2, 0.9);
  staticBox(6.5, 6, 6.5, 0, 7.2, 122.4, MAT.stone);              // 大聖塔（上面10.2）
  stairs(8, 0.5, 0.6, 2.2, MAT.stone, -6.4, 4.2, 115.4, 'x', 1); // 階段その1（y4.2→8.2）
  staticBox(2.2, 0.3, 2.2, -0.8, 8.05, 115.4, MAT.stone);        // おどりば（上面8.2）
  stairs(4, 0.5, 0.6, 2.0, MAT.stone, -0.8, 8.2, 116.5, 'z', 1); // 階段その2（→10.2）
  for (let i = 0; i < 6; i++) {                                  // 力技: 正面のよじのぼりレッジ
    staticBox(1.5, 0.14, 0.34, i % 2 ? 1.15 : -1.15, 4.2 + 0.9 * (i + 1), 118.9, MAT.stoneDark);
  }
  crenels(0, 10.47, 119.35, 6.1, 'x'); crenels(0, 10.47, 125.45, 6.1, 'x');
  crenels(-3.05, 10.47, 122.4, 6.1, 'z'); crenels(3.05, 10.47, 122.4, 6.1, 'z');
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 6), MAT.roof);
  spire.position.set(...tpos(-2.2, 11.1, 124.6));
  spire.castShadow = true;
  levelRoot.add(spire);
  banner(0, 10.2, 122.4, MAT.gold);                              // 大聖塔てっぺん＝見晴らしの中間地点
  goldStar(0, 10.2, 120.6, 1.0);                                 // てっぺんのごほうび

  /* ═══ 第4章（延長・大聖塔島から西へおりる）: とび石の下り → 隠れ里の城壁のぼり
     → 大鳥居のゴール（place は使わずワールド座標。大聖塔島 world(x48..64,z25..41) の西へ） ═══ */
  place(0, 0, 0);
  // ⑩ 大聖塔島の西(world x48)から とび石で 西へおりていく
  islandBox(3.5, 4, 46, 3.0, 36);                                // とび石1 x44.25..47.75, z34..38, y3
  islandBox(3.5, 4, 42, 1.6, 36);                                // とび石2 x40.25..43.75, z34..38, y1.6
  islandBox(8, 10, 34.5, 0.4, 36, MAT.grass);                    // 隠れ里の島 x30.5..38.5, z31..41, y0.4
  tree(37, 39, 0.4, 0.9); banner(37.5, 0.4, 33, MAT.blue);
  // よじ登り④: 隠れ里の城壁（1.5m・島のたてはばいっぱい・こえた先がゴール）
  staticBox(0.5, 1.5, 10, 34, 1.15, 36, MAT.stoneDark);          // x33.75..34.25, z31..41
  staticBox(0.62, 0.12, 10.2, 34, 1.91, 36, MAT.stone);
  // ⑪ ゴール: 隠れ里の大鳥居
  staticBox(0.35, 3.0, 0.35, 32.0, 1.5, 34.0, MAT.red);          // 鳥居のはしら
  staticBox(0.35, 3.0, 0.35, 32.0, 1.5, 38.0, MAT.red);
  staticBox(4.6, 0.4, 0.4, 32.0, 3.15, 34.0, MAT.red);           // かさぎ
  staticBox(4.6, 0.4, 0.4, 32.0, 3.15, 38.0, MAT.red);
  staticBox(0.4, 0.4, 4.4, 32.0, 2.7, 36.0, MAT.red);            // ぬき
  tree(31, 40, 0.4, 0.85); tree(31, 32.5, 0.4, 0.85);
  goalFlag(32, 0.4, 36);
  place(56, 153.4, 2);                                           // よりみちのため 大聖塔フレームへもどす

  /* ═══ よりみち: 大聖塔のみなみ ほしの小島（ごほうび） ═══ */
  islandBox(1.5, 1.5, -2.6, 3.4, 130.4);                         // とび石
  islandBox(1.5, 1.5, -3.6, 2.8, 133);
  islandBox(5.5, 4.5, -3.6, 2.2, 136.4);                         // ほしの小島
  goldStar(-3.6, 2.2, 137.2, 1.2);
  banner(-5.6, 2.2, 135.6, MAT.red);
  bounceShroom(-1.6, 3.0, 131.6, 10);                            // きのこで島へもどる

  /* ═══ ランドマーク: 回遊のまんなかにうかぶ 古い天守の島（かざり） ═══ */
  place(0, 0, 0);
  islandBox(11, 11, 28, -1.2, 24);
  staticBox(4.2, 8.5, 4.2, 28, 3.05, 24, MAT.stone);             // 天守（上面7.3）
  staticBox(5.4, 0.5, 5.4, 28, 7.55, 24, MAT.stoneDark);         // はりだしの屋上
  crenels(28, 7.8, 21.5, 5.0, 'x'); crenels(28, 7.8, 26.5, 5.0, 'x');
  crenels(25.5, 7.8, 24, 5.0, 'z'); crenels(30.5, 7.8, 24, 5.0, 'z');
  {
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(2.7, 2.3, 6), MAT.roof);
    keepRoof.position.set(28, 9.35, 24);
    keepRoof.castShadow = true;
    levelRoot.add(keepRoof);
  }
  staticBox(2.0, 3.2, 2.0, 32.2, 0.4, 20.6, MAT.stoneDark);      // くずれた小塔
  staticBox(0.9, 1.6, 3.0, 24.2, -0.4, 27.4, MAT.stoneDark);     // かべのあと
  tree(31.6, 27.2, -1.2, 1.0); tree(24.4, 20.8, -1.2, 0.85);
  banner(26.2, 8.05, 22.3, MAT.red);
  balloon(13, 12.5, 36, 1.35, MAT.red);
  balloon(68, 12, 60, 1.05, MAT.blue);
  isletDeco(33, [
    { x0: -30, x1: -17, z0: -2, z1: 48, n: 3 },                  // にしのそら
    { x0: 2, x1: 42, z0: -28, z1: -13, n: 3, lo: true },         // みなみのそら（ひくめ）
    { x0: 70, x1: 84, z0: 6, z1: 50, n: 3 },                     // ひがしのそら
    { x0: 4, x1: 34, z0: 72, z1: 84, n: 2, lo: true },           // きたのそら（ひくめ）
  ]);

  CHECKPOINTS = [
    { x: 0, y: 0.9, z: 0.5 },        // スタート
    { x: 0, y: 0.9, z: 15 },         // 前庭
    { x: 0, y: 0.9, z: 33.5 },       // 城門のなか
    { x: 0, y: 0.9, z: 37.5 },       // 中庭
    { x: -7.4, y: 5.1, z: 47 },      // 城壁の通路
    { x: 0, y: 8.1, z: 55 },         // 塔1のてっぺん（分かれ道）
    { x: 22.5, y: 5.5, z: 55 },      // 列柱ろうか1
    { x: 33.4, y: 5.5, z: 55 },      // 列柱ろうか2（ごうりゅう）
    { x: 50.4, y: 5.1, z: 55 },      // べっかんの中庭
    { x: 56, y: 5.1, z: 40.2 },      // 大聖塔の島のいりぐち
    { x: 36, y: 1.0, z: 36 },        // 隠れ里の島（大聖塔の西）
  ];
  CP_ZONES = [
    { cp: 1, x0: -8, x1: 8, z0: 13, z1: 17, yMin: -0.5 },
    { cp: 2, x0: -2, x1: 2, z0: 31.5, z1: 35, yMin: -0.5 },
    { cp: 3, x0: -6, x1: 6, z0: 35.5, z1: 39.5, yMin: -0.5 },
    { cp: 4, x0: -9.1, x1: -5.7, z0: 45.5, z1: 52, yMin: 3.7 },
    { cp: 5, x0: -3, x1: 3, z0: 52.3, z1: 57.7, yMin: 6.6 },       // 塔1のてっぺん
    { cp: 6, x0: 20.0, x1: 26.0, z0: 53, z1: 57, yMin: 4.0 },      // ろうか1（ルートA）
    { cp: 6, x0: 13.2, x1: 23, z0: 60, z1: 62, yMin: 5.9 },        // すいどうばし（ルートB）
    { cp: 7, x0: 30.4, x1: 35.4, z0: 53, z1: 57, yMin: 4.0 },      // ろうか2（ごうりゅう）
    { cp: 8, x0: 48.8, x1: 52.6, z0: 47, z1: 63, yMin: 3.7 },      // べっかんの中庭
    { cp: 9, x0: 50, x1: 62, z0: 39.4, z1: 41.2, yMin: 3.7 },      // 大聖塔の島のいりぐち
    { cp: 10, x0: 34.25, x1: 38.5, z0: 31, z1: 41, yMin: -0.5 },   // 隠れ里の島（城壁の手前）
  ];
  GOAL = { x0: 29, x1: 34, z0: 30, y: 0 };
}

/* =====================================================================
   コース定義と切りかえ
   ===================================================================== */
// 各コースの build() が CHECKPOINTS / CP_ZONES / GOAL を設定する
const COURSES = [
  {
    name: '🏠 ゆめのおうち', desc: 'はじめてのゆめ。ドア・ボタン・はこ運び。分かれ道とほしの島も',
    build: buildCourse1, cam: { x: 26, z: 27, r: 48 },
  },
  {
    name: '🏗️ こうじげんば', desc: '大クレーンのまわりを ぐるっとらせんにのぼる こうじ中のビル',
    build: buildCourse2, cam: { x: 11, z: 5, r: 42 },
  },
  {
    name: '🏰 ゆめのおしろ', desc: 'おしろのまわりを ひとまわり。はねばしをこえて大聖塔の旗へ',
    build: buildCourse3, cam: { x: 25, z: 30, r: 58 },
  },
];
let courseIdx = -1;

function buildLevel(idx) {
  if (idx === courseIdx) return;
  // 前のコースをかたづける
  scene.remove(levelRoot);
  levelRoot.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  levelRoot = new THREE.Group();
  scene.add(levelRoot);
  staticDefs.length = 0;
  dynObjects.length = 0;
  for (const k of Object.keys(GIM)) delete GIM[k];
  // ギミックの入れ物（build() がここに部品を push する）
  GIM.rods = [];
  GIM.chains = [];
  GIM.buttons = [];
  GIM.pads = [];
  GIM.lifts = [];
  GIM.spinners = [];
  GIM.movers = [];
  GIM.balances = [];
  GIM.plankBridges = [];
  GIM.drawbridges = [];
  GIM.catapults = [];
  GIM.breakables = [];
  GIM.stars = [];
  GIM.floaters = [];
  place(0, 0, 0);   // 配置トランスフォームをリセット
  courseIdx = idx;
  // build() が CHECKPOINTS / CP_ZONES / GOAL を直接セットする
  COURSES[idx].build();
}

/* 空・雲などコースによらない背景（1回だけつくる）
   「夢の中の浮遊世界」: 空のグラデーションドーム＋ローポリ雲（レベルの下にも）。海はなし */
let waterSurf = null;   // 旧・海面（廃止。メインループの参照のため変数だけ残す）
function buildEnvironment() {
  // 空のグラデーション（上 #87B8E8 → 地平線 #E8F0F8）
  const cv = document.createElement('canvas');
  cv.width = 2; cv.height = 256;
  const c = cv.getContext('2d');
  const gr = c.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#87b8e8');
  gr.addColorStop(0.52, '#b9d5ee');
  gr.addColorStop(1, '#e8f0f8');
  c.fillStyle = gr;
  c.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(cv);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(175, 24, 14),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.position.set(0, -8, 26);
  scene.add(dome);

  // ローポリ雲（かたまり感のあるモコモコ。上にも、レベルのずっと下にも）
  const rng = makeRng(4649);
  const mkCloud = (x, y, z, s) => {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + rng() * 0.9, 0), MAT.cloud);
      b.position.set((i - (n - 1) / 2) * 1.5 + (rng() - 0.5), (rng() - 0.5) * 0.55, (rng() - 0.5) * 1.3);
      b.scale.y = 0.55;
      g.add(b);
    }
    g.scale.setScalar(s);
    g.position.set(x, y, z);
    scene.add(g);
  };
  for (let i = 0; i < 15; i++) mkCloud(-75 + rng() * 150, 10 + rng() * 18, -35 + rng() * 125, 1 + rng() * 1.7);
  for (let i = 0; i < 11; i++) mkCloud(-65 + rng() * 130, -9 - rng() * 15, -25 + rng() * 110, 1.5 + rng() * 2.1);
}
buildEnvironment();

/* コース選択（メニューでえらぶとその場で背景も切りかわる） */
let courseSel = 0;
try {
  const c = parseInt(localStorage.getItem('hff-course') || '0', 10);
  if (c >= 0 && c < COURSES.length) courseSel = c;
} catch (e) { /* 保存なしでもOK */ }

function buildCoursePicker() {
  const row = $('course-row');
  COURSES.forEach((course, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    const title = document.createElement('b');
    title.textContent = course.name;
    const desc = document.createElement('small');
    desc.textContent = course.desc;
    b.append(title, desc);
    if (i === courseSel) b.classList.add('sel');
    b.addEventListener('click', () => {
      courseSel = i;
      [...row.children].forEach((el, j) => el.classList.toggle('sel', j === i));
      try { localStorage.setItem('hff-course', String(i)); } catch (e) { /* 同上 */ }
      if (state === 'menu') buildLevel(i); // 背景もその場で切りかえてプレビュー
    });
    row.appendChild(b);
  });
}
buildCoursePicker();
buildLevel(courseSel);

/* =====================================================================
   見た目のキャラクター（Rig）— ホスト/ゲスト共通
   ===================================================================== */
const UP = new THREE.Vector3(0, 1, 0);
const _tv1 = new THREE.Vector3(), _tv2 = new THREE.Vector3(), _tv3 = new THREE.Vector3();

// 名札のふちどり色（オフホワイトなど明るすぎる色は青グレーに）
function labelColor(c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (r + g + b) / 3 > 215 ? 0x8a97a8 : c;
}

function makeNameSprite(name, colorHex) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = 'bold 34px "Hiragino Maru Gothic ProN", sans-serif';
  const w = Math.min(240, c.measureText(name).width + 28);
  c.fillStyle = 'rgba(255,255,255,0.88)';
  c.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0');
  c.lineWidth = 5;
  c.beginPath();
  c.roundRect((256 - w) / 2, 8, w, 48, 24);
  c.fill();
  c.stroke();
  c.fillStyle = '#31435a';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  spr.scale.set(1.7, 0.42, 1);
  return spr;
}

// ぼうし（スキン）を頭にのせる
function addHatTo(group, h, bodyColor) {
  const g = new THREE.Group();
  if (h === 1) { // ぼうし（キャップ）
    const capMat = new THREE.MeshStandardMaterial({ color: 0x33548c, roughness: 0.7 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    dome.position.set(0, 0.9, 0);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.16), capMat);
    brim.position.set(0, 0.925, 0.22);
    g.add(dome, brim);
  } else if (h === 2) { // かんむり
    const gold = new THREE.MeshStandardMaterial({ color: 0xf5c211, roughness: 0.35, metalness: 0.55 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 12), gold);
    band.position.set(0, 0.99, 0);
    g.add(band);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6), gold);
      spike.position.set(Math.cos(a) * 0.11, 1.07, Math.sin(a) * 0.11);
      g.add(spike);
    }
  } else if (h === 3) { // ねこみみ
    const earMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7 });
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.15, 8), earMat);
      ear.position.set(0.115 * sx, 0.97, 0);
      ear.rotation.z = -0.3 * sx;
      g.add(ear);
    }
  } else if (h === 4) { // シルクハット
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x2f2f3a, roughness: 0.5 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.025, 14), hatMat);
    brim.position.set(0, 0.955, 0);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 14), hatMat);
    top.position.set(0, 1.08, 0);
    g.add(brim, top);
  }
  g.traverse((m) => { m.castShadow = true; });
  group.add(g);
}

class Rig {
  constructor(skin, name) {
    skin = normSkin(skin);
    const accent = SKIN_COLORS[skin.c];
    this.color = accent;
    // 基本はオフホワイトのミニマル人型。スキン色は「上半身の差し色」
    const bodyMat = new THREE.MeshStandardMaterial({ color: OFF_WHITE, roughness: 0.8 });
    const accentMat = skin.c === 0 ? bodyMat : new THREE.MeshStandardMaterial({ color: accent, roughness: 0.75 });

    this.group = new THREE.Group();
    // 体のパーツはぜんぶ bodyGrp にまとめ、加減速リーン・歩行スイングをグループごとかける
    this.bodyGrp = new THREE.Group();
    this.group.add(this.bodyGrp);

    // 腰まわり（下半身・オフホワイト）
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), bodyMat);
    hips.scale.set(1, 0.82, 0.9);
    hips.position.y = -0.3;
    // 樽型の胴（オフホワイト）
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.3, 6, 14), bodyMat);
    chest.scale.set(1, 1, 0.88);
    chest.position.y = 0.06;
    // むねの前面パネル（差し色）: どのスキン色でも前後がひと目で分かる。背面は無地
    const bibMat = skin.c === 0
      ? new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.75 }) // デフォルト時はうすいグレージュ
      : accentMat;
    const bib = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), bibMat);
    bib.scale.set(1.05, 1.5, 0.62);
    bib.position.set(0, 0.03, 0.16);
    hips.castShadow = chest.castShadow = bib.castShadow = true;
    this.bodyGrp.add(hips, chest, bib);

    // 首＋頭（まるく大きめ）。headGrpごと揺らして「遅れ」を出す
    this.headGrp = new THREE.Group();
    this.headGrp.position.y = 0.5;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.115, 0.16, 10), bodyMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), bodyMat);
    head.position.y = 0.27; // ワールド~0.77（ぼうし位置は旧頭と同じ）
    neck.castShadow = head.castShadow = true;
    this.headGrp.add(neck, head);
    // ひかえめな顔（小さな黒目2つ・前面の向きキュー）
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeMat);
      eye.position.set(0.074 * sx, 0.315, 0.196);
      this.headGrp.add(eye);
    }
    if (skin.h) {
      const hatHolder = new THREE.Group();
      hatHolder.position.y = -0.5; // addHatTo は胴中心原点の座標系なので相殺（つばは+z=前向き）
      addHatTo(hatHolder, skin.h, accent);
      this.headGrp.add(hatHolder);
    }
    this.bodyGrp.add(this.headGrp);

    // あし（太い円筒＋ミトン状の足・ひざなし。バネ追従でオーバーシュート）
    this.legs = [];
    this.legState = [{ a: 0, v: 0 }, { a: 0, v: 0 }];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.14 * sx, -0.3, 0);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.09, 0.24, 10), bodyMat);
      leg.position.y = -0.12;
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), bodyMat);
      foot.scale.set(1, 0.8, 1.25);
      foot.position.y = -0.25;
      leg.castShadow = foot.castShadow = true;
      hip.add(leg, foot);
      this.bodyGrp.add(hip);
      this.legs.push(hip);
    }

    // うで（太い円筒・かた→手を毎フレーム張りなおす）とミトン状の手（球）
    this.arms = [];
    this.hands = [];
    this.handMats = [];
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 1, 10), bodyMat);
      arm.castShadow = true;
      scene.add(arm);
      this.arms.push(arm);
      const hm = new THREE.MeshStandardMaterial({ color: OFF_WHITE, roughness: 0.8 });
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), hm);
      hand.castShadow = true;
      scene.add(hand);
      this.hands.push(hand);
      this.handMats.push(hm);
    }

    this.nameSpr = makeNameSprite(name, labelColor(accent));
    scene.add(this.nameSpr);
    scene.add(this.group);

    this.lastPos = new THREE.Vector3();
    this.phase = 0;
    this.speedSm = 0;
    this.vySm = 0;
    this.yawVelSm = 0;
    this.lastYaw = 0;
    this.limpSm = 0;
    this.t = 0;               // アイドルゆらゆら用の経過時間
    this.vx = 0; this.vz = 0; // 前フレーム速度（加速度の算出用）
    this.axSm = 0; this.azSm = 0; // 平滑化した加速度（慣性リーン用）
  }

  // p:Vector3ふう, q:Quaternionふう, hl/hr: [x,y,z],
  // flags: bit0=左手つかみ bit1=右手つかみ bit2=脱力（ラグドール）
  setPose(p, q, hl, hr, flags, dt) {
    const grabMask = flags & 3;
    const limp = !!(flags & 4);
    const g = this.group;
    g.position.set(p.x, p.y, p.z);
    g.quaternion.set(q.x, q.y, q.z, q.w);
    g.updateMatrixWorld();

    // 移動・旋回・落下スピードと加速度を平滑化（慣性のある手続きアニメ用）
    if (dt > 0) {
      const vx = (p.x - this.lastPos.x) / dt, vz = (p.z - this.lastPos.z) / dt;
      const sp = Math.hypot(vx, vz);
      this.speedSm += (Math.min(sp, 5) - this.speedSm) * Math.min(1, dt * 10);
      this.phase += this.speedSm * dt * 3.4;
      this.t += dt;
      // 加速度（クランプ＋平滑化 → 慣性リーン用）
      const kA = Math.min(1, dt * 5);
      this.axSm += (Math.min(8, Math.max(-8, (vx - this.vx) / dt)) - this.axSm) * kA;
      this.azSm += (Math.min(8, Math.max(-8, (vz - this.vz) / dt)) - this.azSm) * kA;
      this.vx = vx; this.vz = vz;
      const vy = (p.y - this.lastPos.y) / dt;
      this.vySm += (Math.min(6, Math.max(-6, vy)) - this.vySm) * Math.min(1, dt * 6);
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
      let dy = yaw - this.lastYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yawVelSm += (Math.min(6, Math.max(-6, dy / dt)) - this.yawVelSm) * Math.min(1, dt * 8);
      this.lastYaw = yaw;
      this.limpSm += ((limp ? 1 : 0) - this.limpSm) * Math.min(1, dt * 7);
    }
    this.lastPos.set(p.x, p.y, p.z);

    // あし: バネで目標角へ追従（遅れ＋オーバーシュート＝ふにゃふにゃ千鳥足）
    const walkAmp = Math.min(this.speedSm / WALK_SPEED, 1);
    const amp = walkAmp * 0.78 * (1 - this.limpSm);
    for (let i = 0; i < 2; i++) {
      const st = this.legState[i];
      const target = Math.sin(this.phase + (i ? Math.PI : 0)) * amp + this.limpSm * (i ? -0.85 : 0.55);
      if (dt > 0) {
        st.v += (target - st.a) * 110 * dt - st.v * 7 * dt; // 柔らかめ＝もっと遅れて跳ねる
        st.a += st.v * dt;
      } else st.a = target;
      this.legs[i].rotation.x = st.a;
      this.legs[i].rotation.z = (i ? -1 : 1) * -this.limpSm * 0.45;
    }

    // 胴: 加減速・旋回の慣性でリーン＋腰・肩の左右スイング＋上下ボブ＋アイドルゆらゆら
    const upr = 1 - this.limpSm;
    const cy = Math.cos(this.lastYaw), sy = Math.sin(this.lastYaw);
    const aFwd = this.axSm * sy + this.azSm * cy;   // ローカル前方向の加速度
    const aSide = this.axSm * cy - this.azSm * sy;  // ローカル右方向の加速度
    this.bodyGrp.rotation.x = (aFwd * 0.028 + Math.sin(this.phase * 2) * 0.03 * walkAmp) * upr;
    this.bodyGrp.rotation.z = (-aSide * 0.024 + Math.sin(this.phase) * 0.09 * walkAmp
      + Math.sin(this.t * 1.7) * 0.018 + Math.sin(this.t * 2.9) * 0.01) * upr;
    this.bodyGrp.rotation.y = Math.sin(this.phase) * 0.11 * walkAmp * upr;   // 肩ふり
    this.bodyGrp.position.y = -Math.abs(Math.cos(this.phase)) * 0.05 * walkAmp; // 一歩ごとのボブ
    g.updateMatrixWorld(true); // リーン反映後の行列でうで・かたを張る

    // あたま: 旋回・落下に遅れてついてくる＋歩行ボブ。脱力中はがくっと前へ
    this.headGrp.rotation.y = -this.yawVelSm * 0.14;
    this.headGrp.rotation.x = -this.vySm * 0.08 - aFwd * 0.018 + Math.sin(this.phase * 2) * 0.06 * walkAmp + this.limpSm * 0.5;
    this.headGrp.rotation.z = Math.sin(this.phase + 0.7) * 0.08 * walkAmp + aSide * 0.015;

    // うで
    const hands = [hl, hr];
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? 1 : -1;   // hands[0]=左手(+x)・hands[1]=右手(-x)
      const shoulder = _tv1.set(0.27 * sx, 0.3, 0).applyMatrix4(this.bodyGrp.matrixWorld);
      const hp = _tv2.set(hands[i][0], hands[i][1], hands[i][2]);
      const arm = this.arms[i];
      const dir = _tv3.copy(hp).sub(shoulder);
      let len = Math.max(0.08, dir.length());
      dir.normalize();
      // 見た目の腕の長さに上限（物理ソフトリミットの保険。超えたら手も腕の先へ寄せる）
      if (len > ARM_VIS_MAX) {
        len = ARM_VIS_MAX;
        hp.copy(shoulder).addScaledVector(dir, len);
      }
      arm.scale.set(1, len, 1);
      arm.quaternion.setFromUnitVectors(UP, dir);
      arm.position.copy(shoulder).addScaledVector(dir, len / 2);
      this.hands[i].position.copy(hp);
      this.handMats[i].color.setHex((grabMask >> i) & 1 ? 0xffd43b : OFF_WHITE);
    }

    this.nameSpr.position.set(p.x, p.y + 1.45, p.z);
  }

  dispose() {
    scene.remove(this.group, this.nameSpr, ...this.arms, ...this.hands);
  }
}

/* =====================================================================
   物理（ホスト側のみ）
   ===================================================================== */
let world = null;
let charMaterial, groundMaterial, handMaterial, objMaterial;
let simT = 0;
const GROUP_WORLD = 1, GROUP_OBJ = 2;
const playerGroup = (idx) => 4 << idx; // idx 0..4 → bit 2..6

function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0), allowSleep: true });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.defaultContactMaterial.friction = 0.55; // 高めの摩擦＝物の引きずり感
  world.defaultContactMaterial.restitution = 0;

  groundMaterial = new CANNON.Material('ground');
  charMaterial = new CANNON.Material('char');
  handMaterial = new CANNON.Material('hand');
  objMaterial = new CANNON.Material('obj');
  // キャラの摩擦は0（摩擦の偶力で転んでしまうため、停止・追従は速度ブレンドで行う）
  world.addContactMaterial(new CANNON.ContactMaterial(charMaterial, groundMaterial, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(handMaterial, groundMaterial, { friction: 0.8, restitution: 0 }));
  // 木箱などの動的オブジェクト: 床との摩擦は0にして、かわりに stepGimmicks の
  // 疑似静止摩擦（低速時の減衰）でとめる。cannon-es の箱どうしの接触摩擦は
  // 設定値よりはるかに強く効いてしまい、キャラの力では「おせない」ため
  world.addContactMaterial(new CANNON.ContactMaterial(objMaterial, groundMaterial, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(objMaterial, objMaterial, { friction: 0.3, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(charMaterial, objMaterial, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(handMaterial, objMaterial, { friction: 0.8, restitution: 0 }));

  // 静的コライダー
  for (const s of staticDefs) {
    const body = new CANNON.Body({
      mass: 0,
      material: groundMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(s.w / 2, s.h / 2, s.d / 2)),
      position: new CANNON.Vec3(s.x, s.y, s.z),
      collisionFilterGroup: GROUP_WORLD,
    });
    if (s.quat) body.quaternion.set(...s.quat);        // 配置ヨーとの合成回転
    else if (s.rotX) body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), s.rotX);
    else if (s.rotY) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), s.rotY);
    else if (s.rotZ) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), s.rotZ);
    if (s.belt) body.beltVel = new CANNON.Vec3(...s.belt);      // ベルトコンベア
    if (s.bounce) body.bouncePad = s.bounce;                    // トランポリン
    world.addBody(body);
  }

  // 動的・キネマティックオブジェクト
  for (const o of dynObjects) {
    const isKin = o.kinematic || o.kind === 'platform';
    const body = new CANNON.Body({
      mass: isKin ? 0 : o.mass,
      type: isKin ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC,
      material: isKin ? groundMaterial : objMaterial,
      position: new CANNON.Vec3(...o.home.p),
      collisionFilterGroup: isKin ? GROUP_WORLD : GROUP_OBJ,
      linearDamping: o.linearDamping !== undefined ? o.linearDamping : 0.05,
      angularDamping: o.angularDamping !== undefined ? o.angularDamping : 0.05,
    });
    if (o.home.q) body.quaternion.set(...o.home.q);
    if (o.kind === 'sphere') body.addShape(new CANNON.Sphere(o.radius));
    else body.addShape(new CANNON.Box(new CANNON.Vec3(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2)));
    // レンガなどは寝かせて負荷をへらす（つよい衝撃で起きる）。
    // ロープ・ヒンジ・パズルの箱（noSleep）は常時アクティブ（寝ると「おしても動かない」ため）
    body.allowSleep = !isKin && !o.rope && !o.hinge && !o.noSleep;
    body.sleepSpeedLimit = 0.3;
    body.sleepTimeLimit = 0.8;
    if (o.spin !== undefined) { body.spin = o.spin; body.spinCenter = o.spinCenter; } // 回転床
    // はねばしのくさりなど: 地形とぶつからない（すきまにはさまって橋が閉じ切らないのを防ぐ）
    if (o.noStatic) body.collisionFilterMask = -1 & ~GROUP_WORLD;
    world.addBody(body);
    o.body = body;

    // こわせるかべのレンガ: 閾値をこえる衝撃（鉄球・投げた箱）でくずれたことを記録
    if (o.breakGroup !== undefined) {
      body.addEventListener('collide', (ev) => {
        const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
        const grpB = GIM.breakables && GIM.breakables[o.breakGroup];
        if (v > 4.5 && grpB && !grpB.hit) grpB.hit = true;
      });
    }

    // ヒンジ（ちょうつがい）: 固定アンカーとつなぐ。モーターつきなら制御に使う
    if (o.hinge) {
      const anchor = new CANNON.Body({ mass: 0, collisionFilterGroup: 0, collisionFilterMask: 0 });
      anchor.position.set(...o.hinge.pivot);
      world.addBody(anchor);
      const c = new CANNON.HingeConstraint(anchor, body, {
        pivotA: new CANNON.Vec3(0, 0, 0),
        axisA: new CANNON.Vec3(...o.hinge.axis),                        // ワールド軸
        pivotB: new CANNON.Vec3(...o.hinge.localPivot),
        axisB: new CANNON.Vec3(...(o.hinge.axisLocal || o.hinge.axis)), // ボディローカル軸
      });
      if (o.hinge.motorForce) {
        c.enableMotor();
        c.setMotorMaxForce(o.hinge.motorForce);
      }
      world.addConstraint(c);
      o.hingeC = c;
    }
  }

  // くさり/ロープ: 固定アンカー、または物（はねばしの先など）のローカル点からつなぐ
  for (const ch of GIM.chains || []) {
    let prev;
    if (ch.anchor) {
      prev = new CANNON.Body({
        mass: 0,
        position: new CANNON.Vec3(...ch.anchor),
        collisionFilterGroup: GROUP_WORLD,
        collisionFilterMask: 0, // なにともぶつからない
        shape: new CANNON.Sphere(0.05),
      });
      world.addBody(prev);
    } else {
      prev = dynObjects[ch.attachIdx].body;
    }
    ch.links.forEach((li, k) => {
      const link = dynObjects[li].body;
      if (k === 0 && !ch.anchor) {
        // 物のローカル点（橋の先端など）に1番目のリンクをつなぐ
        world.addConstraint(new CANNON.PointToPointConstraint(prev, new CANNON.Vec3(...ch.attachLocal), link, new CANNON.Vec3(0, 0, 0)));
      } else {
        world.addConstraint(new CANNON.DistanceConstraint(prev, link, ch.spacing));
      }
      prev = link;
    });
  }

  // ゆれるつり橋: 板と板を左右2点のP2P拘束でつなぐ（りょうはしは固定アンカー）
  for (const pb of GIM.plankBridges || []) {
    const anchorBody = (p) => {
      const a = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(...p), collisionFilterGroup: GROUP_WORLD, collisionFilterMask: 0 });
      if (pb.q) a.quaternion.set(...pb.q);   // 橋の向きにあわせる（拘束ローカル点のため）
      world.addBody(a);
      return a;
    };
    const bodies = [anchorBody(pb.a), ...pb.planks.map((i) => dynObjects[i].body), anchorBody(pb.b)];
    const hw = pb.w / 2 - 0.1;
    for (let k = 0; k < bodies.length - 1; k++) {
      const zi = k === 0 ? 0 : pb.joint;
      const zj = k === bodies.length - 2 ? 0 : -pb.joint;
      for (const sx of [-hw, hw]) {
        world.addConstraint(new CANNON.PointToPointConstraint(
          bodies[k], new CANNON.Vec3(sx, 0, zi),
          bodies[k + 1], new CANNON.Vec3(sx, 0, zj),
        ));
      }
    }
  }

  // はねばし: 「これをつかんだら橋がおりる」ボディの集合を作っておく
  for (const db of GIM.drawbridges || []) {
    db.bodySet = new Set(db.grabIdxs.map((i) => dynObjects[i].body));
  }
}

/* ギミックをうごかす（毎固定ステップ・ホストのみ） */
function stepGimmicks() {
  // キネマティック物を目標高さへ（速度でうごかす＝上に乗った物ごと運べる）
  const driveY = (idx, targetY, vmax = 1.3) => {
    const b = dynObjects[idx].body;
    b.velocity.set(0, Math.max(-vmax, Math.min(vmax, (targetY - b.position.y) * 3)), 0);
  };
  const clamp = (v, a) => Math.max(-a, Math.min(a, v));

  // ── 疑似摩擦: 箱・岩の水平速度を毎ステップ一定量へらす（クーロン摩擦の再現。
  //    床との接触摩擦は0にしてあるため）。おせばうごき、はなすとすっととまる＝HFF風
  for (const o of dynObjects) {
    if (!o.body || o.kinematic || o.hinge || o.rope) continue;
    const b = o.body;
    if (Math.abs(b.velocity.y) > 1.2) continue;      // 空中（投げた箱・落下中）はへらさない
    const v = b.velocity;
    const sp = Math.hypot(v.x, v.z);
    const dec = 0.03;                                // ≒摩擦係数0.16ぶんの減速/ステップ
    if (sp <= dec * 2) {
      v.x = 0;
      v.z = 0;
      b.angularVelocity.y *= 0.8;
    } else {
      const f = (sp - dec) / sp;
      v.x *= f;
      v.z *= f;
    }
  }

  // ── 赤い押しボタン（手でおすと作動） → スライドドア ──
  for (const bt of GIM.buttons) {
    if (!bt.on) {
      outer:
      for (const doll of dolls.values()) {
        for (const s of doll.sides) {
          const hp = s.body.position;
          if (Math.abs(hp.x - bt.pos[0]) < 0.5 && Math.abs(hp.y - bt.pos[1]) < 0.5 && Math.abs(hp.z - bt.pos[2]) < 0.55) {
            bt.on = true;
            announce(null, 'gate'); // 効果音のみ（解説ポップアップは出さない）
            break outer;
          }
        }
      }
      // 的あて: なげた箱などがボタンにあたっても作動
      if (!bt.on && bt.objHit) {
        for (const o of dynObjects) {
          if (!o.body || o.kinematic || o.hinge || o.rope || o.mass < 4) continue;
          const p = o.body.position;
          if (Math.abs(p.x - bt.pos[0]) < 0.62 && Math.abs(p.y - bt.pos[1]) < 0.62 && Math.abs(p.z - bt.pos[2]) < 0.62) {
            bt.on = true;
            announce(null, 'gate'); // 効果音のみ
            break;
          }
        }
      }
    }
    driveY(bt.capIdx, bt.pos[1] - (bt.on ? 0.12 : 0), 0.8);           // ボタンがしずむ
    driveY(bt.doorIdx, bt.on ? bt.openY : bt.homeY, 1.1);
  }

  // ── 床スイッチ（おもみで作動。人がのってもOK） → とびら ──
  for (const pd of GIM.pads) {
    const [px, py, pz] = pd.padPos;
    const onPad = (b) => Math.abs(b.position.x - px) < 0.95 && Math.abs(b.position.z - pz) < 0.95
      && b.position.y > py - 0.25 && b.position.y < py + 1.3;
    let pressed = false;
    for (const doll of dolls.values()) if (onPad(doll.torso)) { pressed = true; break; }
    if (!pressed) {
      for (const o of dynObjects) {
        if (o.body && !o.kinematic && !o.hinge && o.mass >= 8 && onPad(o.body)) { pressed = true; break; }
      }
    }
    driveY(pd.padIdx, pd.padHomeY - (pressed ? 0.07 : 0), 0.5);
    driveY(pd.gateIdx, pressed ? pd.gateOpenY : pd.gateHomeY, 1.2);
    if (pressed && !pd.announced) {
      pd.announced = true;
      announce(null, 'gate'); // 効果音のみ
    }
  }

  // ── レバー式リフト: レバーをたおした向きでリフトが上下 ──
  //    レバーは2安定式（いま命令している側へばねでもどる＝倒れっぱなしにならない）
  for (const lf of GIM.lifts) {
    const a = hingeAngle(lf.leverIdx);
    if (a > 0.3 && lf.target !== lf.y1) {
      lf.target = lf.y1;
      announce(null, 'lever'); // 効果音のみ
    } else if (a < -0.3 && lf.target !== lf.y0) {
      lf.target = lf.y0;
      if (lf.moved) announce(null, 'lever'); // 効果音のみ
    }
    lf.moved = true;
    const lever = dynObjects[lf.leverIdx].body;
    const rest = lf.target === lf.y1 ? 0.45 : -0.45;
    const lax = dynObjects[lf.leverIdx].hinge.axis;    // ワールドのヒンジ軸まわりにばね
    const lw = lever.angularVelocity;
    const lt = (rest - a) * 4 - (lw.x * lax[0] + lw.y * lax[1] + lw.z * lax[2]) * 0.5;
    lever.torque.x += lax[0] * lt;
    lever.torque.y += lax[1] * lt;
    lever.torque.z += lax[2] * lt;
    driveY(lf.liftIdx, lf.target, lf.speed || 1.1);
  }

  // ── 回転する床 ──
  for (const sp of GIM.spinners) {
    dynObjects[sp.idx].body.angularVelocity.set(0, sp.omega, 0);
  }

  // ── 往復する足場・ゆれる鉄骨（時刻でうごきがきまる） ──
  for (const mv of GIM.movers) {
    const b = dynObjects[mv.idx].body;
    const t = mv.base + Math.sin(simT * mv.omega + (mv.phase || 0)) * mv.amp;
    const cur = mv.axis === 'x' ? b.position.x : b.position.z;
    const v = (t - cur) / FIXED_DT;
    if (mv.axis === 'x') b.velocity.set(v, 0, 0);
    else b.velocity.set(0, 0, v);
  }

  // ── おもりエレベーター: かごに箱をつんでいるあいだ リフトがあがる ──
  for (const bl of GIM.balances) {
    let m = 0;
    for (const o of dynObjects) {
      if (!o.body || o.kinematic || o.hinge || o.rope || o.mass < 5) continue;
      const p = o.body.position;
      if (Math.abs(p.x - bl.zone[0]) < bl.rx && Math.abs(p.z - bl.zone[1]) < bl.rz && p.y > bl.yMin && p.y < bl.yMax) m += o.mass;
    }
    const up = m >= bl.needMass;
    if (up && !bl.announced) {
      bl.announced = true;
      announce(null, 'lever'); // 効果音のみ
    }
    driveY(bl.liftIdx, up ? bl.y1 : bl.y0, 0.7);
  }

  // ── はねばし: たれたくさり（または橋そのもの）をつかむと下りてくる。下りたらそのまま ──
  for (const db of GIM.drawbridges) {
    const hinge = dynObjects[db.idx].hingeC;
    const th = hingeAngle(db.idx);
    if (!db.open) {
      let pulled = false;
      for (const doll of dolls.values()) {
        for (const s of doll.sides) {
          if (s.grabC && db.bodySet && db.bodySet.has(s.grabC.bodyB)) { pulled = true; break; }
        }
        if (pulled) break;
      }
      const target = pulled ? 0 : db.upAngle;
      hinge.setMotorSpeed(-clamp((target - th) * 2.5, pulled ? 0.85 : 0.4));
      if (th < 0.28) {   // ここまで引きおろせば もう閉じない（モーターが最後まで倒す）
        db.open = true;
        announce(null, 'gate'); // 効果音のみ
      }
    } else {
      hinge.setMotorSpeed(-clamp((0 - th) * 3, 0.8));   // 下りたまま保持
    }
  }

  // ── カタパルト: 発射台がわに岩のおもりがのると発射！かごの上の人がとぶ ──
  for (const cp of GIM.catapults) {
    const hinge = dynObjects[cp.idx].hingeC;
    const th = hingeAngle(cp.idx);
    if (!cp.fireAt && simT > (cp.readyAt || 0)) {
      for (const wi of cp.weights) {
        const p = dynObjects[wi].body.position;
        if (Math.abs(p.x - cp.pad[0]) < 1.0 && Math.abs(p.z - cp.pad[2]) < 1.05 && p.y > cp.pad[1] - 0.6 && p.y < cp.pad[1] + 1.2) {
          cp.fireAt = simT + 0.35;
          announce(null, 'catapult'); // 効果音のみ
          break;
        }
      }
    }
    if (cp.fireAt && simT >= cp.fireAt && simT < cp.fireAt + 0.5) {
      hinge.setMotorSpeed(-8);   // かごがわを勢いよくふりあげる（見た目）
      if (!cp.launched) {
        cp.launched = true;
        for (const doll of dolls.values()) {
          const p = doll.torso.position;
          if (Math.abs(p.x - cp.basket[0]) < 1.2 && Math.abs(p.z - cp.basket[2]) < 1.5 && p.y > cp.basket[1] - 0.6 && p.y < cp.basket[1] + 1.9) {
            doll.releaseGrabs();
            p.y += 0.9;                              // うでの円弧から浮かせて干渉をふせぐ
            doll.torso.velocity.set(...cp.vel);      // はねばし・城門のほうへ！
            doll.torso.angularVelocity.setZero();
            doll.torso.wakeUp();
          }
        }
      }
    } else if (cp.fireAt && simT >= cp.fireAt + 0.5) {
      cp.fireAt = 0;
      cp.launched = false;
      cp.readyAt = simT + 6;                         // すこし休んでまた使える
    } else {
      hinge.setMotorSpeed(-clamp((cp.rest - th) * 3, 1.2));   // かまえの角度にもどる
    }
  }

  // ── こわせるかべ: つよい衝撃（衝突リスナーが検知）でくずれたらおしらせ ──
  for (const bw of GIM.breakables) {
    if (bw.hit && !bw.announced) {
      bw.announced = true;
      announce(null, 'thud'); // 効果音のみ
    }
  }
}

/* 水にういた物の浮力（毎固定ステップ・ホストのみ） */
function stepWater() {
  for (const o of dynObjects) {
    const b = o.body;
    if (!o.buoy || !b) continue;
    const h = o.size ? o.size[1] : o.radius * 2;
    const bottom = b.position.y - h / 2;
    if (bottom < WATER_Y) {
      const s = Math.min(1, (WATER_Y - bottom) / Math.max(0.1, h));
      b.wakeUp();
      b.force.y += s * b.mass * -GRAVITY * o.buoy - b.velocity.y * b.mass * 4 * s;
      b.force.x += -b.velocity.x * b.mass * 0.6 * s;
      b.force.z += -b.velocity.z * b.mass * 0.6 * s;
      // ながく浮きっぱなしの物は持ち場へもどす（コースの木箱をなくさない）
      o.wet = (o.wet || 0) + FIXED_DT;
      if (o.wet > 15) {
        b.position.set(...o.home.p);
        b.velocity.setZero();
        b.angularVelocity.setZero();
        b.quaternion.set(0, 0, 0, 1);
        o.wet = 0;
      }
    } else if (o.wet) {
      o.wet = 0;
    }
  }
}

/* 全員へのおしらせ＋効果音（ホストのみ呼ぶ・全ゲストにとどく） */
function announce(text, sound) {
  if (text) showMsg(text);
  if (sound) Sound.play(sound);
  broadcast({ t: 'm', text, s: sound });
}

/* 特定プレイヤーだけへのおしらせ＋効果音（ホストのみ） */
function tellDoll(doll, text, sound) {
  if (doll.id === myId) {
    if (text) showMsg(text);
    if (sound) Sound.play(sound);
  } else {
    const c = guests.get(doll.id);
    if (c) c.send({ t: 'm', text, s: sound });
  }
}

/* ふにゃふにゃ人形（物理） */
class Doll {
  constructor(id, colorIdx) {
    this.id = id;
    this.cp = 0;
    this.goal = false;
    this.limpUntil = 0;
    this.lastJump = 0;
    this.wetMsg = false;
    this.airTime = 0;
    this.prevVy = 0;
    this.armPhase = 0;
    this.staggerUntil = 0;
    this.climbing = false;   // よじ登り補助が効いているか（前ステップの値を移動減衰に使う）
    this.input = { x: 0, z: 0, j: 0, gl: 0, gr: 0, ap: 0 };

    const grp = playerGroup(colorIdx);
    const mask = ~grp;

    // 胴体カプセル（COMは地面から約0.63）
    const torso = new CANNON.Body({
      mass: 4.2,
      material: charMaterial,
      linearDamping: 0.1,
      angularDamping: 0.5,
      collisionFilterGroup: grp,
      collisionFilterMask: mask,
    });
    torso.addShape(new CANNON.Cylinder(0.26, 0.26, 0.7, 10));
    torso.addShape(new CANNON.Sphere(0.26), new CANNON.Vec3(0, 0.35, 0));
    torso.addShape(new CANNON.Sphere(0.26), new CANNON.Vec3(0, -0.35, 0));
    torso.allowSleep = false;
    torso.dollId = id;
    torso.addEventListener('collide', (ev) => {
      const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (v > 8) { this.limpUntil = Math.max(this.limpUntil, simT + 1.0); this.hitSound('thud'); } // つよい衝撃でのびる
    });
    world.addBody(torso);
    this.torso = torso;

    // 手×2（うではバネ＋つかみ用コンストレイント）
    this.sides = [];
    for (const sx of [1, -1]) {   // sides[0]=+x=キャラの左手（背後カメラで画面左）
      const hand = new CANNON.Body({
        mass: 0.3,
        material: handMaterial,
        linearDamping: 0.4,
        collisionFilterGroup: grp,
        collisionFilterMask: mask,
        shape: new CANNON.Sphere(0.12),
      });
      hand.allowSleep = false;
      hand.dollId = id;
      world.addBody(hand);
      this.sides.push({ sx, body: hand, grabC: null, holdC: null, cool: 0, elev: 0.6, avoid: null });
    }

    this.place(false); // ゲーム開始時はチェックポイントに立って開始
  }

  spawnPos(extraY = 0) {
    const cp = CHECKPOINTS[this.cp];
    return new CANNON.Vec3(cp.x + ((this.id % MAX_PLAYERS) - 2) * 0.7, cp.y + extraY, cp.z);
  }

  // 衝突音（連発しないようクールダウン。自分は直接・ほかのプレイヤーはそのゲストへ配信）
  hitSound(name, v) {
    if (simT < (this.sndCool || 0)) return;
    this.sndCool = simT + 0.16;
    if (this.id === myId) Sound.play(name);
    else { const c = guests.get(this.id); if (c) c.send({ t: 'sfx', s: name }); }
  }

  // sky=true でチェックポイントの高い空からラグドールで降ってくる（本家風）
  place(sky) {
    this.releaseGrabs();
    const p = this.spawnPos(sky ? SKY_DROP : 0);
    this.torso.position.copy(p);
    this.torso.velocity.setZero();
    this.torso.quaternion.set(0, 0, 0, 1);
    if (sky) {
      // ラグドールでくるくる回りながら落ちてくる → 着地で起きあがる
      this.torso.angularVelocity.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
      this.limpUntil = simT + SKY_LIMP;
      this.airTime = 1;
    } else {
      this.torso.angularVelocity.setZero();
      this.limpUntil = 0;
      this.airTime = 0;
    }
    this.wetMsg = false;
    for (const s of this.sides) {
      s.body.position.set(p.x + 0.45 * s.sx, p.y, p.z);
      s.body.velocity.setZero();
    }
  }

  respawn() { this.place(true); } // 落下・R復帰は空から降ってくる

  releaseSide(s) {
    if (s.grabC) { world.removeConstraint(s.grabC); s.grabC = null; }
    if (s.holdC) { world.removeConstraint(s.holdC); s.holdC = null; }
    s.cool = simT + 0.22;
  }

  releaseGrabs() {
    for (const s of this.sides) this.releaseSide(s);
  }

  get grabbing() { return this.sides.some((s) => s.grabC); }

  tryGrab(side) {
    const hand = side.body;
    // ボールト（のぼり切り）で自動リリースした直後は、おなじ縁の近傍を掴みなおさない。
    // 掴み入力おしっぱなし/トグルONでも「離す→掴む」を連発せず、登りは1回の掴みで完結する。
    // べつの場所（より上の縁など）を狙う意図的な掛け替えはそのまま可能
    if (side.avoid && simT < side.avoid.until) {
      const a = side.avoid;
      // 0.9m: のぼり切りで乗り上げた縁の上面もふくむ／二段のぼりの次の縁(1.2m上)はふくまない
      if (Math.hypot(hand.position.x - a.x, hand.position.y - a.y, hand.position.z - a.z) < 0.9) return;
    }
    for (const c of world.contacts) {
      let other = null;
      if (c.bi === hand) other = c.bj;
      else if (c.bj === hand) other = c.bi;
      if (!other || other.dollId === this.id) continue;
      // 手 → つかんだ相手
      side.grabC = new CANNON.PointToPointConstraint(
        hand, new CANNON.Vec3(0, 0, 0),
        other, other.pointToLocalFrame(hand.position, new CANNON.Vec3()),
      );
      world.addConstraint(side.grabC);
      // 胴体 → 手（ぶらさがれるように・うでの長さで固定）
      const d = Math.min(0.85, hand.position.distanceTo(this.torso.position));
      side.holdC = new CANNON.DistanceConstraint(this.torso, hand, Math.max(0.4, d));
      world.addConstraint(side.holdC);
      return;
    }
  }

  control() {
    const inp = this.input;
    const torso = this.torso;

    // 接地チェック（自分以外になにか触れているか、下にレイ）
    const from = torso.position;
    const to = new CANNON.Vec3(from.x, from.y - 0.95, from.z);
    const ray = new CANNON.RaycastResult();
    world.raycastClosest(from, to, { collisionFilterGroup: torso.collisionFilterGroup, collisionFilterMask: torso.collisionFilterMask, skipBackfaces: true }, ray);
    const grounded = ray.hasHit;
    // 地面の速度: ベルト=ながれ / 回転床=接線速度（乗った人を一緒にまわす） / それ以外=線速度
    let groundVel = null;
    if (grounded && ray.body) {
      if (ray.body.spin !== undefined) {
        const dx = torso.position.x - ray.body.spinCenter[0];
        const dz = torso.position.z - ray.body.spinCenter[1];
        groundVel = new CANNON.Vec3(-ray.body.spin * dz, 0, ray.body.spin * dx);
      } else {
        groundVel = ray.body.beltVel || ray.body.velocity;
      }
    }
    const hanging = this.grabbing;

    // 着地: 音＋「高速落下→着地」で0.5-1.0秒ラグドール脱力（入力無効・倒れる）→起き上がり
    if (grounded) {
      if (this.airTime > 0.28) {
        this.hitSound('land');
        // 着地のよろけ: 1歩ぶんふらつく（姿勢バネを一時的によわめ＋軽くぐらつかせる）
        this.staggerUntil = simT + 0.35;
        torso.angularVelocity.x += (Math.random() - 0.5) * 1.8;
        torso.angularVelocity.z += (Math.random() - 0.5) * 1.8;
      }
      if (this.prevVy < -HARD_FALL_V && this.airTime > 0.25) {
        this.limpUntil = Math.max(this.limpUntil, simT + LIMP_TIME);
        // ばたっと倒れるよう軽くランダムに回す
        torso.angularVelocity.x += (Math.random() - 0.5) * 4;
        torso.angularVelocity.z += (Math.random() - 0.5) * 4;
        this.hitSound('thud');
      }
      this.airTime = 0;
    } else {
      this.airTime += FIXED_DT;
    }
    const limp = simT < this.limpUntil;

    // トランポリン（重力が軽いぶん初速を補正して以前と同じ高さに）
    if (grounded && ray.body.bouncePad && torso.velocity.y < 2) {
      torso.velocity.y = ray.body.bouncePad * Math.sqrt(-GRAVITY / 18);
    }

    if (!limp) {
      // ── バランス（起き上がりトルク・ばね式でふにゃっとする）
      //    ジャンプ・落下中は30-50%に減衰して「脱力して飛ぶ」
      let posture = (grounded || hanging) ? 1 : AIR_POSTURE;
      if (simT < this.staggerUntil) posture *= 0.45;   // 着地よろけ中はさらに頼りなく
      const bodyUp = torso.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
      const axis = bodyUp.cross(new CANNON.Vec3(0, 1, 0));
      // ばねは柔らかめ（wobbly mess）: ゆらゆらするが平地で転ばない範囲
      torso.torque.x += (axis.x * 115 - torso.angularVelocity.x * 10.5) * posture;
      torso.torque.z += (axis.z * 115 - torso.angularVelocity.z * 10.5) * posture;

      // ── 移動は速度ブレンド方式（力だと摩擦との偶力で倒れてしまう）
      //    加速はゆっくり（最高速まで~0.5秒）・旋回ももっさり
      const gvx = groundVel ? groundVel.x : 0;
      const gvz = groundVel ? groundVel.z : 0;
      const mlen = Math.hypot(inp.x, inp.z);
      if (mlen > 0.15) {
        // 進行方向をむく（ゆっくり旋回）
        const fwd = torso.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
        let d = Math.atan2(inp.x, inp.z) - Math.atan2(fwd.x, fwd.z);
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        torso.torque.y += d * 12 - torso.angularVelocity.y * 3.5;

        const s = Math.min(1, mlen);
        const tvx = gvx + (inp.x / mlen) * WALK_SPEED * s;
        const tvz = gvz + (inp.z / mlen) * WALK_SPEED * s;
        // よじ登り中の移動入力は「体をふる・縁にそって寄る」用に弱く効かせる（暴発加速させない）
        const k = this.climbing ? AIR_ACCEL * 0.5 : (grounded ? WALK_ACCEL : AIR_ACCEL);
        torso.velocity.x += (tvx - torso.velocity.x) * k;
        torso.velocity.z += (tvz - torso.velocity.z) * k;
      } else {
        torso.torque.y += -torso.angularVelocity.y * 3.5;
        if (grounded) {
          // 立ちどまるブレーキ（うごく床の速度にあわせる）
          torso.velocity.x += (gvx - torso.velocity.x) * 0.12;
          torso.velocity.z += (gvz - torso.velocity.z) * 0.12;
        }
      }

      // ── ジャンプ（ぶらさがり中は手をはなして跳ぶ）
      if (inp.j !== this.lastJump) {
        this.lastJump = inp.j;
        if (grounded) torso.velocity.y = JUMP_SPEED;
        else if (hanging) { this.releaseGrabs(); torso.velocity.y = HANG_JUMP; }
      }
    } else {
      this.lastJump = inp.j; // 脱力中のジャンプ入力はすてる
    }

    // ── うで（左右べつべつ）: つかみ中の目標角度＝カメラピッチに1:1連動
    //    可動域 下-30°〜頭上+170°。バネで遅れて追従して「ふにゃ」感を出す
    const vp = Math.min(2.4, Math.max(-1.25, Number.isFinite(+inp.ap) ? +inp.ap : 0)); // 視線の上下(+が上)
    const armTarget = Math.min(2.97, Math.max(-0.52,
      vp >= 0 ? 0.30 + vp * 2.19 : 0.30 + vp * 0.78)); // rad: 見下ろし-30° / 正面~17° / 見上げ170°
    // つかんでいない手は歩行にあわせて前後スイング（物理バネなので遅れ・オーバーシュートが出る）
    const hsp = Math.hypot(torso.velocity.x, torso.velocity.z);
    this.armPhase += hsp * FIXED_DT * 3.4;
    const swing = Math.min(1, hsp / WALK_SPEED) * 0.4;   // 歩行スイング大きめ

    for (const s of this.sides) {
      const hand = s.body;
      const grab = !limp && (s.sx > 0 ? inp.gl : inp.gr);
      s.elev += (armTarget - s.elev) * 0.14; // バネ的な遅れ
      let local;
      if (grab) {
        local = new CANNON.Vec3(0.26 * s.sx, 0.12 + Math.sin(s.elev) * ARM_LEN, Math.cos(s.elev) * ARM_LEN);
      } else {
        const ph = this.armPhase + (s.sx < 0 ? Math.PI : 0);
        local = new CANNON.Vec3(0.42 * s.sx, -0.08, 0.05 + Math.sin(ph) * swing); // 体のよこ＋歩行スイング
      }
      const target = torso.pointToWorldFrame(local, new CANNON.Vec3());
      // 脱力中はうでもだらんとする。通常時もバネ柔らかめ＝大きく遅れて揺れる腕
      const K = limp ? 6 : (grab ? 26 : 17), D = limp ? 1.5 : (grab ? 2.8 : 1.6);
      hand.force.x += (target.x - hand.position.x) * K - hand.velocity.x * D;
      hand.force.y += (target.y - hand.position.y) * K - hand.velocity.y * D - (limp ? 0 : GRAVITY * hand.mass);
      hand.force.z += (target.z - hand.position.z) * K - hand.velocity.z * D;

      // もちはこび補助（腕の筋力）: 木箱くらいの動的オブジェクトを掴んでいる手は
      // 重さの一部を支える（片手=55%・両手=110% → 両手でかかえて持ち上げ・つみ上げができる）。
      // 反作用は胴体へ（=脚でささえる）。これがないと箱ごと空へ浮いてしまう。
      // くさり(軽い)・鉄球や岩(重い)・他プレイヤーは対象外
      if (s.grabC) {
        const held = s.grabC.bodyB;
        if (held.type === CANNON.Body.DYNAMIC && held.dollId === undefined
            && held.mass >= 3 && held.mass <= 12.5) {
          const lift = -GRAVITY * held.mass * 0.55;
          hand.force.y += lift;                 // 拘束ごしに箱へつたわる
          torso.force.y -= lift;                // 反作用（内力なので系ごとは浮かない）
          // 見上げてかかえるときは腕がすこしのびて高くもてる（つみ上げ用）
          if (vp > 0.15 && s.holdC) s.holdC.distance += (0.78 - s.holdC.distance) * 0.02;
          // かかえた箱の暴れをおさえる減衰
          held.force.x -= held.velocity.x * held.mass * 0.35;
          held.force.z -= held.velocity.z * held.mass * 0.35;
          held.force.y -= Math.max(0, held.velocity.y) * held.mass * 0.3;
        }
      }

      // ── 伸びすぎ防止のソフトリミット: 非つかみ手が肩から HAND_REACH を超えたら
      //    超過分だけ引きもどす（急旋回・落下で腕がゴムのように伸びるのを防ぐ。
      //    リミット内の遅れ・揺れはそのまま＝ふにゃふにゃ感は殺さない）
      if (!s.grabC) {
        const sh = torso.pointToWorldFrame(new CANNON.Vec3(0.27 * s.sx, 0.3, 0), new CANNON.Vec3());
        const ox = hand.position.x - sh.x, oy = hand.position.y - sh.y, oz = hand.position.z - sh.z;
        const dist = Math.hypot(ox, oy, oz);
        if (dist > HAND_REACH) {
          const nx = ox / dist, ny = oy / dist, nz = oz / dist;
          const back = (dist - HAND_REACH) * 0.7;   // 超過分の7割をその場で引きもどす
          hand.position.x -= nx * back;
          hand.position.y -= ny * back;
          hand.position.z -= nz * back;
          // 胴体より外向きに逃げる速度成分は打ち消す（手は軽いので反動は無視できる）
          const vr = (hand.velocity.x - torso.velocity.x) * nx
            + (hand.velocity.y - torso.velocity.y) * ny
            + (hand.velocity.z - torso.velocity.z) * nz;
          if (vr > 0) {
            hand.velocity.x -= nx * vr;
            hand.velocity.y -= ny * vr;
            hand.velocity.z -= nz * vr;
          }
        }
      }

      // ── つかむ / はなす（手ごとに独立 → 片手ずつ掛け替えて登れる）
      if (grab) {
        if (!s.grabC && simT > s.cool) this.tryGrab(s);
      } else if (s.grabC) {
        this.releaseSide(s);
      }
    }

    // ── よじのぼり（本家式・完全にプレイヤー入力駆動）:
    //    上を見て掴む → 「下を見る × 前進入力」の間だけ じわじわ体が持ち上がる。
    //    入力を離すと力は即ゼロ（慣性のみ残る）→ ぶら下がりにもどる。自動では登らない
    this.climbing = false;
    if (!limp) {
      const pull = Math.min(1, Math.max(0, (0.15 - vp) / 0.85)); // 下をむくほど1（vp<0.15で効きはじめ）
      let fx, fz;
      const ml = Math.hypot(inp.x, inp.z);
      if (ml > 0.15) { fx = inp.x / ml; fz = inp.z / ml; }
      else { const f = torso.quaternion.vmult(new CANNON.Vec3(0, 0, 1)); fx = f.x; fz = f.z; }
      // 駆動 = カメラ下向き度 × 前進入力の強さ。どちらかが無ければ 0 ＝ 登らない
      const drive = pull * (ml > 0.15 ? Math.min(1, ml) : 0);
      for (const s of this.sides) {
        if (!s.grabC || !s.holdC) continue;
        // 動的オブジェクト（木箱・岩・他プレイヤーなど）を掴んでいるあいだは
        // よじのぼり補助をかけない（箱を動かすときに体が箱へ引っ張られてガクつくのを防ぐ）。
        // 補助（引き寄せ力・ホールド調整・乗り上げ）は静的な壁・キネマティック床のみ
        const held = s.grabC.bodyB;
        if (held.type === CANNON.Body.DYNAMIC) continue;
        const hp = s.body.position;
        const hy = hp.y;
        if (hy > torso.position.y - 1.0) {           // つかまり中〜乗り上げ中（体が手+1.0上まで）
          this.climbing = true;
          const rise = torso.position.y - hy;                // 縁(手)にたいする体の高さ
          const vault = drive > 0.25 && rise > -0.45;        // 乗り上げも入力継続が条件
          if (vault) {
            // 乗り上げ中はロープをくり出すように駆動量に比例して距離をのばす（~0.7m/s・上限0.85）。
            // 距離一致型の拘束なので「のばした分だけ」体が縁の上へ動ける＝入力がなければのびない
            s.holdC.distance = Math.min(0.85, s.holdC.distance + 0.012 * drive);
          } else {
            // ホールド距離: 駆動中だけ じわじわ短く（もっさり）。入力をやめると0.72へもどる＝ぶら下がり
            const targetDist = 0.72 - drive * 0.5;
            s.holdC.distance += (targetDist - s.holdC.distance) * (0.03 + 0.05 * drive);
          }
          if (drive > 0.05 && torso.velocity.y < 0.6 && rise < 0.1) {
            // 拘束点方向への引き寄せ（駆動量に比例・上限クランプ・上昇0.6m/sまで＝もっさり）
            const dx = hp.x - torso.position.x, dy = hy - torso.position.y, dz = hp.z - torso.position.z;
            const dl = Math.hypot(dx, dy, dz) || 1;
            const F = Math.min(torso.mass * -GRAVITY * (0.4 + 1.1 * drive), torso.mass * 24);
            torso.force.x += (dx / dl) * F * 0.5;
            torso.force.y += Math.max(0.25, dy / dl) * F;
            torso.force.z += (dz / dl) * F * 0.5;
          }
          if (vault) {
            // 上へ: 駆動量に比例（上昇0.8m/sまで→1ステップ~1cm＝すり抜けない）。入力をやめれば止まる
            if (rise < 0.8 && torso.velocity.y < 0.8) {
              torso.force.y += torso.mass * -GRAVITY * 1.6 * drive;
            }
            // 前へ: 縁をこえるほど強く・駆動量に比例（前進1.3m/sまで）
            const fSpd = torso.velocity.x * fx + torso.velocity.z * fz;
            if (fSpd < 1.3) {
              const push = torso.mass * (5 + 8 * Math.min(1, Math.max(0, rise + 0.25))) * drive;
              torso.force.x += fx * push;
              torso.force.z += fz * push;
            }
            // 体の下端が縁をこえたら手をはなす（勢いはそのまま＝連続運動で縁の上に着地）。
            // 直後はこの縁の近傍への再グラブを抑止（tryGrab側で判定）→ 掴みなおし連発を防ぐ
            if (rise > 0.72) {
              s.avoid = { x: hp.x, y: hy, z: hp.z, until: simT + 1.5 };
              this.releaseSide(s);
              s.cool = simT + 0.6;
            }
          }
        }
      }
    }

    this.prevVy = torso.velocity.y; // 着地時の落下速度判定用（step前の速度）
  }

  removeFromWorld() {
    this.releaseGrabs();
    world.removeBody(this.torso);
    for (const s of this.sides) world.removeBody(s.body);
  }
}

/* =====================================================================
   入力（キーボード・マウス・タッチ）
   ===================================================================== */
const keys = new Set();
let jumpCount = 0;
let mouseGrabL = false, mouseGrabR = false, keyGrab = false, touchGrabL = false, touchGrabR = false;
// カメラ: camPitch はカメラの高さ角（＋＝上から見下ろし）。視線ピッチは -camPitch
const PITCH_MIN = -1.22, PITCH_MAX = 1.05;   // 見上げ+70° 〜 見下ろし-60°
let camYaw = Math.PI, camPitch = 0.22, camDist = 4.2;
let touchArmOff = 0;   // モバイル: ✊ボタン上下ドラッグ＝うでの高さオフセット（カメラと独立）
const stickVec = { x: 0, y: 0 };

window.addEventListener('keydown', (e) => {
  if (state !== 'play' || e.repeat) { if (e.code === 'Space' && state === 'play') e.preventDefault(); return; }
  keys.add(e.code);
  if (e.code === 'Space') { jumpCount++; Sound.play('jump'); e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (!keyGrab) Sound.play('grab'); keyGrab = true; }
  if (e.code === 'KeyR') requestRespawn();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keyGrab = false;
});
window.addEventListener('blur', () => { keys.clear(); keyGrab = false; mouseGrabL = false; mouseGrabR = false; });

// マウス: 左長押し=左手 / 右長押し=右手。PCはPointer Lock（クリックでロック・Escで解除）
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') { touchCamStart(e); return; }
  if (state === 'play' && !IS_TOUCH && !document.pointerLockElement && canvas.requestPointerLock) {
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { /* 非対応・拒否でもドラッグ操作で遊べる */ });
    } catch (err) { /* 同上 */ }
  }
  if (e.button === 0 && !mouseGrabL) { mouseGrabL = true; if (state === 'play') Sound.play('grab'); }
  if (e.button === 2 && !mouseGrabR) { mouseGrabR = true; if (state === 'play') Sound.play('grab'); }
  if (!document.pointerLockElement) canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') { touchCamMove(e); return; }
  // ロック中はマウス移動＝カメラ。未ロック時はドラッグでカメラ（フォールバック）
  if (document.pointerLockElement === canvas || e.buttons) {
    camYaw -= e.movementX * 0.0032;
    camPitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, camPitch + e.movementY * 0.0032));
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') { touchCamEnd(e); return; }
  if (e.button === 0) mouseGrabL = false;
  if (e.button === 2) mouseGrabR = false;
});
canvas.addEventListener('wheel', (e) => {
  camDist = Math.min(6.5, Math.max(3.2, camDist * (e.deltaY > 0 ? 1.1 : 0.9)));
  e.preventDefault();
}, { passive: false });

// タッチカメラ（右半面をふくむキャンバス上のスワイプ）
let camTouchId = null, camTouchLast = null;
function touchCamStart(e) { if (camTouchId === null) { camTouchId = e.pointerId; camTouchLast = { x: e.clientX, y: e.clientY }; } }
function touchCamMove(e) {
  if (e.pointerId !== camTouchId) return;
  camYaw -= (e.clientX - camTouchLast.x) * 0.006;
  camPitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, camPitch + (e.clientY - camTouchLast.y) * 0.006));
  camTouchLast = { x: e.clientX, y: e.clientY };
}
function touchCamEnd(e) { if (e.pointerId === camTouchId) camTouchId = null; }

// バーチャルスティック
const stickEl = $('stick'), knobEl = $('stick-knob');
let stickId = null;
function setStick(e) {
  const r = stickEl.getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const len = Math.hypot(dx, dy) || 1;
  const cl = Math.min(1, len);
  stickVec.x = (dx / len) * cl;
  stickVec.y = (dy / len) * cl;
  knobEl.style.transform = `translate(calc(-50% + ${stickVec.x * 36}px), calc(-50% + ${stickVec.y * 36}px))`;
}
stickEl.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); setStick(e); });
stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) setStick(e); });
function stickEnd(e) {
  if (e.pointerId !== stickId) return;
  stickId = null;
  stickVec.x = stickVec.y = 0;
  knobEl.style.transform = 'translate(-50%, -50%)';
}
stickEl.addEventListener('pointerup', stickEnd);
stickEl.addEventListener('pointercancel', stickEnd);

// タッチボタン。✊はトグル式: タップでつかむ→もういちどタップではなす。
// ✊✊りょうて=両手を一括オン/オフ。左右ペアのまんなか押しも両手あつかい。
// どのボタンも触れたまま上下ドラッグ=うでの高さ（ドラッグしてもトグルは解除されない）
const tJump = $('t-jump');
const grabPair = $('t-grab-pair'), tGrabL = $('t-grab-l'), tGrabR = $('t-grab-r'), tGrabB = $('t-grab-b');
tJump.addEventListener('pointerdown', (e) => { e.preventDefault(); jumpCount++; Sound.play('jump'); });
const grabPtrs = new Map();   // pointerId → {l, r, wasOff, x0, y0, moved}
function syncGrabButtons() {
  tGrabL.classList.toggle('on', touchGrabL);
  tGrabR.classList.toggle('on', touchGrabR);
  tGrabB.classList.toggle('on', touchGrabL && touchGrabR);
}
function setTouchGrab(l, r, on) {
  if (l) touchGrabL = on;
  if (r) touchGrabR = on;
  syncGrabButtons();
}
// リスポーン・脱力などの強制解除でトグルとハイライトを確実にもどす
function clearTouchGrabs() {
  if (!touchGrabL && !touchGrabR) return;
  touchGrabL = touchGrabR = false;
  touchArmOff = 0;
  syncGrabButtons();
}
function grabPointerDown(e, l, r) {
  e.preventDefault();
  // 対象の手がすでにオンなら「はなすためのタップ」候補（ドラッグなら離さない）
  const wasOff = !((l && touchGrabL) || (r && touchGrabR));
  if (wasOff) { setTouchGrab(l, r, true); Sound.play('grab'); }
  grabPtrs.set(e.pointerId, { l, r, wasOff, x0: e.clientX, y0: e.clientY, moved: 0 });
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 非対応でもOK */ }
}
grabPair.addEventListener('pointerdown', (e) => {
  const rect = grabPair.getBoundingClientRect();
  const fx = (e.clientX - rect.left) / Math.max(1, rect.width);
  // 左よりの押し=左手 / 右より=右手 / まんなかのつなぎ目=両手（親指1本で両方おせる）
  grabPointerDown(e, fx < 0.56, fx > 0.44);
});
tGrabB.addEventListener('pointerdown', (e) => grabPointerDown(e, true, true));
const grabPointerMove = (e) => {
  const g = grabPtrs.get(e.pointerId);
  if (!g) return;
  g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.x0, e.clientY - g.y0));
  // 上へドラッグ＝うでを上げる / 下へドラッグ＝下げる（カメラピッチとは独立のオフセット）
  touchArmOff = Math.min(1.7, Math.max(-0.9, (g.y0 - e.clientY) / 90));
};
const grabPointerEnd = (e) => {
  const g = grabPtrs.get(e.pointerId);
  if (!g) return;
  grabPtrs.delete(e.pointerId);
  // すでにオンだった手を（ドラッグせず）タップした → はなす
  if (!g.wasOff && g.moved < 14) setTouchGrab(g.l, g.r, false);
  if (grabPtrs.size === 0) touchArmOff = 0; // 高さオフセットだけリセット（つかみは保持）
};
for (const el of [grabPair, tGrabB]) {
  el.addEventListener('pointermove', grabPointerMove);
  el.addEventListener('pointerup', grabPointerEnd);
  el.addEventListener('pointercancel', grabPointerEnd);
}

if ('ontouchstart' in window) touchEl.classList.remove('hidden');

// ダブルタップズームの防止（iOS Safari は user-scalable=no を無視するため保険）
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  // みじかい間かくの2回目のタップは、ボタン等の操作でなければ標準動作(ズーム)を止める
  if (now - lastTouchEnd < 350 && !e.target.closest('button, input, a')) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, { passive: false });
// ピンチや2本指ズームも止める（iOS）
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

// カメラ基準のワールド移動ベクトルをつくる
function localInput() {
  let ix = 0, iy = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iy += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iy -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  ix += stickVec.x;
  iy += -stickVec.y;
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw); // カメラの前方向
  const rx = -fz, rz = fx;                              // 右方向
  let x = fx * iy + rx * ix;
  let z = fz * iy + rz * ix;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return {
    x: r2(x), z: r2(z), j: jumpCount,
    gl: (mouseGrabL || keyGrab || touchGrabL) ? 1 : 0,   // 左手（Shift=両手）
    gr: (mouseGrabR || keyGrab || touchGrabR) ? 1 : 0,   // 右手
    ap: r2(-camPitch + touchArmOff),    // 視線ピッチ(+上)＋モバイルの腕オフセット → うでの高さ
  };
}

/* =====================================================================
   ネットワーク（PeerJS / ?local=1でBroadcastChannel）
   ===================================================================== */
function loadPeerJs() {
  if (window.Peer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './lib/peerjs.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

let netHandle = null; // {close}

// ── ホスト側: hooks {onReady(code), onConn(conn), onError(type)}
//    conn = {send, close, onMsg, onClose}
function hostOpen(code, hooks) {
  if (LOCAL_NET) {
    const bc = new BroadcastChannel('hff-' + code);
    const conns = new Map();
    bc.onmessage = (ev) => {
      const { from, to, d } = ev.data || {};
      if (to !== 'H' || !from) return;
      let c = conns.get(from);
      if (!c) {
        c = { send: (o) => bc.postMessage({ from: 'H', to: from, d: o }), close: () => {}, onMsg: null, onClose: null };
        conns.set(from, c);
        hooks.onConn(c);
      }
      if (d && c.onMsg) c.onMsg(d);
    };
    netHandle = { close: () => bc.close() };
    setTimeout(() => hooks.onReady(code), 30);
    return;
  }
  loadPeerJs().then(() => {
    const peer = new Peer('hff-' + code);
    peer.on('open', () => hooks.onReady(code));
    peer.on('connection', (c) => {
      const conn = {
        send: (o) => { try { c.send(o); } catch (e) { /* 切断間際は無視 */ } },
        close: () => { try { c.close(); } catch (e) { /* 同上 */ } },
        onMsg: null, onClose: null,
      };
      c.on('data', (d) => { if (conn.onMsg) conn.onMsg(d); });
      c.on('close', () => { if (conn.onClose) conn.onClose(); });
      hooks.onConn(conn);
    });
    peer.on('error', (e) => hooks.onError(e.type));
    netHandle = { close: () => { try { peer.destroy(); } catch (e) { /* 破棄済みなら無視 */ } } };
  }).catch(() => hooks.onError('load'));
}

// ── ゲスト側: hooks {onOpen(conn), onMsg(d), onClose, onError(type)}
function guestOpen(code, hooks) {
  if (LOCAL_NET) {
    const uid = Math.random().toString(36).slice(2, 8);
    const bc = new BroadcastChannel('hff-' + code);
    const conn = {
      send: (o) => { try { bc.postMessage({ from: uid, to: 'H', d: o }); } catch (e) { /* クローズ済みなら無視 */ } },
      close: () => bc.close(),
    };
    bc.onmessage = (ev) => {
      const { from, to, d } = ev.data || {};
      if (to === uid && from === 'H') hooks.onMsg(d);
    };
    netHandle = { close: () => bc.close() };
    setTimeout(() => hooks.onOpen(conn), 30);
    return;
  }
  loadPeerJs().then(() => {
    const peer = new Peer();
    peer.on('open', () => {
      const c = peer.connect('hff-' + code, { reliable: true });
      c.on('open', () => hooks.onOpen({
        send: (o) => { try { c.send(o); } catch (e) { /* 切断間際は無視 */ } },
        close: () => { try { c.close(); } catch (e) { /* 同上 */ } try { peer.destroy(); } catch (e) { /* 同上 */ } },
      }));
      c.on('data', hooks.onMsg);
      c.on('close', hooks.onClose);
    });
    peer.on('error', (e) => hooks.onError(e.type));
    netHandle = { close: () => { try { peer.destroy(); } catch (e) { /* 破棄済みなら無視 */ } } };
  }).catch(() => hooks.onError('load'));
}

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/* =====================================================================
   ゲーム進行
   ===================================================================== */
let state = 'menu';      // 'menu' | 'play'
let isHost = false;
let myId = 0;
let roomCode = null;

const metas = new Map();   // id → {id, name, color, goal}
const rigs = new Map();    // id → Rig
const dolls = new Map();   // id → Doll（ホストのみ）
const guests = new Map();  // id → conn（ホストのみ）
let hostConn = null;       // ゲストのみ
let nextId = 1;
let inputTimer = 0;

// ゲスト側スナップショットバッファ
let snaps = [];

function metaList() {
  return [...metas.values()].map((m) => ({ id: m.id, name: m.name, skin: m.skin, goal: m.goal }));
}

function updatePlayersHud() {
  hudPlayersEl.innerHTML = '';
  for (const m of metas.values()) {
    const row = document.createElement('div');
    row.className = 'prow';
    const dot = document.createElement('span');
    dot.className = 'pdot';
    dot.style.background = '#' + SKIN_COLORS[normSkin(m.skin).c].toString(16).padStart(6, '0');
    row.appendChild(dot);
    row.appendChild(document.createTextNode((m.goal ? '🏁 ' : '') + m.name + (m.id === myId ? '（あなた）' : '')));
    hudPlayersEl.appendChild(row);
  }
}

function addMetaAndRig(m) {
  metas.set(m.id, { ...m, skin: normSkin(m.skin) });
  rigs.set(m.id, new Rig(m.skin, m.name));
}

function removePlayer(id) {
  const rig = rigs.get(id);
  if (rig) rig.dispose();
  rigs.delete(id);
  metas.delete(id);
  if (isHost) {
    const doll = dolls.get(id);
    if (doll) doll.removeFromWorld();
    dolls.delete(id);
    guests.delete(id);
  }
}

function enterPlay() {
  state = 'play';
  disposePreview();
  panelEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  updatePlayersHud();
  // プレイ中の解説ポップアップは出さない（操作説明はメニューの .help にまとまっている）
  Sound.startAmbient(courseIdx);
}

function requestRespawn() {
  if (state !== 'play') return;
  clearTouchGrabs();   // リスポーンでモバイルのつかみトグルも解除
  if (isHost) { const d = dolls.get(myId); if (d) d.respawn(); }
  else if (hostConn) hostConn.send({ t: 'rs' });
}

/* ── ホスト（ソロ含む） ── */
function startHostGame(withRoom) {
  isHost = true;
  myId = 0;
  nextId = 1;
  saveProfile();
  buildLevel(courseSel);
  initPhysics();
  addMetaAndRig({ id: 0, name: getPlayerName(), skin: mySkin, goal: false });
  dolls.set(0, new Doll(0, 0));

  if (withRoom) {
    roomCode = String(1000 + Math.floor(Math.random() * 9000));
    netStatus('ルームを準備中…');
    hostOpen(roomCode, {
      onReady: () => {
        hudCodeEl.textContent = roomCode;
        hudRoomEl.classList.remove('hidden');
        enterPlay();
        showMsg(`🔑 コード「${roomCode}」を友だちに伝えてね`, 4000);
      },
      onConn: (conn) => wireGuest(conn),
      onError: (type) => {
        if (state === 'menu') {
          netStatus(type === 'unavailable-id' ? 'コードが使用中です。もう一度作成してください' : '接続エラーが発生しました（' + type + '）');
        }
      },
    });
  } else {
    enterPlay();
  }
}

function wireGuest(conn) {
  let pid = null;
  conn.onMsg = (m) => {
    if (!m || !m.t) return;
    if (m.t === 'join' && pid === null) {
      if (metas.size >= MAX_PLAYERS) { conn.send({ t: 'full' }); return; }
      pid = nextId++;
      const name = (m.name || '').slice(0, 8) || 'ゲスト' + pid;
      addMetaAndRig({ id: pid, name, skin: normSkin(m.skin), goal: false });
      dolls.set(pid, new Doll(pid, pid % MAX_PLAYERS));
      guests.set(pid, conn);
      conn.send({ t: 'welcome', id: pid, course: courseIdx, players: metaList() });
      broadcast({ t: 'players', players: metaList() }, pid);
      updatePlayersHud();
      showMsg(`👋 ${name} が参加した！（${metas.size}/${MAX_PLAYERS}人）`);
      Sound.play('join');
    } else if (m.t === 'i' && pid !== null) {
      const doll = dolls.get(pid);
      if (doll) {
        doll.input = {
          x: +m.x || 0, z: +m.z || 0, j: +m.j || 0,
          gl: m.gl ? 1 : 0, gr: m.gr ? 1 : 0,
          ap: Number.isFinite(+m.ap) ? +m.ap : 0,
        };
      }
    } else if (m.t === 'rs' && pid !== null) {
      const doll = dolls.get(pid);
      if (doll) doll.respawn();
    } else if (m.t === 'bye') {
      dropGuest();
    }
  };
  conn.onClose = () => dropGuest();
  function dropGuest() {
    if (pid === null) return;
    const name = metas.get(pid) ? metas.get(pid).name : '';
    removePlayer(pid);
    pid = null;
    broadcast({ t: 'players', players: metaList() });
    updatePlayersHud();
    if (name) showMsg(`👋 ${name} が退出しました`);
  }
}

function broadcast(obj, exceptId = -1) {
  for (const [id, conn] of guests) {
    if (id !== exceptId) conn.send(obj);
  }
}

/* ── ゲスト ── */
function startJoin() {
  const code = codeInput.value.trim();
  if (!/^\d{4}$/.test(code)) { netStatus('4けたのコードを入力してね'); return; }
  saveProfile();
  roomCode = code;
  netStatus('接続中…');
  guestOpen(code, {
    onOpen: (conn) => {
      hostConn = conn;
      conn.send({ t: 'join', name: getPlayerName(), skin: mySkin });
    },
    onMsg: onGuestMsg,
    onClose: () => hostGone(),
    onError: (type) => {
      if (type === 'peer-unavailable') netStatus('そのコードのルームが見つかりません');
      else netStatus('接続エラーが発生しました（' + type + '）');
    },
  });
}

function onGuestMsg(m) {
  if (!m || !m.t) return;
  if (m.t === 'welcome') {
    isHost = false;
    myId = m.id;
    if (typeof m.course === 'number' && COURSES[m.course]) buildLevel(m.course); // ホストのコースにあわせる
    for (const pm of m.players) addMetaAndRig(pm);
    hudCodeEl.textContent = roomCode;
    hudRoomEl.classList.remove('hidden');
    enterPlay();
    Sound.play('join');
    inputTimer = setInterval(() => { if (hostConn) hostConn.send({ t: 'i', ...localInput() }); }, INPUT_MS);
  } else if (m.t === 'full') {
    netStatus('ルームは満員です（5人まで）');
  } else if (m.t === 'players') {
    const seen = new Set();
    for (const pm of m.players) {
      seen.add(pm.id);
      if (!metas.has(pm.id)) addMetaAndRig(pm);
      else metas.get(pm.id).goal = pm.goal;
    }
    for (const id of [...metas.keys()]) if (!seen.has(id)) removePlayer(id);
    updatePlayersHud();
  } else if (m.t === 's') {
    snaps.push({ rt: performance.now(), p: m.p, o: m.o });
    if (snaps.length > 6) snaps.shift();
  } else if (m.t === 'goal') {
    if (metas.has(m.id)) metas.get(m.id).goal = true;
    updatePlayersHud();
    showMsg(`🎉 ${m.name} が ゴール！`, 3200);
    Sound.play('goal');
  } else if (m.t === 'm') {
    if (m.text) showMsg(m.text);
    if (m.s) Sound.play(m.s);
  } else if (m.t === 'sfx') {
    Sound.play(m.s);
  } else if (m.t === 'bye') {
    hostGone();
  }
}

function hostGone() {
  if (state !== 'play' || isHost) return;
  showMsg('ホストが退出しました。メニューにもどります…', 2400);
  setTimeout(() => location.reload(), 2400);
}

/* ── 退出 ── */
$('hud-leave').addEventListener('click', () => {
  clearInterval(inputTimer);
  if (isHost) broadcast({ t: 'bye' });
  else if (hostConn) hostConn.send({ t: 'bye' });
  if (netHandle) { try { netHandle.close(); } catch (e) { /* 破棄済みなら無視 */ } }
  setTimeout(() => location.reload(), 120);
});
$('hud-respawn').addEventListener('click', requestRespawn);
$('hud-fs').addEventListener('click', () => {
  const el = document.getElementById('wrap');
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => { /* iPhoneのSafariなどは非対応 */ });
  }
});

/* ── サウンドON/OFF（メニューとHUDの両方） ── */
function updateMuteButtons() {
  const on = !Sound.isMuted();
  for (const id of ['menu-mute', 'hud-mute']) {
    const b = $(id);
    if (b) b.textContent = on ? '🔊' : '🔇';
  }
}
function toggleMute() {
  Sound.setMuted(!Sound.isMuted());
  if (!Sound.isMuted()) { Sound.play('click'); if (state === 'play') Sound.startAmbient(courseIdx); }
  updateMuteButtons();
}
$('menu-mute').addEventListener('click', toggleMute);
$('hud-mute').addEventListener('click', toggleMute);
updateMuteButtons();

/* ── メニューボタン ── */
$('solo-btn').addEventListener('click', () => { Sound.play('click'); startHostGame(false); });
$('host-btn').addEventListener('click', () => { Sound.play('click'); startHostGame(true); });
$('join-btn').addEventListener('click', () => { Sound.play('click'); startJoin(); });

/* =====================================================================
   毎フレーム処理
   ===================================================================== */
let phyAcc = 0;
let lastSnapSent = 0;
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function hostStep(dt, now) {
  const myDoll = dolls.get(myId);
  if (myDoll) myDoll.input = localInput();

  phyAcc = Math.min(phyAcc + dt, 0.2);
  while (phyAcc >= FIXED_DT) {
    simT += FIXED_DT;
    stepGimmicks();
    for (const doll of dolls.values()) doll.control();
    world.step(FIXED_DT);
    phyAcc -= FIXED_DT;
  }

  // 落下・チェックポイント・ゴール判定
  for (const doll of dolls.values()) {
    const p = doll.torso.position;
    // 落ちたら海に落ちる前にチェックポイントからやり直し
    if (p.y < RESPAWN_Y) {
      doll.respawn();
      continue;
    }
    for (const zn of CP_ZONES) {
      if (zn.cp > doll.cp && p.x > zn.x0 && p.x < zn.x1 && p.z > zn.z0 && p.z < zn.z1 && p.y > zn.yMin && p.y < zn.yMin + 5) {
        doll.cp = zn.cp;
        tellDoll(doll, null, 'checkpoint'); // 効果音のみ
      }
    }
    if (!doll.goal && p.x > GOAL.x0 && p.x < GOAL.x1 && p.z > GOAL.z0 && p.y > GOAL.y) {
      doll.goal = true;
      const meta = metas.get(doll.id);
      meta.goal = true;
      updatePlayersHud();
      showMsg(`🎉 ${meta.name} が ゴール！`, 3200);
      Sound.play('goal');
      broadcast({ t: 'goal', id: doll.id, name: meta.name });
    }
  }

  // 落ちた物の復活（ヒンジでつながれた物はおちない）
  for (const o of dynObjects) {
    if (o.body && !o.kinematic && !o.hinge && o.kind !== 'platform' && o.body.position.y < FALL_Y) {
      o.body.position.set(...o.home.p);
      o.body.velocity.setZero();
      o.body.angularVelocity.setZero();
      if (o.home.q) o.body.quaternion.set(...o.home.q);
      else o.body.quaternion.set(0, 0, 0, 1);
    }
  }

  // 物理 → 見た目
  for (const [id, doll] of dolls) {
    const rig = rigs.get(id);
    if (!rig) continue;
    const limpNow = simT < doll.limpUntil;
    if (id === myId && limpNow) clearTouchGrabs();   // 脱力＝強制はなす。トグルも解除
    const t = doll.torso;
    rig.setPose(
      t.position, t.quaternion,
      [doll.sides[0].body.position.x, doll.sides[0].body.position.y, doll.sides[0].body.position.z],
      [doll.sides[1].body.position.x, doll.sides[1].body.position.y, doll.sides[1].body.position.z],
      (doll.input.gl ? 1 : 0) | (doll.input.gr ? 2 : 0) | (limpNow ? 4 : 0), dt,
    );
  }
  for (const o of dynObjects) {
    if (!o.body) continue;
    o.mesh.position.copy(o.body.position);
    o.mesh.quaternion.copy(o.body.quaternion);
  }

  // 配信
  if (guests.size && now - lastSnapSent > SNAP_MS) {
    lastSnapSent = now;
    const p = [];
    for (const [id, doll] of dolls) {
      const t = doll.torso, hl = doll.sides[0].body.position, hr = doll.sides[1].body.position;
      p.push([
        id,
        r2(t.position.x), r2(t.position.y), r2(t.position.z),
        r3(t.quaternion.x), r3(t.quaternion.y), r3(t.quaternion.z), r3(t.quaternion.w),
        r2(hl.x), r2(hl.y), r2(hl.z),
        r2(hr.x), r2(hr.y), r2(hr.z),
        // フラグ: bit0=左手 bit1=右手 bit2=脱力（ゲストの見た目リグ用）
        (doll.input.gl ? 1 : 0) | (doll.input.gr ? 2 : 0) | (simT < doll.limpUntil ? 4 : 0),
      ]);
    }
    const o = dynObjects.map((ob) => [
      r2(ob.body.position.x), r2(ob.body.position.y), r2(ob.body.position.z),
      r3(ob.body.quaternion.x), r3(ob.body.quaternion.y), r3(ob.body.quaternion.z), r3(ob.body.quaternion.w),
    ]);
    broadcast({ t: 's', p, o });
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

function guestStep(now) {
  if (snaps.length === 0) return;
  const rt = now - INTERP_DELAY;
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) {
    if (snaps[i].rt <= rt && rt <= snaps[i + 1].rt) { a = snaps[i]; b = snaps[i + 1]; break; }
  }
  if (rt > b.rt) a = b;
  const t = a === b ? 1 : Math.min(1, Math.max(0, (rt - a.rt) / (b.rt - a.rt)));

  const dtRig = Math.max(0.001, (b.rt - a.rt) / 1000) * (a === b ? 0 : 1) || 0.016;
  const aMap = new Map(a.p.map((e) => [e[0], e]));
  for (const eb of b.p) {
    const id = eb[0];
    const rig = rigs.get(id);
    if (!rig) continue;
    const ea = aMap.get(id) || eb;
    if (id === myId && (eb[14] & 4)) clearTouchGrabs();   // 自分が脱力＝モバイルのつかみトグルも解除
    const px = lerp(ea[1], eb[1], t), py = lerp(ea[2], eb[2], t), pz = lerp(ea[3], eb[3], t);
    _q1.set(ea[4], ea[5], ea[6], ea[7]);
    _q2.set(eb[4], eb[5], eb[6], eb[7]);
    _q1.slerp(_q2, t);
    rig.setPose(
      { x: px, y: py, z: pz }, _q1,
      [lerp(ea[8], eb[8], t), lerp(ea[9], eb[9], t), lerp(ea[10], eb[10], t)],
      [lerp(ea[11], eb[11], t), lerp(ea[12], eb[12], t), lerp(ea[13], eb[13], t)],
      eb[14] | 0, dtRig,
    );
  }
  for (let i = 0; i < dynObjects.length; i++) {
    const oa = a.o[i], ob = b.o[i];
    if (!oa || !ob) continue;
    const mesh = dynObjects[i].mesh;
    mesh.position.set(lerp(oa[0], ob[0], t), lerp(oa[1], ob[1], t), lerp(oa[2], ob[2], t));
    _q1.set(oa[3], oa[4], oa[5], oa[6]);
    _q2.set(ob[3], ob[4], ob[5], ob[6]);
    _q1.slerp(_q2, t);
    mesh.quaternion.copy(_q1);
  }
}

/* カメラ: ピボット=胸〜頭(地上高~1.4m)・距離3.5-4.5m・指数スムージング・壁めり込み回避 */
const camTargetSm = new THREE.Vector3(0, 1.4, 0);
const _camPivot = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camRay = new THREE.Raycaster();
function updateCam(dt) {
  const rig = rigs.get(myId);
  if (!rig) return;
  // ピボットは指数スムージング（ラグドールの細かい揺れを拾いすぎない）
  _camPivot.copy(rig.group.position);
  _camPivot.y += 0.75; // 胴中心(~0.65m)+0.75 ≒ 地上高1.4m
  camTargetSm.lerp(_camPivot, 1 - Math.exp(-(dt || 0.016) * 9));
  const cp = Math.cos(camPitch), spitch = Math.sin(camPitch);
  _camDir.set(Math.sin(camYaw) * cp, spitch, Math.cos(camYaw) * cp); // ピボット→カメラ方向（単位）
  // 壁にめり込まないようレイキャストして距離を詰める
  let dist = camDist;
  _camRay.set(camTargetSm, _camDir);
  _camRay.far = camDist + 0.3;
  const hits = _camRay.intersectObjects(levelRoot.children, true);
  if (hits.length) dist = Math.max(0.6, Math.min(dist, hits[0].distance - 0.25));
  camera.position.set(
    camTargetSm.x + _camDir.x * dist,
    camTargetSm.y + _camDir.y * dist,
    camTargetSm.z + _camDir.z * dist,
  );
  camera.lookAt(camTargetSm);
}

function menuCam(now) {
  const t = now * 0.00012;
  const cc = COURSES[courseIdx] ? COURSES[courseIdx].cam : { x: 0, z: 30, r: 32 };
  camera.position.set(cc.x + Math.sin(t) * cc.r, 14, cc.z + Math.cos(t) * cc.r);
  camera.lookAt(cc.x, 1.5, cc.z);
  updatePreview(now);
}

/* ===== メニューのスキンプレビュー（カメラの右前にういて回る） ===== */
let previewRig = null;
function refreshPreview() {
  if (state !== 'menu') return;
  if (previewRig) previewRig.dispose();
  previewRig = new Rig(mySkin, getPlayerName());
}
function disposePreview() {
  if (previewRig) { previewRig.dispose(); previewRig = null; }
}
const _pv1 = new THREE.Vector3(), _pv2 = new THREE.Vector3(), _pvQ = new THREE.Quaternion(), _pvM = new THREE.Matrix4();
function updatePreview(now) {
  if (!previewRig) return;
  camera.updateMatrixWorld();
  camera.getWorldDirection(_pv1);                       // 前方向
  _pv2.crossVectors(_pv1, UP).normalize();              // 右方向
  const pos = _pv1.multiplyScalar(4.2).add(camera.position).addScaledVector(_pv2, 2.1);
  pos.y = camera.position.y - 2.1;
  _pvQ.setFromAxisAngle(UP, now * 0.0012);              // ゆっくり回る
  _pvM.compose(pos, _pvQ, new THREE.Vector3(1, 1, 1));
  const hl = new THREE.Vector3(-0.45, -0.1, 0.05).applyMatrix4(_pvM);
  const hr = new THREE.Vector3(0.45, -0.1, 0.05).applyMatrix4(_pvM);
  previewRig.setPose(pos, _pvQ, [hl.x, hl.y, hl.z], [hr.x, hr.y, hr.z], false, 0);
}
refreshPreview();

/* ワイヤー・ロープの見た目を2点間に張りなおす（ホスト/ゲスト共通）
   端点は [x,y,z]（固定点）/ 数値（dynObjects index）/ {i, off}（物のローカル点） */
const _rodV1 = new THREE.Vector3(), _rodV2 = new THREE.Vector3();
function rodEnd(e, v) {
  if (Array.isArray(e)) return v.set(e[0], e[1], e[2]);
  if (typeof e === 'object') {
    const m = dynObjects[e.i].mesh;
    return v.set(e.off[0], e.off[1], e.off[2]).applyQuaternion(m.quaternion).add(m.position);
  }
  return v.copy(dynObjects[e].mesh.position);
}
function updateRods() {
  for (const rod of GIM.rods) {
    const a = rodEnd(rod.from, _rodV1);
    const b = rodEnd(rod.to, _rodV2);
    rod.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    const d = b.sub(a);
    const len = Math.max(0.01, d.length());
    rod.mesh.scale.set(1, len, 1);
    rod.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  }
}

/* メインループ */
let lastFrame = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state === 'play') {
    if (isHost) hostStep(dt, now);
    else guestStep(now);
    updateCam(dt);
  } else {
    menuCam(now);
  }
  updateRods();
  for (const st of GIM.stars) st.rotation.y = now * 0.0012;                          // ごほうびの星
  for (const fl of GIM.floaters) fl.g.position.y = fl.y0 + Math.sin(now * 0.00042 + fl.ph) * 0.8; // 気球
  beltTex.offset.y -= dt * 0.7; // ベルトのながれ
  if (waterSurf) waterSurf.position.y = WATER_Y + Math.sin(now * 0.0011) * 0.05; // 水面のゆらぎ（見た目だけ）
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ホストのタブが隠れてrAFが止まっても、物理と配信を続けるフォールバック
setInterval(() => {
  const now = performance.now();
  if (state === 'play' && isHost && now - lastFrame > 300) {
    hostStep(Math.min(0.2, (now - lastFrame) / 1000), now);
    lastFrame = now;
  }
}, 150);

