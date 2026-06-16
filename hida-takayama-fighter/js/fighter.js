/* =========================================================
 * Fighter - ファイター本体（物理 / 状態 / 描画）
 * ========================================================= */

class Fighter {
  constructor(scene, x, facing, charKey, isCPU, cpuLevel) {
    this.scene = scene;
    this.char = CHARACTERS.find((c) => c.key === charKey) || CHARACTERS[0];
    this.isCPU = !!isCPU;
    this.cpuLevel = cpuLevel || 0.55; // 0..1 強さ

    // 物理
    this.x = x;
    this.y = GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing; // 1=右向き / -1=左向き
    this.onGround = true;

    // 当たり判定サイズ
    this.bodyW = 46;
    this.bodyH = 116;

    // 状態
    this.hp = this.char.maxHp;
    this.state = "idle";
    this.stateTime = 0;     // 現在状態の経過ms
    this.attack = null;     // 実行中の攻撃データ
    this.attackHit = false; // この攻撃で既にヒットさせたか
    this.blocking = false;
    this.hitStun = 0;       // のけぞり残りms
    this.invuln = 0;
    this.animT = 0;         // 描画用アニメーション時間
    this.ko = false;
    this.flash = 0;

    // CPU思考タイマー
    this.cpuThink = 0;
    this.cpuAction = "idle";

    // 描画
    this.g = scene.add.graphics();
    this.shadow = scene.add.graphics();
    this.label = null;
  }

  get opponent() {
    return this.scene.fighters.find((f) => f !== this);
  }

  /* 体力比率 */
  get hpRatio() {
    return Math.max(0, this.hp / this.char.maxHp);
  }

  /* 当たり判定（胴体） */
  getBodyRect() {
    const h = this.state === "crouch" || this.blocking && this.crouchBlock ? this.bodyH * 0.6 : this.bodyH;
    return new Phaser.Geom.Rectangle(this.x - this.bodyW / 2, this.y - h, this.bodyW, h);
  }

  /* 攻撃判定（発生中のみ） */
  getHitRect() {
    if (!this.attack || this.state !== "attack") return null;
    const a = this.attack;
    if (this.stateTime < a.startup || this.stateTime > a.startup + a.active) return null;
    const reach = a.reach;
    const cy = this.y - 70 - (a.name === "強" ? 10 : 0);
    const x = this.facing === 1 ? this.x + this.bodyW / 2 : this.x - this.bodyW / 2 - reach;
    return new Phaser.Geom.Rectangle(x, cy - a.height / 2, reach, a.height);
  }

  canAct() {
    if (this.ko) return false;
    if (this.hitStun > 0) return false;
    if (this.state === "attack") return false;
    return true;
  }

  faceOpponent() {
    const o = this.opponent;
    if (!o) return;
    if (Math.abs(o.x - this.x) > 6) this.facing = o.x > this.x ? 1 : -1;
  }

  /* ---------------- 入力アクション ---------------- */
  moveLeft()  { if (this.canAct() && this.onGround) this.vx = -this.char.speed; }
  moveRight() { if (this.canAct() && this.onGround) this.vx =  this.char.speed; }

  jump() {
    if (this.canAct() && this.onGround) {
      this.vy = -this.char.jump;
      this.onGround = false;
      this.setState("jump");
    }
  }

  crouch() {
    if (this.canAct() && this.onGround) this.setState("crouch");
  }

