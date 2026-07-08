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
const GRAVITY = -18;
const FIXED_DT = 1 / 60;
const FALL_Y = -8;               // これより落ちたらリスポーン
const SNAP_MS = 50;              // ホストの配信間隔 (20Hz)
const INPUT_MS = 50;             // ゲストの入力送信間隔
const INTERP_DELAY = 130;        // ゲスト側の補間遅延(ms)
// スキン: 体の色 × ぼうし
const SKIN_COLORS = [0xff6b6b, 0x4dabf7, 0x51cf66, 0xffd43b, 0xb197fc, 0xff9f43, 0x3bc9db, 0xf783ac];
const HAT_NAMES = ['なし', 'ぼうし', 'かんむり', 'ねこみみ', 'ハット'];
function normSkin(s) {
  const c = s && Number.isFinite(+s.c) ? Math.min(SKIN_COLORS.length - 1, Math.max(0, Math.floor(+s.c))) : 0;
  const h = s && Number.isFinite(+s.h) ? Math.min(HAT_NAMES.length - 1, Math.max(0, Math.floor(+s.h))) : 0;
  return { c, h };
}
// コースはS字にまがりながら、高台→谷→塔と上下する
const CHECKPOINTS = [
  { x: 0, y: 1.1, z: 1 },       // 0 スタート広場
  { x: 0, y: 1.1, z: 14 },      // 1 ぐらぐら板のさき（ここで右へ）
  { x: 13, y: 1.1, z: 12.8 },   // 2 うごく足場のさき・回転バーの島（ここで左へ）
  { x: 16, y: 3.7, z: 29 },     // 3 高台（ロープのすきまの手前）
  { x: 16, y: 3.7, z: 46.5 },   // 4 ふりこ鉄球のさき（ここで西へ）
  { x: -5, y: 3.7, z: 45 },     // 5 ベルトコンベアのさき・とびおりポイント
  { x: -6.5, y: 1.1, z: 65 },   // 6 谷のとびいしのさき
];
// 通過するとチェックポイントが更新されるゾーン（島の上）
const CP_ZONES = [
  { cp: 1, x0: -6, x1: 6, z0: 12, z1: 22, yMin: -1 },
  { cp: 2, x0: 10, x1: 21, z0: 11, z1: 23, yMin: -1 },
  { cp: 3, x0: 12, x1: 20, z0: 27.5, z1: 33.5, yMin: 1.6 },
  { cp: 4, x0: 12.5, x1: 19.5, z0: 45.2, z1: 48, yMin: 1.6 },
  { cp: 5, x0: -10, x1: -3, z0: 41.5, z1: 48.5, yMin: 1.6 },
  { cp: 6, x0: -10.5, x1: -2.5, z0: 63.5, z1: 69.5, yMin: -1 },
];
const GOAL = { x0: -11, x1: -2, z0: 70.3, y: 3.8 }; // ゴール塔の上
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
scene.background = new THREE.Color(0x9ed1f2);
scene.fog = new THREE.Fog(0x9ed1f2, 38, 110);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 240);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

scene.add(new THREE.HemisphereLight(0xdff1ff, 0x9db878, 0.85));
const sun = new THREE.DirectionalLight(0xfff4d6, 1.4);
sun.position.set(-18, 34, 14);
sun.castShadow = true;
const shadowRes = IS_TOUCH ? 1024 : 2048;
sun.shadow.mapSize.set(shadowRes, shadowRes);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -50;
sun.shadow.camera.far = 140;
sun.target.position.set(4, 0, 38);
scene.add(sun, sun.target);

/* =====================================================================
   コース（見た目はすぐ作る。物理ボディはホスト開始時に作る）
   ===================================================================== */
const staticDefs = [];  // {w,h,d,x,y,z,rotX, belt?, bounce?}
const dynObjects = [];  // {mesh, kind:'box'|'sphere'|'platform', size|radius, mass, home:{p}, body:null, kinematic?, rope?}
const GIM = { pendulums: [], rods: [] }; // ギミックの定義（rods: 見た目のワイヤー/棒）

const MAT = {
  grass: new THREE.MeshStandardMaterial({ color: 0x7ec850, roughness: 0.9 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0xb08558, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xd9a05b, roughness: 0.8 }),
  crate: new THREE.MeshStandardMaterial({ color: 0xe0b070, roughness: 0.7 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xb9c4cf, roughness: 0.85 }),
  ball: new THREE.MeshStandardMaterial({ color: 0xff8fb3, roughness: 0.5 }),
  plat: new THREE.MeshStandardMaterial({ color: 0x6cc7d8, roughness: 0.6 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x5a6672, roughness: 0.35, metalness: 0.5 }),
  brick: new THREE.MeshStandardMaterial({ color: 0xd9705a, roughness: 0.85 }),
  rope: new THREE.MeshStandardMaterial({ color: 0x8a6242, roughness: 1 }),
  button: new THREE.MeshStandardMaterial({ color: 0xe03131, roughness: 0.5 }),
  gate: new THREE.MeshStandardMaterial({ color: 0x8d7bc4, roughness: 0.6 }),
  tram: new THREE.MeshStandardMaterial({ color: 0xf783ac, roughness: 0.55 }),
  flag: new THREE.MeshStandardMaterial({ color: 0xffd43b, roughness: 0.6, side: THREE.DoubleSide }),
  cloud: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x8a6242, roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4fae5c, roughness: 0.9 }),
};

