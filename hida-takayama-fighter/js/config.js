/* =========================================================
 * 飛騨高山ファイター - グローバル設定・キャラ/ステージ定義
 * ========================================================= */

const GAME_W = 960;
const GAME_H = 540;
const GROUND_Y = 470; // 地面（足元）のY座標
const STAGE_LEFT = 70;
const STAGE_RIGHT = GAME_W - 70;

const MAX_HP = 100;
const ROUND_TIME = 60; // 秒
const WINS_NEEDED = 2; // 2本先取

/* ---------------------------------------------------------
 * キャラクター（飛騨高山モチーフ）
 *  - speed     : 移動速度(px/s)
 *  - jump      : ジャンプ初速
 *  - power     : 与ダメージ倍率
 *  - maxHp     : 体力
 *  - colors    : 描画色
 *  - projectile: 必殺技が飛び道具か
 * ------------------------------------------------------- */
const CHARACTERS = [
  {
    key: "matsuri",
    name: "祭男（まつりお）",
    title: "高山祭の担ぎ手",
    desc: "バランス型。攻守ともに隙が少ない万能ファイター。",
    speed: 230, jump: 720, power: 1.0, maxHp: 100,
    projectile: false,
    colors: { body: 0xd6342c, accent: 0xf4d03f, skin: 0xf0c9a0, hair: 0x2b2b2b, trim: 0xffffff },
    headgear: "hachimaki", // 鉢巻き
  },
  {
    key: "sarubobo",
    name: "さるぼぼ",
    title: "飛騨のお守り人形",
    desc: "スピード型。素早い動きと連打で翻弄するが打たれ弱い。",
    speed: 310, jump: 820, power: 0.82, maxHp: 86,
    projectile: false,
    colors: { body: 0xe23b30, accent: 0x111111, skin: 0xe23b30, hair: 0x000000, trim: 0xffd24a },
    headgear: "none", // さるぼぼは顔が無い
    faceless: true,
  },
  {
    key: "gyu",
    name: "飛騨牛（ひだぎゅう）",
    title: "ブランド和牛の化身",
    desc: "パワー型。体力と一撃の重さは随一だが動きは鈍い。",
    speed: 165, jump: 600, power: 1.32, maxHp: 124,
    projectile: false,
    colors: { body: 0x2f2a28, accent: 0xd98a6a, skin: 0xf3c6b6, hair: 0x1a1512, trim: 0xffffff },
    headgear: "horns", // 角
  },
  {
    key: "sake",
    name: "酒蔵マスター",
    title: "造り酒屋の杜氏",
    desc: "技巧型。必殺技で枡（ます）を投げる飛び道具を持つ。",
    speed: 205, jump: 700, power: 0.95, maxHp: 96,
    projectile: true,
    colors: { body: 0x214a73, accent: 0xffffff, skin: 0xf0c9a0, hair: 0x3a3a3a, trim: 0x9ec7e8 },
    headgear: "tenugui", // 手ぬぐい
  },
];

/* ---------------------------------------------------------
 * ステージ（飛騨高山の名所）
 * ------------------------------------------------------- */
const STAGES = [
  { key: "sanmachi", name: "古い町並み（さんまち）" },
  { key: "festival", name: "高山祭 夜の屋台" },
  { key: "sakagura", name: "造り酒屋の蔵" },
  { key: "satoyama", name: "飛騨の里" },
];

/* ---------------------------------------------------------
 * 攻撃データ（ms単位の発生/持続/硬直）
 * ------------------------------------------------------- */
const ATTACKS = {
  punch:   { startup: 70,  active: 70,  recovery: 130, damage: 6,  reach: 64,  height: 40,  knock: 130, stun: 230, name: "弱" },
  kick:    { startup: 110, active: 90,  recovery: 200, damage: 11, reach: 84,  height: 30,  knock: 230, stun: 320, name: "強" },
  special: { startup: 150, active: 120, recovery: 280, damage: 17, reach: 96,  height: 50,  knock: 360, stun: 460, name: "必殺" },
};

const GRAVITY = 2000; // px/s^2

/* ---------------------------------------------------------
 * 背景描画（ステージごと）。一度だけ描いて使い回す。
 * ------------------------------------------------------- */
