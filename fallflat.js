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
const PLAYER_COLORS = [0xff6b6b, 0x4dabf7, 0x51cf66, 0xffd43b, 0xb197fc];
const CHECKPOINTS = [
  { x: 0, z: 1 },    // スタート広場
  { x: 0, z: 14 },   // シーソー橋のさき
  { x: 0, z: 28.5 }, // うごく足場のさき
];
const GOAL = { x: 4.5, z: 36.5, y: 1.8 }; // |x|<x かつ z> かつ y> でゴール

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

/* ===== Three.js セットアップ ===== */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ed1f2);
scene.fog = new THREE.Fog(0x9ed1f2, 35, 95);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);

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
sun.position.set(-14, 26, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -20;
sun.shadow.camera.far = 80;
sun.target.position.set(0, 0, 20);
scene.add(sun, sun.target);

/* =====================================================================
   コース（見た目はすぐ作る。物理ボディはホスト開始時に作る）
   ===================================================================== */
const staticDefs = [];  // {w,h,d,x,y,z,rotX}
const dynObjects = [];  // {mesh, kind:'box'|'sphere'|'platform', size|radius, mass, home:{p,q}, body:null}

const MAT = {
  grass: new THREE.MeshStandardMaterial({ color: 0x7ec850, roughness: 0.9 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0xb08558, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xd9a05b, roughness: 0.8 }),
  crate: new THREE.MeshStandardMaterial({ color: 0xe0b070, roughness: 0.7 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xb9c4cf, roughness: 0.85 }),
  ball: new THREE.MeshStandardMaterial({ color: 0xff8fb3, roughness: 0.5 }),
  plat: new THREE.MeshStandardMaterial({ color: 0x6cc7d8, roughness: 0.6 }),
  flag: new THREE.MeshStandardMaterial({ color: 0xffd43b, roughness: 0.6, side: THREE.DoubleSide }),
  cloud: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x8a6242, roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4fae5c, roughness: 0.9 }),
};

function staticBox(w, h, d, x, y, z, mat, rotX = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rotX) m.rotation.x = rotX;
  m.receiveShadow = true;
  m.castShadow = true;
  scene.add(m);
  staticDefs.push({ w, h, d, x, y, z, rotX });
  return m;
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

function buildLevelVisuals() {
  // --- 島A: スタート広場 (z -2..8, 上面 y=0)
  island(12, 10, 0, 0, 3);
  staticBox(12, 0.7, 0.4, 0, 0.35, -1.9, MAT.stone);          // うしろの柵
  staticBox(0.4, 0.7, 4, -5.8, 0.35, 0, MAT.stone);           // よこの柵
  staticBox(0.4, 0.7, 4, 5.8, 0.35, 0, MAT.stone);
  tree(-4.6, 6.5); tree(4.8, 1.2, 0, 0.8);

  // --- すきま1 (z 8..12): シーソー板（動く板・落ちたら復活）
  dynBox(1.6, 0.12, 6.4, 0, 0.12, 10, MAT.wood, 3);

  // --- 島B (z 12..22, 上面 y=0)
  island(12, 10, 0, 0, 17);
  pennant(-2.2, 0, 14, 0x4dabf7);                             // チェックポイント1
  // 木箱×3 と 大きいボール
  dynBox(0.8, 0.8, 0.8, -2.2, 0.5, 16.5, MAT.crate, 1.5);
  dynBox(0.8, 0.8, 0.8, -1.3, 0.5, 17.3, MAT.crate, 1.5);
  dynBox(0.8, 0.8, 0.8, -2.0, 1.4, 17.0, MAT.crate, 1.5);
  {
    const r = 0.7;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), MAT.ball);
    m.position.set(3, 1.2, 18.5);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    dynObjects.push({ mesh: m, kind: 'sphere', radius: r, mass: 6, home: { p: [3, 1.2, 18.5] }, body: null });
  }
  staticBox(3.2, 1.0, 1.6, 3.6, 0.5, 21, MAT.stone);          // のぼれる段差
  tree(-4.8, 20.5, 0, 0.9);

  // --- すきま2 (z 22..27): 左右にうごく足場
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 3.4), MAT.plat);
    m.position.set(0, -0.15, 24.5);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    dynObjects.push({ mesh: m, kind: 'platform', size: [3, 0.3, 3.4], mass: 0, home: { p: [0, -0.15, 24.5] }, body: null });
  }

  // --- 島C (z 27..35, 上面 y=0)
  island(12, 8, 0, 0, 31);
  pennant(2.4, 0, 28.2, 0x51cf66);                            // チェックポイント2
  tree(4.7, 30, 0, 1.1); tree(-4.7, 33.5, 0, 0.85);

  // --- スロープ → ゴール高台 (上面 y=2.2, z 35.5..41.5)
  staticBox(3, 0.3, 4.6, 0, 1.1, 33.5, MAT.wood, -Math.atan2(2.2, 4));
  island(8, 6, 0, 2.2, 38.5);
  // ゴールの旗
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 10), MAT.stone);
    pole.position.set(0, 2.2 + 1.3, 39.5);
    pole.castShadow = true;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), MAT.flag);
    flag.position.set(0.7, 2.2 + 2.1, 39.5);
    scene.add(pole, flag);
  }

  // --- 雲と、下のほうの海色の板（奈落の見た目）
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random() * 1.6, 10, 7), MAT.cloud);
    c.scale.y = 0.4;
    c.position.set((Math.random() - 0.5) * 70, 9 + Math.random() * 8, Math.random() * 55 - 8);
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