// ベルトコンベア（縞テクスチャをスクロールさせて流れを見せる）
let beltTex;
{
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#3a4149';
  c.fillRect(0, 0, 64, 64);
  c.fillStyle = '#ffd43b';
  c.beginPath();
  c.moveTo(12, 40); c.lineTo(32, 20); c.lineTo(52, 40);
  c.lineTo(52, 50); c.lineTo(32, 32); c.lineTo(12, 50);
  c.closePath();
  c.fill();
  beltTex = new THREE.CanvasTexture(cv);
  beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping;
  beltTex.repeat.set(1, 5);
  MAT.belt = new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.8 });
}

function staticBox(w, h, d, x, y, z, mat, rotX = 0, opts = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rotX) m.rotation.x = rotX;
  if (opts && opts.rotY) m.rotation.y = opts.rotY;
  m.receiveShadow = true;
  m.castShadow = true;
  scene.add(m);
  staticDefs.push({ w, h, d, x, y, z, rotX, ...(opts || {}) });
  return m;
}

// キネマティック（ホストが動かす）オブジェクトを登録して index を返す
function kinObject(mesh, kind, sizeOrRadius, home) {
  mesh.castShadow = true;
  scene.add(mesh);
  const o = { mesh, kind, mass: 0, kinematic: true, home: { p: home }, body: null };
  if (kind === 'sphere') o.radius = sizeOrRadius;
  else o.size = sizeOrRadius;
  mesh.position.set(...home);
  dynObjects.push(o);
  return dynObjects.length - 1;
}

// 見た目だけのワイヤー/棒（毎フレーム2点間に張りなおす）
function addRod(fromPointOrIdx, toIdx, radius, mat) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6), mat);
  mesh.castShadow = true;
  scene.add(mesh);
  GIM.rods.push({ mesh, from: fromPointOrIdx, toIdx });
}

// 島（草の天板つき）— topY が上面の高さ
function island(w, d, x, topY, z) {
  staticBox(w, 0.3, d, x, topY - 0.15, z, MAT.grass);
  staticBox(w, 1.3, d, x, topY - 0.3 - 0.65, z, MAT.dirt);
}

function dynBox(w, h, d, x, y, z, mat, mass) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  dynObjects.push({ mesh: m, kind: 'box', size: [w, h, d], mass, home: { p: [x, y, z] }, body: null });
  return m;
}

function tree(x, z, y = 0, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 0.9 * s, 8), MAT.trunk);
  trunk.position.y = 0.45 * s;
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.8 * s, 1.6 * s, 9), MAT.leaf);
  leaf.position.y = 1.5 * s;
  trunk.castShadow = leaf.castShadow = true;
  g.add(trunk, leaf);
  g.position.set(x, y, z);
  scene.add(g);
}

function pennant(x, y, z, color) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), MAT.stone);
  pole.position.set(x, y + 0.8, z);
  pole.castShadow = true;
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 4), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  flag.rotation.z = -Math.PI / 2;
  flag.position.set(x + 0.4, y + 1.4, z);
  scene.add(pole, flag);
}

// 壁こわし用などの大玉
function bigBall(x, y, z) {
  const r = 0.7;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), MAT.ball);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  dynObjects.push({ mesh: m, kind: 'sphere', radius: r, mass: 6, home: { p: [x, y, z] }, body: null });
}