function drawStage(scene, stageKey) {
  const g = scene.add.graphics();
  const W = GAME_W, H = GAME_H;

  const sky = (top, bottom) => {
    // 簡易グラデーション（横帯で表現）
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(top),
        Phaser.Display.Color.ValueToColor(bottom),
        steps - 1, i
      );
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillRect(0, (H * i) / steps, W, H / steps + 1);
    }
  };

  if (stageKey === "sanmachi") {
    sky(0xbfe0ef, 0xe9f3f0);
    // 遠景の山
    g.fillStyle(0x7fa37e, 1);
    g.beginPath(); g.moveTo(0, 230);
    g.lineTo(180, 150); g.lineTo(360, 220); g.lineTo(560, 140);
    g.lineTo(760, 210); g.lineTo(960, 160); g.lineTo(960, 320); g.lineTo(0, 320);
    g.closePath(); g.fillPath();
    // 用水路沿いの町家（左右に黒い格子の家）
    const house = (x, w, col) => {
      g.fillStyle(col, 1); g.fillRect(x, 200, w, GROUND_Y - 200);
      g.fillStyle(0x3a2c22, 1); g.fillRect(x, 200, w, 18); // 屋根
      // 格子窓
      g.fillStyle(0x2b211a, 1);
      for (let wx = x + 12; wx < x + w - 12; wx += 16) g.fillRect(wx, 250, 3, 110);
      for (let wy = 250; wy < GROUND_Y - 20; wy += 16) g.fillRect(x + 10, wy, w - 20, 2);
    };
    house(0, 150, 0x5b4636); house(150, 130, 0x6b5341);
    house(680, 130, 0x6b5341); house(810, 150, 0x5b4636);
    // 用水路
    g.fillStyle(0x6fb6c7, 1); g.fillRect(0, GROUND_Y, W, 12);
    // 地面（石畳）
    g.fillStyle(0x9a8f82, 1); g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle(0x8a8074, 1);
    for (let x = 0; x < W; x += 38) g.fillRect(x, GROUND_Y + 14, 34, H - GROUND_Y - 18);
  } else if (stageKey === "festival") {
    sky(0x0b1030, 0x241b3a);
    // 月
    g.fillStyle(0xf6efb0, 1); g.fillCircle(820, 90, 38);
    // 屋台（中央奥）
    g.fillStyle(0x3a2118, 1); g.fillRect(330, 150, 300, 230);
    g.fillStyle(0x12100e, 1);
    g.beginPath(); g.moveTo(300, 150); g.lineTo(480, 90); g.lineTo(660, 150); g.closePath(); g.fillPath();
    g.fillStyle(0xc9a23a, 1); g.fillRect(330, 150, 300, 10);
    // 提灯（ちょうちん）
    for (let i = 0; i < 8; i++) {
      const lx = 110 + i * 100;
      g.lineStyle(2, 0x554433, 1); g.lineBetween(lx, 60, lx, 96);
      g.fillStyle(0xff5a3c, 1); g.fillEllipse(lx, 112, 26, 36);
      g.fillStyle(0xffd86a, 0.9); g.fillEllipse(lx, 112, 14, 22);
    }
    // 地面
    g.fillStyle(0x2a2230, 1); g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle(0x342a3a, 1);
    for (let x = 0; x < W; x += 42) g.fillRect(x, GROUND_Y + 12, 38, H - GROUND_Y - 16);
  } else if (stageKey === "sakagura") {
    sky(0x3a2c22, 0x241b16);
    // 蔵の壁（白漆喰＋腰板）
    g.fillStyle(0xe8e2d4, 1); g.fillRect(0, 80, W, GROUND_Y - 80);
    g.fillStyle(0x4a382b, 1); g.fillRect(0, GROUND_Y - 90, W, 90);
    // 梁
    g.fillStyle(0x6a4f3a, 1); g.fillRect(0, 80, W, 16);
    for (let x = 120; x < W; x += 200) g.fillRect(x, 80, 14, GROUND_Y - 170);
    // 杉玉（すぎだま）
    const sugidama = (x, y, r) => {
      g.fillStyle(0x6f7a3a, 1); g.fillCircle(x, y, r);
      g.fillStyle(0x59642f, 1); g.fillCircle(x - r * 0.3, y - r * 0.2, r * 0.5);
    };
    sugidama(200, 150, 34); sugidama(760, 150, 34);
    // 酒樽
    const barrel = (x) => {
      g.fillStyle(0xb98a4a, 1); g.fillRoundedRect(x, GROUND_Y - 70, 70, 70, 8);
      g.lineStyle(4, 0x3a2c1a, 1);
      g.strokeRect(x, GROUND_Y - 58, 70, 6); g.strokeRect(x, GROUND_Y - 24, 70, 6);
      g.fillStyle(0xe8e2d4, 1); g.fillCircle(x + 35, GROUND_Y - 40, 16);
      g.fillStyle(0x214a73, 1); g.fillRect(x + 27, GROUND_Y - 48, 16, 16);
    };
    barrel(110); barrel(770);
    // 地面（土間）
    g.fillStyle(0x6b5a45, 1); g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  } else { // satoyama
    sky(0x9fd0ef, 0xe8f6ef);
    // 雲
    g.fillStyle(0xffffff, 0.9);
    g.fillEllipse(180, 90, 120, 44); g.fillEllipse(700, 70, 150, 50); g.fillEllipse(520, 120, 90, 34);
    // 山並み
    g.fillStyle(0x6f9bbf, 1);
    g.beginPath(); g.moveTo(0, 200); g.lineTo(240, 90); g.lineTo(480, 210); g.lineTo(720, 100); g.lineTo(960, 200); g.lineTo(960, 300); g.lineTo(0, 300); g.closePath(); g.fillPath();
    // 雪の頭
    g.fillStyle(0xffffff, 0.85);
    g.beginPath(); g.moveTo(200, 120); g.lineTo(240, 90); g.lineTo(280, 120); g.closePath(); g.fillPath();
    // 丘
    g.fillStyle(0x77b56a, 1); g.fillRect(0, 280, W, GROUND_Y - 280);
    // 合掌造りの家
    const gassho = (x, s) => {
      g.fillStyle(0x6a5235, 1);
      g.beginPath(); g.moveTo(x, 300); g.lineTo(x + 40 * s, 230); g.lineTo(x + 80 * s, 300); g.closePath(); g.fillPath();
      g.fillStyle(0x8a6b45, 1); g.fillRect(x + 10 * s, 300, 60 * s, 50);
    };
    gassho(120, 1); gassho(720, 1.1);
    // 田んぼの地面
    g.fillStyle(0x5a8f4a, 1); g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle(0x4d7d40, 1);
    for (let x = 0; x < W; x += 50) g.fillRect(x, GROUND_Y + 10, 44, H - GROUND_Y - 14);
  }

  return g;
}