  startAttack(type) {
    if (!this.canAct()) return;
    const base = ATTACKS[type];
    this.attack = Object.assign({}, base, {
      damage: Math.round(base.damage * this.char.power),
      type,
    });
    this.attackHit = false;
    this.setState("attack");
    if (this.onGround) this.vx = 0;
    // 飛び道具キャラの必殺技
    if (type === "special" && this.char.projectile) {
      this.attack.isProjectile = true;
    }
    this.scene.sfx(type === "special" ? "special" : "swing");
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  takeHit(dmg, knock, stun, fromFacing) {
    if (this.ko || this.invuln > 0) return;
    // ガード成立判定（相手と反対方向へ入力中）
    if (this.blocking) {
      this.hp -= Math.max(1, Math.round(dmg * 0.18));
      this.vx = fromFacing * knock * 0.4;
      this.flash = 60;
      this.scene.sfx("block");
      this.scene.showText(this.x, this.y - this.bodyH - 10, "ガード", 0x9ec7e8);
    } else {
      this.hp -= dmg;
      this.hitStun = stun;
      this.vx = fromFacing * knock;
      if (!this.onGround) this.vy = -180;
      this.flash = 120;
      this.setState("hit");
      this.scene.sfx("hit");
      this.scene.hitSpark(
        this.facing === 1 ? this.x - this.bodyW / 2 : this.x + this.bodyW / 2,
        this.y - 70
      );
      this.scene.onHit(this);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.ko = true;
      this.setState("ko");
      this.vx = fromFacing * 260;
      this.vy = -360;
    }
  }

  /* ---------------- CPU思考 ---------------- */
  cpuUpdate(dt) {
    const o = this.opponent;
    if (!o || this.ko || o.ko) return;
    this.cpuThink -= dt;
    const dist = Math.abs(o.x - this.x);

    // 相手の攻撃が来ていたら一定確率でガード/回避
    const incoming = o.getHitRect();
    if (incoming && this.canAct()) {
      if (Math.random() < this.cpuLevel * 0.7) {
        this.cpuAction = "block";
        this.cpuThink = 140;
      } else if (Math.random() < this.cpuLevel * 0.5) {
        this.jump();
      }
    }

    if (this.cpuThink <= 0) {
      this.cpuThink = 260 - this.cpuLevel * 120 + Math.random() * 220;
      const r = Math.random();
      if (dist > 230) {
        this.cpuAction = "approach";
      } else if (dist > 110) {
        this.cpuAction = r < 0.55 ? "approach" : (r < 0.75 ? "special" : "kick");
      } else {
        if (r < 0.34) this.cpuAction = "punch";
        else if (r < 0.6) this.cpuAction = "kick";
        else if (r < 0.74) this.cpuAction = "special";
        else if (r < 0.86) this.cpuAction = "retreat";
        else this.cpuAction = "block";
      }
    }

    // 行動実行
    switch (this.cpuAction) {
      case "approach":
        if (o.x > this.x) this.moveRight(); else this.moveLeft();
        if (dist > 260 && this.onGround && Math.random() < 0.01) this.jump();
        break;
      case "retreat":
        if (o.x > this.x) this.moveLeft(); else this.moveRight();
        break;
      case "block":
        this.blocking = this.onGround;
        break;
      case "punch": if (this.canAct() && dist < 120) this.startAttack("punch"); this.cpuAction = "idle"; break;
      case "kick":  if (this.canAct() && dist < 150) this.startAttack("kick");  this.cpuAction = "idle"; break;
      case "special":
        if (this.canAct() && (dist < 170 || this.char.projectile)) this.startAttack("special");
        this.cpuAction = "idle";
        break;
    }
  }

  /* ---------------- 毎フレーム更新 ---------------- */
  update(dt, input) {
    const sec = dt / 1000;
    this.animT += dt;
    this.stateTime += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitStun > 0) this.hitStun -= dt;

    this.blocking = false;
    this.crouchBlock = false;

    if (!this.ko) {
      if (this.isCPU) {
        this.cpuUpdate(dt);
      } else if (input) {
        this.handleInput(input);
      }
    }

    // 攻撃の状態遷移
    if (this.state === "attack" && this.attack) {
      const a = this.attack;
      // 飛び道具の発射
      if (a.isProjectile && !a.fired && this.stateTime >= a.startup) {
        a.fired = true;
        this.scene.spawnProjectile(this);
      }
      if (this.stateTime >= a.startup + a.active + a.recovery) {
        this.attack = null;
        this.setState(this.onGround ? "idle" : "jump");
      }
    }

    // のけぞり終了
    if (this.state === "hit" && this.hitStun <= 0 && !this.ko) {
      this.setState(this.onGround ? "idle" : "jump");
    }

    // 物理：重力
    if (!this.onGround) {
      this.vy += GRAVITY * sec;
    }
    this.x += this.vx * sec;
    this.y += this.vy * sec;

    // 地面
    if (this.y >= GROUND_Y) {
      this.y = GROUND_Y;
      this.vy = 0;
      if (!this.onGround) {
        this.onGround = true;
        if (this.state === "jump") this.setState("idle");
        if (this.ko) this.vx *= 0.3;
      }
    }

    // 地上摩擦
    if (this.onGround && this.state !== "attack") {
      this.vx *= this.ko ? 0.86 : (this.hitStun > 0 ? 0.9 : 0.6);
      if (Math.abs(this.vx) < 6) this.vx = 0;
    }

    // ステージ端
    if (this.x < STAGE_LEFT) { this.x = STAGE_LEFT; if (this.vx < 0) this.vx = 0; }
    if (this.x > STAGE_RIGHT) { this.x = STAGE_RIGHT; if (this.vx > 0) this.vx = 0; }

    if (!this.ko && this.onGround && this.state !== "attack" && this.hitStun <= 0) {
      this.faceOpponent();
    }

    this.draw();
  }