function buildLevelVisuals() {
  /* コースマップ（上から見た図・→は進行方向）
       A(スタート) →+z→ B(木箱)  →+x→ C(回転バー) →+z→ D(高台 y2.6)
       →ロープ→ E(ふりこ) →-x→ F(レンガ壁・とびら) →ベルト→ G(とびおり!)
       →+z 落下→ H(谷 y0) →とびいし→ I(トランポリン) →大ジャンプ→ ゴール塔(y4.2) */

  // --- 島A: スタート広場 (x -6..6, z -2..8, 上面 y=0)
  island(12, 10, 0, 0, 3);
  staticBox(12, 0.7, 0.4, 0, 0.35, -1.9, MAT.stone);          // うしろの柵
  staticBox(0.4, 0.7, 4, -5.8, 0.35, 0, MAT.stone);           // よこの柵
  staticBox(0.4, 0.7, 4, 5.8, 0.35, 0, MAT.stone);
  tree(-4.6, 6.5); tree(4.8, 1.2, 0, 0.8);

  // --- すきま1 (z 8..12): ぐらぐら板
  dynBox(1.6, 0.12, 6.4, 0, 0.12, 10, MAT.wood, 3);

  // --- 島B (x -6..6, z 12..22): 木箱と大玉。つきあたりを右へ→
  island(12, 10, 0, 0, 17);
  pennant(-2.2, 0, 14, 0x4dabf7);                             // チェックポイント1
  dynBox(0.8, 0.8, 0.8, -2.2, 0.5, 16.5, MAT.crate, 1.5);
  dynBox(0.8, 0.8, 0.8, -1.3, 0.5, 17.3, MAT.crate, 1.5);
  dynBox(0.8, 0.8, 0.8, -2.0, 1.4, 17.0, MAT.crate, 1.5);
  bigBall(-3.5, 1.2, 19.5);
  staticBox(12, 0.7, 0.4, 0, 0.35, 21.8, MAT.stone);          // つきあたりの柵（右へまがる）
  staticBox(3.2, 1.0, 1.6, -2, 0.5, 20.4, MAT.stone);         // のぼれる段差
  tree(-4.8, 20.5, 0, 0.9);

  // --- すきま2 (x 6..10): 島のあいだをフェリーのように往復する足場
  //     中央(x8)では両岸にとどく＝タイミングをあわせて乗りうつる
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, 3.6), MAT.plat);
    m.receiveShadow = true;
    const idx = kinObject(m, 'platform', [4.2, 0.3, 3.6], [8, -0.15, 17]);
    GIM.platform = { idx, axis: 'x', base: 8, amp: 1.3, omega: 0.55 };
  }

  // --- 島C (x 10..21, z 11..23): ぐるぐる回転バー。おくを左へ→
  island(11, 12, 15.5, 0, 17);
  pennant(12.2, 0, 13, 0x51cf66);                             // チェックポイント2
  staticBox(0.4, 0.7, 12, 20.8, 0.35, 17, MAT.stone);         // おくの柵（左へまがる）
  tree(19.6, 12.4, 0, 0.85);
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 10), MAT.stone);
    pole.position.set(16, 0.7, 17);
    pole.castShadow = true;
    scene.add(pole);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(7, 0.35, 0.35), MAT.plat);
    GIM.sweeper = kinObject(bar, 'box', [7, 0.35, 0.35], [16, 0.6, 17]);
  }

  // --- スロープ (z 23..27.5) → 高台D (x 12..20, z 27.5..33.5, 上面 y=2.6)
  staticBox(3, 0.3, 5.2, 16, 1.3, 25.25, MAT.wood, -Math.atan2(2.6, 4.5));
  island(8, 6, 16, 2.6, 30.5);
  pennant(12.8, 2.6, 30.5, 0xffd43b);                         // チェックポイント3

  // --- すきま4 (z 33.5..38): ターザンロープ or 細いはり
  {
    staticBox(0.5, 5.6, 0.5, 13.4, 2.6 + 2.8, 35.7, MAT.stone);
    staticBox(0.5, 5.6, 0.5, 18.6, 2.6 + 2.8, 35.7, MAT.stone);
    staticBox(5.7, 0.5, 0.5, 16, 2.6 + 5.85, 35.7, MAT.stone);
    GIM.ropeAnchor = [16, 8.1, 35.7];
    GIM.ropeStart = dynObjects.length;
    GIM.ropeLen = 8;
    for (let i = 0; i < GIM.ropeLen; i++) {
      const last = i === GIM.ropeLen - 1;
      const r = last ? 0.38 : (i >= 5 ? 0.18 : 0.12); // 下のほうは太くてつかみやすい
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), last ? MAT.ball : MAT.rope);
      m.castShadow = true;
      scene.add(m);
      const p = [16, GIM.ropeAnchor[1] - 0.55 * (i + 1), 35.7];
      m.position.set(...p);
      dynObjects.push({ mesh: m, kind: 'sphere', radius: r, mass: last ? 1.2 : 0.35, home: { p }, body: null, rope: true });
      addRod(i === 0 ? GIM.ropeAnchor : GIM.ropeStart + i - 1, GIM.ropeStart + i, 0.045, MAT.rope);
    }
    // 細いはり（こわい人むけの べつルート）
    staticBox(0.6, 0.25, 5.4, 14, 2.6 - 0.13, 35.75, MAT.wood);
  }

  // --- 島E (x 12.5..19.5, z 38..48): ふりこ鉄球の橋
  island(7, 10, 16, 2.6, 43);
  for (const [pz, phase] of [[40.8, 0], [44.2, Math.PI * 0.7]]) {
    staticBox(0.5, 0.5, 0.5, 16, 8.6, pz, MAT.stone); // 支点
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), MAT.iron);
    const idx = kinObject(ball, 'sphere', 0.62, [16, 8.6 - 5.2, pz]);
    GIM.pendulums.push({ idx, pivot: [16, 8.6, pz], L: 5.2, omega: 1.35, phase });
    addRod([16, 8.6, pz], idx, 0.05, MAT.iron);
  }
  pennant(13.4, 2.6, 46.8, 0xb197fc);                         // チェックポイント4（ここから西へ）

  // --- 島F (x 3..13, z 42..48, 上面 y=2.6): レンガ壁 → ボタンのとびら
  island(10, 6, 8, 2.6, 45);
  bigBall(11.6, 3.6, 43.2);
  // レンガ壁（x=10.6・押しくずして西へすすむ）
  staticBox(0.5, 2.4, 1.2, 10.6, 2.6 + 1.2, 42.6, MAT.stone);
  staticBox(0.5, 2.4, 1.2, 10.6, 2.6 + 1.2, 47.4, MAT.stone);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const bd = 0.78, bh = 0.5;
      const bz = 43.77 + col * 0.8 + (row % 2 ? 0.12 : -0.12);
      const by = 2.6 + bh / 2 + row * (bh + 0.01);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, bh, bd), MAT.brick);
      m.position.set(10.6, by, bz);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      dynObjects.push({ mesh: m, kind: 'box', size: [0.42, bh, bd], mass: 0.7, home: { p: [10.6, by, bz] }, body: null });
    }
  }
  // ボタンで開くとびら (x=6.8)
  staticBox(0.4, 2.8, 1.5, 6.8, 2.6 + 1.4, 42.75, MAT.stone);
  staticBox(0.4, 2.8, 1.5, 6.8, 2.6 + 1.4, 47.25, MAT.stone);
  {
    const gate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 2.95), MAT.gate);
    GIM.gate = kinObject(gate, 'box', [0.3, 2.5, 2.95], [6.8, 2.6 + 1.25, 45]);
    GIM.gateHomeY = 2.6 + 1.25;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.1, 14), MAT.stone);
    base.position.set(7.9, 2.65, 42.9);
    base.receiveShadow = true;
    scene.add(base);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.22, 14), MAT.button);
    GIM.button = kinObject(cap, 'box', [0.9, 0.22, 0.9], [7.9, 2.6 + 0.19, 42.9]);
    GIM.buttonPos = [7.9, 2.6, 42.9];
    GIM.opened = false;
  }

  // --- ベルトコンベア橋 (x -3.3..3.3, ながれは+x=ぎゃく方向！)
  staticBox(3, 0.4, 6.6, 0, 2.4, 45, MAT.belt, 0, { belt: [2.3, 0, 0], rotY: Math.PI / 2 });
  staticBox(6.6, 0.32, 0.25, 0, 2.76, 43.38, MAT.stone);
  staticBox(6.6, 0.32, 0.25, 0, 2.76, 46.62, MAT.stone);

  // --- 島G (x -10..-3, z 41.5..48.5, 上面 y=2.6): がけからとびおりる！
  island(7, 7, -6.5, 2.6, 45);
  pennant(-4.5, 2.6, 43, 0x51cf66);                           // チェックポイント5
  tree(-9.2, 42.6, 2.6, 0.8);

  // --- 谷の島H (x -10.5..-2.5, z 49.5..56.5, 上面 y=0): とびおりた先
  island(8, 7, -6.5, 0, 53);
  tree(-9.6, 55.4, 0, 1.0);

  // --- とびいし (高さのちがう石をジャンプでわたる・のぼって→おりる)
  //     最初の石は島Hと重ねて段差に、以降は0.8〜0.9mの飛べるすきま
  staticBox(2.2, 0.7, 2.4, -6.5, -0.05, 57.0, MAT.stone);  // 上面 y0.3（島Hと重なる段差）
  staticBox(2.0, 1.8, 2.0, -6.5, 0.0, 60.0, MAT.stone);    // 上面 y0.9（のぼる）
  staticBox(2.2, 1.0, 2.0, -6.5, 0.0, 62.9, MAT.stone);    // 上面 y0.5（おりて島Iへ）

  // --- 島I (x -10.5..-2.5, z 63.5..69.5, 上面 y=0): トランポリンで大ジャンプ
  island(8, 6, -6.5, 0, 66.5);
  pennant(-9.2, 0, 65, 0x4dabf7);                             // チェックポイント6
  staticBox(2.4, 0.5, 2.4, -6.5, -0.19, 68.3, MAT.tram, 0, { bounce: 13 }); // 上面は床から6cm

  // --- ゴール塔 (x -11..-2, z 70.25..75.75, 上面 y=4.2)
  island(9, 5.5, -6.5, 4.2, 73);
  staticBox(5, 2.7, 4, -6.5, 1.3, 73, MAT.dirt); // 塔の土台
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 10), MAT.stone);
    pole.position.set(-6.5, 4.2 + 1.3, 74.3);
    pole.castShadow = true;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), MAT.flag);
    flag.position.set(-5.8, 4.2 + 2.1, 74.3);
    scene.add(pole, flag);
  }

  // --- とおくのかざり島（見た目だけ・コースからは行けない）
  for (const [ix, iy, iz, s] of [[30, -3, 8, 1.2], [-24, -5, 25, 1], [32, -4, 55, 0.9], [-22, -6, 70, 1.1]]) {
    const g1 = new THREE.Mesh(new THREE.BoxGeometry(8 * s, 0.3, 6 * s), MAT.grass);
    g1.position.set(ix, iy, iz);
    const g2 = new THREE.Mesh(new THREE.BoxGeometry(8 * s, 1.3, 6 * s), MAT.dirt);
    g2.position.set(ix, iy - 0.8, iz);
    scene.add(g1, g2);
    tree(ix + 2 * s, iz - s, iy + 0.15, s);
  }

  // --- 雲と、下のほうの海色の板（奈落の見た目）
  for (let i = 0; i < 12; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random() * 1.6, 10, 7), MAT.cloud);
    c.scale.y = 0.4;
    c.position.set(Math.random() * 90 - 40, 11 + Math.random() * 8, Math.random() * 85 - 8);
    scene.add(c);
  }
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x7fb8e8 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -26;
  scene.add(sea);
}
buildLevelVisuals();