class Rig {
  constructor(colorIdx, name) {
    const color = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
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
let platformBody = null;
const GROUP_WORLD = 1, GROUP_OBJ = 2;
const playerGroup = (idx) => 4 << idx; // idx 0..4 → bit 2..6

function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0), allowSleep: false });
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
    world.addBody(body);
  }

  // 動的オブジェクト
  for (const o of dynObjects) {
    const isPlat = o.kind === 'platform';
    const body = new CANNON.Body({
      mass: isPlat ? 0 : o.mass,
      type: isPlat ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC,
      material: groundMaterial,
      position: new CANNON.Vec3(...o.home.p),
      collisionFilterGroup: isPlat ? GROUP_WORLD : GROUP_OBJ,
      linearDamping: 0.05,
      angularDamping: 0.05,
    });
    if (o.kind === 'sphere') body.addShape(new CANNON.Sphere(o.radius));
    else body.addShape(new CANNON.Box(new CANNON.Vec3(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2)));
    world.addBody(body);
    o.body = body;
    if (isPlat) platformBody = body;
  }
}

function movePlatform() {
  if (!platformBody) return;
  const nx = Math.sin(simT * 0.55) * 2.8;
  platformBody.velocity.set((nx - platformBody.position.x) / FIXED_DT, 0, 0);
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
      hand.dollId = id;
      world.addBody(hand);
      this.sides.push({ sx, body: hand, grabC: null, holdC: null });
    }

    this.respawn();
  }

  spawnPos() {
    const cp = CHECKPOINTS[this.cp];
    return new CANNON.Vec3(cp.x + ((this.id % MAX_PLAYERS) - 2) * 0.7, 1.1, cp.z);
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
    const groundVel = grounded && ray.body ? ray.body.velocity : null;
    const hanging = this.grabbing;

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
  return [...metas.values()].map((m) => ({ id: m.id, name: m.name, color: m.color, goal: m.goal }));
}

function updatePlayersHud() {
  hudPlayersEl.innerHTML = '';
  for (const m of metas.values()) {
    const row = document.createElement('div');
    row.className = 'prow';
    const dot = document.createElement('span');
    dot.className = 'pdot';
    dot.style.background = '#' + PLAYER_COLORS[m.color % PLAYER_COLORS.length].toString(16).padStart(6, '0');
    row.appendChild(dot);
    row.appendChild(document.createTextNode((m.goal ? '🏁 ' : '') + m.name + (m.id === myId ? '（あなた）' : '')));
    hudPlayersEl.appendChild(row);
  }
}

function addMetaAndRig(m) {
  metas.set(m.id, { ...m });
  rigs.set(m.id, new Rig(m.color, m.name));
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
  initPhysics();
  addMetaAndRig({ id: 0, name: getPlayerName(), color: 0, goal: false });
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
      const colorIdx = pid % PLAYER_COLORS.length;
      const name = (m.name || '').slice(0, 8) || 'ゲスト' + pid;
      addMetaAndRig({ id: pid, name, color: colorIdx, goal: false });
      dolls.set(pid, new Doll(pid, colorIdx));
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
  roomCode = code;
  netStatus('接続中…');
  guestOpen(code, {
    onOpen: (conn) => {
      hostConn = conn;
      conn.send({ t: 'join', name: getPlayerName() });
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
    movePlatform();
    for (const doll of dolls.values()) doll.control();
    world.step(FIXED_DT);
    phyAcc -= FIXED_DT;
  }

  // 落下・チェックポイント・ゴール判定
  for (const doll of dolls.values()) {
    const p = doll.torso.position;
    if (p.y < FALL_Y) { doll.respawn(); continue; }
    if (p.y > -1) {
      if (p.z > 27 && p.z < 35.5) doll.cp = Math.max(doll.cp, 2);
      else if (p.z > 12 && p.z < 22) doll.cp = Math.max(doll.cp, 1);
    }
    if (!doll.goal && Math.abs(p.x) < GOAL.x && p.z > GOAL.z && p.y > GOAL.y) {
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
    if (o.body && o.kind !== 'platform' && o.body.position.y < FALL_Y) {
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
  camera.position.set(Math.sin(t) * 26, 10, 18 + Math.cos(t) * 26);
  camera.lookAt(0, 0.5, 18);
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
  pos() {
    const rig = rigs.get(myId);
    return rig ? rig.group.position.toArray() : null;
  },
  pressKey(code) { keys.add(code); },
  releaseKey(code) { keys.delete(code); },
  jump() { jumpCount++; },
  setGrab(v) { keyGrab = v; },
};