  handleInput(input) {
    const o = this.opponent;
    const towardRight = o ? o.x > this.x : true; // 相手は右側か
    let movingX = false;

    if (this.canAct()) {
      // ガード：相手と反対方向の移動キーを押し続ける（地上）
      const pressBack = towardRight ? input.left : input.right;
      if (pressBack && this.onGround && !input.up) {
        this.blocking = true;
      }

      if (input.left)  { this.moveLeft();  movingX = true; }
      if (input.right) { this.moveRight(); movingX = true; }
      if (input.up)    this.jump();
      if (input.down && this.onGround && !movingX) this.crouch();

      if (input.punch)   this.startAttack("punch");
      if (input.kick)    this.startAttack("kick");
      if (input.special) this.startAttack("special");

      // 状態の見た目
      if (this.onGround && this.state !== "attack") {
        if (input.down && !movingX) this.setState("crouch");
        else if (movingX) this.setState("walk");
        else this.setState("idle");
      }
    }
  }

  /* ---------------- 描画 ---------------- */
  draw() {
    const g = this.g;
    g.clear();
    this.shadow.clear();

    // 影
    this.shadow.fillStyle(0x000000, 0.28);
    const air = Math.max(0, GROUND_Y - this.y);
    const sw = 44 - air * 0.04;
    this.shadow.fillEllipse(this.x, GROUND_Y + 6, Math.max(14, sw), 12);

    const c = this.char.colors;
    const flashing = this.flash > 0 && Math.floor(this.animT / 40) % 2 === 0;
    const body = flashing ? 0xffffff : c.body;

    // ローカル座標で人型を描く（足元 = this.y）
    g.save();
    g.translateCanvas(this.x, this.y);
    g.scaleCanvas(this.facing, 1);

    this._drawPose(g, body, c);

    g.restore();
  }

  _limb(g, color, x1, y1, x2, y2, w) {
    g.lineStyle(w, color, 1);
    g.lineBetween(x1, y1, x2, y2);
    g.fillStyle(color, 1);
    g.fillCircle(x2, y2, w / 2);
  }