/* =====================================================================
   見た目のキャラクター（Rig）— ホスト/ゲスト共通
   ===================================================================== */
const UP = new THREE.Vector3(0, 1, 0);
const _tv1 = new THREE.Vector3(), _tv2 = new THREE.Vector3(), _tv3 = new THREE.Vector3();

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
    const color = SKIN_COLORS[skin.c];
    this.color = color;
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.65 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe8d1, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.5 });

    this.group = new THREE.Group();

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.7, 6, 14), bodyMat);
    torso.castShadow = true;
    this.group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), skinMat);
    head.position.set(0, 0.78, 0);
    head.castShadow = true;
    this.group.add(head);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), darkMat);
      eye.position.set(0.075 * sx, 0.82, 0.185);
      this.group.add(eye);
    }
    if (skin.h) addHatTo(this.group, skin.h, color);

    // あし（ひざなし・ふりこアニメ）
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.12 * sx, -0.35, 0);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.3, 10), bodyMat);
      leg.position.y = -0.14;
      leg.castShadow = true;
      hip.add(leg);
      this.group.add(hip);
      this.legs.push(hip);
    }

    // うで（かた→手のシリンダーを毎フレーム張りなおす）と手
    this.arms = [];
    this.hands = [];
    this.handMats = [];
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 8), bodyMat);
      arm.castShadow = true;
      scene.add(arm);
      this.arms.push(arm);
      const hm = new THREE.MeshStandardMaterial({ color: 0xffe8d1, roughness: 0.7 });
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), hm);
      hand.castShadow = true;
      scene.add(hand);
      this.hands.push(hand);
      this.handMats.push(hm);
    }

    this.nameSpr = makeNameSprite(name, color);
    scene.add(this.nameSpr);
    scene.add(this.group);

    this.lastPos = new THREE.Vector3();
    this.phase = 0;
    this.speedSm = 0;
  }

  // p:Vector3ふう, q:Quaternionふう, hl/hr: [x,y,z]
  setPose(p, q, hl, hr, grabbing, dt) {
    const g = this.group;
    g.position.set(p.x, p.y, p.z);
    g.quaternion.set(q.x, q.y, q.z, q.w);
    g.updateMatrixWorld();

    // あし（移動スピードでふりこ）
    if (dt > 0) {
      const sp = _tv1.set(p.x - this.lastPos.x, 0, p.z - this.lastPos.z).length() / dt;
      this.speedSm += (Math.min(sp, 5) - this.speedSm) * 0.2;
      this.phase += this.speedSm * dt * 3.2;
    }
    this.lastPos.set(p.x, p.y, p.z);
    const amp = Math.min(this.speedSm / 3, 1) * 0.65;
    this.legs[0].rotation.x = Math.sin(this.phase) * amp;
    this.legs[1].rotation.x = Math.sin(this.phase + Math.PI) * amp;

    // うで
    const hands = [hl, hr];
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const shoulder = _tv1.set(0.3 * sx, 0.32, 0).applyMatrix4(g.matrixWorld);
      const hp = _tv2.set(hands[i][0], hands[i][1], hands[i][2]);
      const arm = this.arms[i];
      arm.position.copy(shoulder).add(hp).multiplyScalar(0.5);
      const dir = _tv3.copy(hp).sub(shoulder);
      const len = Math.max(0.08, dir.length());
      arm.scale.set(1, len, 1);
      arm.quaternion.setFromUnitVectors(UP, dir.normalize());
      this.hands[i].position.copy(hp);
      this.handMats[i].color.setHex(grabbing ? 0xffd43b : 0xffe8d1);
    }

    this.nameSpr.position.set(p.x, p.y + 1.35, p.z);
  }

  dispose() {
    scene.remove(this.group, this.nameSpr, ...this.arms, ...this.hands);
  }
}

/* =====================================================================
   物理（ホスト側のみ）
   ===================================================================== */
let world = null;
let charMaterial, groundMaterial, handMaterial;
let simT = 0;
const GROUP_WORLD = 1, GROUP_OBJ = 2;
const playerGroup = (idx) => 4 << idx; // idx 0..4 → bit 2..6

function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0), allowSleep: true });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0;

  groundMaterial = new CANNON.Material('ground');
  charMaterial = new CANNON.Material('char');
  handMaterial = new CANNON.Material('hand');
  // キャラの摩擦は0（摩擦の偶力で転んでしまうため、停止・追従は速度ブレンドで行う）
  world.addContactMaterial(new CANNON.ContactMaterial(charMaterial, groundMaterial, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(handMaterial, groundMaterial, { friction: 0.8, restitution: 0 }));

  // 静的コライダー
  for (const s of staticDefs) {
    const body = new CANNON.Body({
      mass: 0,
      material: groundMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(s.w / 2, s.h / 2, s.d / 2)),
      position: new CANNON.Vec3(s.x, s.y, s.z),
      collisionFilterGroup: GROUP_WORLD,
    });
    if (s.rotX) body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), s.rotX);
    if (s.rotY) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), s.rotY);
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
      material: groundMaterial,
      position: new CANNON.Vec3(...o.home.p),
      collisionFilterGroup: isKin ? GROUP_WORLD : GROUP_OBJ,
      linearDamping: 0.05,
      angularDamping: 0.05,
    });
    if (o.kind === 'sphere') body.addShape(new CANNON.Sphere(o.radius));
    else body.addShape(new CANNON.Box(new CANNON.Vec3(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2)));
    // 箱・レンガなどは寝かせて負荷をへらす（さわれば起きる）。ロープは常時アクティブ
    body.allowSleep = !isKin && !o.rope;
    body.sleepSpeedLimit = 0.3;
    body.sleepTimeLimit = 0.8;
    world.addBody(body);
    o.body = body;
  }

  // ロープ: 天井アンカーから鎖状につなぐ
  if (GIM.ropeStart !== undefined) {
    const anchor = new CANNON.Body({
      mass: 0,
      position: new CANNON.Vec3(...GIM.ropeAnchor),
      collisionFilterGroup: GROUP_WORLD,
      collisionFilterMask: 0, // なにともぶつからない
      shape: new CANNON.Sphere(0.05),
    });
    world.addBody(anchor);
    let prev = anchor;
    for (let i = 0; i < GIM.ropeLen; i++) {
      const link = dynObjects[GIM.ropeStart + i].body;
      world.addConstraint(new CANNON.DistanceConstraint(prev, link, 0.55));
      prev = link;
    }
  }
}