  _drawPose(g, body, c) {
    const t = this.animT / 1000;
    let hipY = -52, headY = -104, lean = 0;
    let legA = 0, armFront = 0, armBack = 0, kneeBend = 0;

    switch (this.state) {
      case "walk": {
        const s = Math.sin(t * 12);
        legA = s * 16; armFront = -s * 18; armBack = s * 18;
        hipY = -52 + Math.abs(Math.cos(t * 12)) * -2;
        break;
      }
      case "idle": {
        hipY = -52 + Math.sin(t * 3) * 2;
        headY = -104 + Math.sin(t * 3) * 2;
        armFront = 6; armBack = -6;
        break;
      }
      case "crouch":
        hipY = -30; headY = -70; kneeBend = 22; armFront = 10; armBack = 10;
        break;
      case "jump":
        hipY = -58; legA = 18; kneeBend = 16; armFront = -20; armBack = -14;
        break;
      case "hit":
        lean = -10; armFront = 24; armBack = 18; headY = -100;
        break;
      case "ko":
        this._drawKO(g, body, c);
        return;
      case "attack":
        this._drawAttack(g, body, c, hipY, headY);
        return;
    }
    if (this.blocking) { armFront = 4; armBack = 4; }

    const hipX = lean;
    const shoulderY = hipY - 44;
    // 脚
    this._limb(g, body, hipX - 4, hipY, hipX - 10 + legA, -kneeBend, 11);
    this._limb(g, body, hipX - 10 + legA, -kneeBend, hipX - 12 + legA, 0, 11);
    this._limb(g, body, hipX + 4, hipY, hipX + 10 - legA, -kneeBend, 11);
    this._limb(g, body, hipX + 10 - legA, -kneeBend, hipX + 12 - legA, 0, 11);
    // 胴
    g.fillStyle(body, 1);
    g.fillRoundedRect(hipX - 16, shoulderY, 32, hipY - shoulderY + 6, 8);
    // 帯／アクセント
    g.fillStyle(c.accent, 1);
    g.fillRect(hipX - 16, hipY - 12, 32, 8);
    // 腕
    if (this.blocking) {
      // ガード姿勢：両腕を前で交差
      this._limb(g, c.skin, hipX + 6, shoulderY + 6, hipX + 22, shoulderY + 2, 9);
      this._limb(g, c.skin, hipX - 2, shoulderY + 10, hipX + 20, shoulderY + 14, 9);
    } else {
      this._limb(g, body, hipX - 12, shoulderY + 4, hipX - 16 + armBack, shoulderY + 28, 9);
      this._limb(g, c.skin, hipX - 16 + armBack, shoulderY + 28, hipX - 18 + armBack, shoulderY + 40, 8);
      this._limb(g, body, hipX + 12, shoulderY + 4, hipX + 16 + armFront, shoulderY + 28, 9);
      this._limb(g, c.skin, hipX + 16 + armFront, shoulderY + 28, hipX + 18 + armFront, shoulderY + 40, 8);
    }
    // 頭
    this._drawHead(g, c, hipX + lean, headY);
  }

  _drawAttack(g, body, c, hipY, headY) {
    const a = this.attack;
    const phase = this.stateTime < a.startup ? "startup"
      : this.stateTime < a.startup + a.active ? "active" : "recovery";
    const ext = phase === "active" ? 1 : (phase === "startup" ? 0.45 : 0.7);
    const shoulderY = hipY - 44;

    // 脚
    if (a.type === "kick") {
      // 前蹴り
      const kx = 16 + 50 * ext;
      this._limb(g, body, -4, hipY, -10, 0, 11);
      this._limb(g, c.body, 2, hipY, kx, -36, 12);
      this._limb(g, c.skin, kx, -36, kx + 12, -34, 11);
    } else {
      this._limb(g, body, -6, hipY, -12, 0, 11);
      this._limb(g, body, 6, hipY, 12, 0, 11);
    }
    // 胴
    g.fillStyle(body, 1);
    g.fillRoundedRect(-16, shoulderY, 32, hipY - shoulderY + 6, 8);
    g.fillStyle(c.accent, 1);
    g.fillRect(-16, hipY - 12, 32, 8);

    // 腕（パンチ／必殺）
    if (a.type === "punch") {
      const px = 16 + 46 * ext;
      this._limb(g, body, -12, shoulderY + 4, -18, shoulderY + 26, 9);
      this._limb(g, c.body, 12, shoulderY + 6, px, shoulderY + 2, 10);
      g.fillStyle(c.skin, 1); g.fillCircle(px, shoulderY + 2, 8);
    } else if (a.type === "special") {
      const px = 16 + 56 * ext;
      // 両腕を前へ（気合の一撃 / 枡投げ）
      this._limb(g, c.body, -10, shoulderY + 8, px - 12, shoulderY + 6, 10);
      this._limb(g, c.body, 12, shoulderY + 4, px, shoulderY - 2, 10);
      g.fillStyle(c.skin, 1); g.fillCircle(px, shoulderY - 2, 9);
      if (phase === "active") {
        g.fillStyle(c.accent, 0.5);
        g.fillCircle(px + 14, shoulderY, 16 + Math.sin(this.animT / 50) * 4);
      }
    } else {
      this._limb(g, body, -12, shoulderY + 4, -16, shoulderY + 28, 9);
      this._limb(g, body, 12, shoulderY + 4, 18, shoulderY + 28, 9);
    }
    this._drawHead(g, c, 0, headY);
  }