/* ギミックをうごかす（毎固定ステップ・ホストのみ） */
function stepGimmicks() {
  // うごく足場
  if (GIM.platform) {
    const pf = GIM.platform;
    const b = dynObjects[pf.idx].body;
    const target = pf.base + Math.sin(simT * pf.omega) * pf.amp;
    if (pf.axis === 'z') b.velocity.set(0, 0, (target - b.position.z) / FIXED_DT);
    else b.velocity.set((target - b.position.x) / FIXED_DT, 0, 0);
  }
  // ぐるぐる回転バー
  if (GIM.sweeper !== undefined) {
    dynObjects[GIM.sweeper].body.angularVelocity.set(0, 1.6, 0);
  }
  // ふりこ鉄球
  for (const pd of GIM.pendulums) {
    const th = 1.12 * Math.sin(simT * pd.omega + pd.phase);
    const b = dynObjects[pd.idx].body;
    const tx = pd.pivot[0] + Math.sin(th) * pd.L;
    const ty = pd.pivot[1] - Math.cos(th) * pd.L;
    b.velocity.set((tx - b.position.x) / FIXED_DT, (ty - b.position.y) / FIXED_DT, (pd.pivot[2] - b.position.z) / FIXED_DT);
  }
  // ボタン → とびら
  if (GIM.gate !== undefined) {
    if (!GIM.opened) {
      for (const doll of dolls.values()) {
        const p = doll.torso.position, bp = GIM.buttonPos;
        if (Math.abs(p.x - bp[0]) < 0.8 && Math.abs(p.z - bp[2]) < 0.8 && p.y > bp[1] && p.y < bp[1] + 1.4) {
          GIM.opened = true;
          announce('🔴 ボタンをおした！とびらがひらく…');
          break;
        }
      }
    }
    const gate = dynObjects[GIM.gate].body;
    const targetY = GIM.opened ? GIM.gateHomeY - 2.6 : GIM.gateHomeY;
    gate.velocity.set(0, Math.max(-1.2, Math.min(1.2, (targetY - gate.position.y) * 3)), 0);
    const btn = dynObjects[GIM.button].body;
    const btnY = GIM.buttonPos[1] + (GIM.opened ? 0.08 : 0.19);
    btn.velocity.set(0, (btnY - btn.position.y) * 6, 0);
  }
}

/* 全員へのおしらせ（ホストのみ呼ぶ） */
function announce(text) {
  showMsg(text);
  broadcast({ t: 'm', text });
}

/* ふにゃふにゃ人形（物理） */
class Doll {
  constructor(id, colorIdx) {
    this.id = id;
    this.cp = 0;
    this.goal = false;
    this.limpUntil = 0;
    this.lastJump = 0;
    this.grabCool = 0;
    this.input = { x: 0, z: 0, j: 0, g: false };

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
      if (v > 9) this.limpUntil = simT + 1.1; // つよい衝撃でのびる
    });
    world.addBody(torso);
    this.torso = torso;

    // 手×2（うではバネ＋つかみ用コンストレイント）
    this.sides = [];
    for (const sx of [-1, 1]) {
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
      this.sides.push({ sx, body: hand, grabC: null, holdC: null });
    }

    this.respawn();
  }

  spawnPos() {
    const cp = CHECKPOINTS[this.cp];
    return new CANNON.Vec3(cp.x + ((this.id % MAX_PLAYERS) - 2) * 0.7, cp.y, cp.z);
  }

  respawn() {
    this.releaseGrabs();
    this.limpUntil = 0;
    const p = this.spawnPos();
    this.torso.position.copy(p);
    this.torso.velocity.setZero();
    this.torso.angularVelocity.setZero();
    this.torso.quaternion.set(0, 0, 0, 1);
    for (const s of this.sides) {
      s.body.position.set(p.x + 0.45 * s.sx, p.y, p.z);
      s.body.velocity.setZero();
    }
  }

  releaseGrabs() {
    for (const s of this.sides) {
      if (s.grabC) { world.removeConstraint(s.grabC); s.grabC = null; }
      if (s.holdC) { world.removeConstraint(s.holdC); s.holdC = null; }
    }
    this.grabCool = simT + 0.25;
  }

  get grabbing() { return this.sides.some((s) => s.grabC); }

  tryGrab(side) {
    const hand = side.body;
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
    const limp = simT < this.limpUntil;

    // 接地チェック（自分以外になにか触れているか、下にレイ）
    const from = torso.position;
    const to = new CANNON.Vec3(from.x, from.y - 0.95, from.z);
    const ray = new CANNON.RaycastResult();
    world.raycastClosest(from, to, { collisionFilterGroup: torso.collisionFilterGroup, collisionFilterMask: torso.collisionFilterMask, skipBackfaces: true }, ray);
    const grounded = ray.hasHit;
    // ベルトコンベアの上では「地面の速度」がベルトのながれになる
    const groundVel = grounded && ray.body ? (ray.body.beltVel || ray.body.velocity) : null;
    const hanging = this.grabbing;

    // トランポリン
    if (grounded && ray.body.bouncePad && torso.velocity.y < 2) {
      torso.velocity.y = ray.body.bouncePad;
    }

    if (!limp) {
      // ── バランス（起き上がりトルク・ばね式でふにゃっとする）
      const bodyUp = torso.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
      const axis = bodyUp.cross(new CANNON.Vec3(0, 1, 0));
      torso.torque.x += axis.x * 150 - torso.angularVelocity.x * 14;
      torso.torque.z += axis.z * 150 - torso.angularVelocity.z * 14;

      // ── 移動は速度ブレンド方式（力だと摩擦との偶力で倒れてしまう）
      const gvx = groundVel ? groundVel.x : 0;
      const gvz = groundVel ? groundVel.z : 0;
      const mlen = Math.hypot(inp.x, inp.z);
      if (mlen > 0.15) {
        // 進行方向をむく
        const fwd = torso.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
        let d = Math.atan2(inp.x, inp.z) - Math.atan2(fwd.x, fwd.z);
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        torso.torque.y += d * 22 - torso.angularVelocity.y * 4;

        const s = Math.min(1, mlen);
        const tvx = gvx + (inp.x / mlen) * 4.2 * s;
        const tvz = gvz + (inp.z / mlen) * 4.2 * s;
        const k = grounded ? 0.18 : 0.045;
        torso.velocity.x += (tvx - torso.velocity.x) * k;
        torso.velocity.z += (tvz - torso.velocity.z) * k;
      } else {
        torso.torque.y += -torso.angularVelocity.y * 4;
        if (grounded) {
          // 立ちどまるブレーキ（うごく床の速度にあわせる）
          torso.velocity.x += (gvx - torso.velocity.x) * 0.16;
          torso.velocity.z += (gvz - torso.velocity.z) * 0.16;
        }
      }

      // ── ジャンプ（ぶらさがり中は手をはなして跳ぶ）
      if (inp.j !== this.lastJump) {
        this.lastJump = inp.j;
        if (grounded) torso.velocity.y = 7.2;
        else if (hanging) { this.releaseGrabs(); torso.velocity.y = 6.2; }
      }
    }

    // ── うで（バネで目標位置へ・重力ぶんは打ち消す）
    for (const s of this.sides) {
      const hand = s.body;
      const local = inp.g && !limp
        ? new CANNON.Vec3(0.24 * s.sx, 0.5, 0.5)     // 上まえにのばす
        : new CANNON.Vec3(0.42 * s.sx, -0.1, 0.06);  // 体のよこ
      const target = torso.pointToWorldFrame(local, new CANNON.Vec3());
      hand.force.x += (target.x - hand.position.x) * 32 - hand.velocity.x * 3;
      hand.force.y += (target.y - hand.position.y) * 32 - hand.velocity.y * 3 - GRAVITY * hand.mass;
      hand.force.z += (target.z - hand.position.z) * 32 - hand.velocity.z * 3;
    }

    // ── つかむ / はなす
    if (inp.g && !limp) {
      if (simT > this.grabCool) {
        for (const s of this.sides) if (!s.grabC) this.tryGrab(s);
      }
    } else if (this.grabbing) {
      this.releaseGrabs();
    }
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
let mouseGrab = false, keyGrab = false, touchGrab = false;
let camYaw = Math.PI, camPitch = 0.35, camDist = 6.5;
const stickVec = { x: 0, y: 0 };

window.addEventListener('keydown', (e) => {
  if (state !== 'play' || e.repeat) { if (e.code === 'Space' && state === 'play') e.preventDefault(); return; }
  keys.add(e.code);
  if (e.code === 'Space') { jumpCount++; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keyGrab = true;
  if (e.code === 'KeyR') requestRespawn();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keyGrab = false;
});
window.addEventListener('blur', () => { keys.clear(); keyGrab = false; mouseGrab = false; });

// マウス: 左長押し=つかむ / ドラッグ=カメラ
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') { touchCamStart(e); return; }
  if (e.button === 0) mouseGrab = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') { touchCamMove(e); return; }
  if (e.buttons) {
    camYaw -= e.movementX * 0.005;
    camPitch = Math.min(1.25, Math.max(-0.15, camPitch + e.movementY * 0.005));
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') { touchCamEnd(e); return; }
  if (e.button === 0) mouseGrab = false;
});
canvas.addEventListener('wheel', (e) => {
  camDist = Math.min(10, Math.max(3.5, camDist * (e.deltaY > 0 ? 1.1 : 0.9)));
  e.preventDefault();
}, { passive: false });

// タッチカメラ（キャンバス上のスワイプ）
let camTouchId = null, camTouchLast = null;
function touchCamStart(e) { if (camTouchId === null) { camTouchId = e.pointerId; camTouchLast = { x: e.clientX, y: e.clientY }; } }
function touchCamMove(e) {
  if (e.pointerId !== camTouchId) return;
  camYaw -= (e.clientX - camTouchLast.x) * 0.007;
  camPitch = Math.min(1.25, Math.max(-0.15, camPitch + (e.clientY - camTouchLast.y) * 0.007));
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

// タッチボタン
const tJump = $('t-jump'), tGrab = $('t-grab');
tJump.addEventListener('pointerdown', (e) => { e.preventDefault(); jumpCount++; });
tGrab.addEventListener('pointerdown', (e) => { e.preventDefault(); touchGrab = true; tGrab.classList.add('on'); });
const grabOff = () => { touchGrab = false; tGrab.classList.remove('on'); };
tGrab.addEventListener('pointerup', grabOff);
tGrab.addEventListener('pointercancel', grabOff);

if ('ontouchstart' in window) touchEl.classList.remove('hidden');

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
  return { x: r2(x), z: r2(z), j: jumpCount, g: mouseGrab || keyGrab || touchGrab };
}

/* =====================================================================
   ネットワーク（PeerJS / ?local=1でBroadcastChannel）
   ===================================================================== */
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
  showMsg('🚩 ゴールの旗をめざそう！ ✊つかむ で よじのぼり', 3600);
}

function requestRespawn() {
  if (state !== 'play') return;
  if (isHost) { const d = dolls.get(myId); if (d) d.respawn(); }
  else if (hostConn) hostConn.send({ t: 'rs' });
}