  _drawKO(g, body, c) {
    // 倒れた姿勢（横倒し）
    g.save();
    g.translateCanvas(0, -20);
    g.rotateCanvas(-Math.PI / 2 * 0.92);
    const hipY = -52, shoulderY = -96;
    this._limb(g, body, -6, hipY, -12, 0, 11);
    this._limb(g, body, 6, hipY, 12, 0, 11);
    g.fillStyle(body, 1);
    g.fillRoundedRect(-16, shoulderY, 32, hipY - shoulderY, 8);
    this._limb(g, body, -12, shoulderY + 6, -22, shoulderY + 26, 9);
    this._limb(g, body, 12, shoulderY + 6, 22, shoulderY + 26, 9);
    this._drawHead(g, c, 0, shoulderY - 14, true);
    g.restore();
  }

  _drawHead(g, c, x, y, ko) {
    // 顔
    g.fillStyle(c.skin, 1);
    g.fillCircle(x, y, 16);
    // 髪
    if (!this.char.faceless) {
      g.fillStyle(c.hair, 1);
      g.fillRoundedRect(x - 16, y - 18, 32, 14, 6);
    }
    // 目
    if (!this.char.faceless) {
      g.fillStyle(0x222222, 1);
      if (ko) {
        g.lineStyle(2, 0x222222, 1);
        g.lineBetween(x + 3, y - 4, x + 11, y + 2);
        g.lineBetween(x + 11, y - 4, x + 3, y + 2);
      } else {
        g.fillCircle(x + 6, y - 2, 2.4);
        g.fillCircle(x + 13, y - 2, 2.4);
      }
    } else {
      // さるぼぼ：顔が無く、頭巾の模様のみ
      g.fillStyle(c.trim, 1);
      g.fillCircle(x + 7, y, 4);
    }
    // 頭装備
    this._drawHeadgear(g, c, x, y);
  }

  _drawHeadgear(g, c, x, y) {
    switch (this.char.headgear) {
      case "hachimaki": // 鉢巻き
        g.fillStyle(0xffffff, 1); g.fillRect(x - 17, y - 10, 34, 6);
        g.fillStyle(0xd6342c, 1); g.fillCircle(x, y - 7, 3);
        g.fillStyle(0xffffff, 1);
        g.fillTriangle(x - 17, y - 9, x - 30, y - 2, x - 28, y - 12);
        break;
      case "horns": // 角
        g.fillStyle(0xeae0cf, 1);
        g.fillTriangle(x - 14, y - 12, x - 26, y - 26, x - 8, y - 18);
        g.fillTriangle(x + 14, y - 12, x + 26, y - 26, x + 8, y - 18);
        // 鼻環
        g.lineStyle(2, 0xf4d03f, 1); g.strokeCircle(x + 10, y + 8, 4);
        break;
      case "tenugui": // 手ぬぐい頬かむり
        g.fillStyle(c.trim, 1);
        g.fillRoundedRect(x - 17, y - 18, 34, 16, 6);
        g.fillStyle(0xffffff, 1);
        for (let i = -12; i < 14; i += 8) g.fillRect(x + i, y - 18, 3, 16);
        break;
      default: // none / さるぼぼ頭巾
        if (this.char.faceless) {
          g.fillStyle(c.trim, 1);
          g.fillRoundedRect(x - 16, y - 20, 32, 12, 6);
        }
        break;
    }
  }

  destroy() {
    this.g.destroy();
    this.shadow.destroy();
    if (this.label) this.label.destroy();
  }
}