/* ── ホスト（ソロ含む） ── */
function startHostGame(withRoom) {
  isHost = true;
  myId = 0;
  nextId = 1;
  saveProfile();
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
      conn.send({ t: 'welcome', id: pid, players: metaList() });
      broadcast({ t: 'players', players: metaList() }, pid);
      updatePlayersHud();
      showMsg(`👋 ${name} が参加した！（${metas.size}/${MAX_PLAYERS}人）`);
    } else if (m.t === 'i' && pid !== null) {
      const doll = dolls.get(pid);
      if (doll) doll.input = { x: +m.x || 0, z: +m.z || 0, j: +m.j || 0, g: !!m.g };
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
    for (const pm of m.players) addMetaAndRig(pm);
    hudCodeEl.textContent = roomCode;
    hudRoomEl.classList.remove('hidden');
    enterPlay();
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
  } else if (m.t === 'm') {
    showMsg(m.text);
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

/* ── メニューボタン ── */
$('solo-btn').addEventListener('click', () => startHostGame(false));
$('host-btn').addEventListener('click', () => startHostGame(true));
$('join-btn').addEventListener('click', startJoin);

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
    if (p.y < FALL_Y) { doll.respawn(); continue; }
    for (const zn of CP_ZONES) {
      if (zn.cp > doll.cp && p.x > zn.x0 && p.x < zn.x1 && p.z > zn.z0 && p.z < zn.z1 && p.y > zn.yMin && p.y < zn.yMin + 5) {
        doll.cp = zn.cp;
        if (doll.id === myId) showMsg('🚩 チェックポイント！');
        else { const c = guests.get(doll.id); if (c) c.send({ t: 'm', text: '🚩 チェックポイント！' }); }
      }
    }
    if (!doll.goal && p.x > GOAL.x0 && p.x < GOAL.x1 && p.z > GOAL.z0 && p.y > GOAL.y) {
      doll.goal = true;
      const meta = metas.get(doll.id);
      meta.goal = true;
      updatePlayersHud();
      showMsg(`🎉 ${meta.name} が ゴール！`, 3200);
      broadcast({ t: 'goal', id: doll.id, name: meta.name });
    }
  }

  // 落ちた物の復活
  for (const o of dynObjects) {
    if (o.body && !o.kinematic && o.kind !== 'platform' && o.body.position.y < FALL_Y) {
      o.body.position.set(...o.home.p);
      o.body.velocity.setZero();
      o.body.angularVelocity.setZero();
      o.body.quaternion.set(0, 0, 0, 1);
    }
  }

  // 物理 → 見た目
  for (const [id, doll] of dolls) {
    const rig = rigs.get(id);
    if (!rig) continue;
    const t = doll.torso;
    rig.setPose(
      t.position, t.quaternion,
      [doll.sides[0].body.position.x, doll.sides[0].body.position.y, doll.sides[0].body.position.z],
      [doll.sides[1].body.position.x, doll.sides[1].body.position.y, doll.sides[1].body.position.z],
      doll.input.g, dt,
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
        doll.input.g ? 1 : 0,
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
    const px = lerp(ea[1], eb[1], t), py = lerp(ea[2], eb[2], t), pz = lerp(ea[3], eb[3], t);
    _q1.set(ea[4], ea[5], ea[6], ea[7]);
    _q2.set(eb[4], eb[5], eb[6], eb[7]);
    _q1.slerp(_q2, t);
    rig.setPose(
      { x: px, y: py, z: pz }, _q1,
      [lerp(ea[8], eb[8], t), lerp(ea[9], eb[9], t), lerp(ea[10], eb[10], t)],
      [lerp(ea[11], eb[11], t), lerp(ea[12], eb[12], t), lerp(ea[13], eb[13], t)],
      !!eb[14], dtRig,
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

/* カメラ */
const camTargetSm = new THREE.Vector3(0, 1, 0);
function updateCam() {
  const rig = rigs.get(myId);
  if (!rig) return;
  camTargetSm.lerp(rig.group.position, 0.18);
  const cp = Math.cos(camPitch), spitch = Math.sin(camPitch);
  camera.position.set(
    camTargetSm.x + Math.sin(camYaw) * cp * camDist,
    camTargetSm.y + spitch * camDist + 0.6,
    camTargetSm.z + Math.cos(camYaw) * cp * camDist,
  );
  camera.lookAt(camTargetSm.x, camTargetSm.y + 0.6, camTargetSm.z);
}

function menuCam(now) {
  const t = now * 0.00012;
  camera.position.set(5 + Math.sin(t) * 36, 14, 38 + Math.cos(t) * 36);
  camera.lookAt(5, 1.5, 38);
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

/* ワイヤー・ロープの見た目を2点間に張りなおす（ホスト/ゲスト共通） */
const _rodV1 = new THREE.Vector3(), _rodV2 = new THREE.Vector3();
function updateRods() {
  for (const rod of GIM.rods) {
    const a = Array.isArray(rod.from)
      ? _rodV1.set(rod.from[0], rod.from[1], rod.from[2])
      : _rodV1.copy(dynObjects[rod.from].mesh.position);
    const b = _rodV2.copy(dynObjects[rod.toIdx].mesh.position);
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
    updateCam();
  } else {
    menuCam(now);
  }
  updateRods();
  beltTex.offset.y -= dt * 0.7; // ベルトのながれ
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

/* デバッグ用フック（動作確認テストで使用） */
window.__dbg = {
  get state() { return state; },
  get isHost() { return isHost; },
  get myId() { return myId; },
  get metas() { return metas; },
  get dolls() { return dolls; },
  get rigs() { return rigs; },
  get snaps() { return snaps; },
  get objs() { return dynObjects; },
  get gim() { return GIM; },
  get skin() { return mySkin; },
  pos() {
    const rig = rigs.get(myId);
    return rig ? rig.group.position.toArray() : null;
  },
  pressKey(code) { keys.add(code); },
  releaseKey(code) { keys.delete(code); },
  jump() { jumpCount++; },
  setGrab(v) { keyGrab = v; },
  setYaw(y) { camYaw = y; },
};
