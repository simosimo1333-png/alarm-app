/* 対戦シーン */
class FightScene extends Phaser.Scene {
  constructor() { super("FightScene"); }

  init(data) {
    this.cfg = data;
    this.wins = [0, 0];
    this.round = 1;
  }

  create() {
    this._startRound(true);
  }

  /* ----- ラウンド開始 ----- */
  _startRound(first) {
    this.children.removeAll();
    this.projectiles = [];
    this.combo = [0, 0];
    this.comboTimer = [0, 0];
    this.hitStop = 0;
    this.roundState = "intro"; // intro -> fight -> over
    this.roundTimer = ROUND_TIME * 1000;
    this.overDelay = 0;
    this.paused = false;

    drawStage(this, this.cfg.stage);

    // ファイター生成
    const p1 = new Fighter(this, 280, 1, this.cfg.p1, false);
    let p2;
    if (this.cfg.mode === "2p") {
      p2 = new Fighter(this, GAME_W - 280, -1, this.cfg.p2, false);
    } else {
      const lvl = 0.45 + Math.min(0.4, (this.round - 1) * 0.12);
      p2 = new Fighter(this, GAME_W - 280, -1, this.cfg.p2, true, lvl);
    }
    this.fighters = [p1, p2];

    this._buildHUD();
    this._setupInput();

    // 演出
    this.announce(`ROUND ${this.round}`, "#f4d03f", 1100, () => {
      this.announce("ファイト！", "#ffffff", 700);
      this.roundState = "fight";
    });
  }

  _setupInput() {
    const kb = this.input.keyboard;
    this.keys1 = kb.addKeys({ left: "A", right: "D", up: "W", down: "S", punch: "F", kick: "G", special: "H" });
    this.keys2 = kb.addKeys({ left: "LEFT", right: "RIGHT", up: "UP", down: "DOWN", punch: "J", kick: "K", special: "L" });
    kb.on("keydown-ESC", () => this.scene.start("ModeScene"));
    kb.on("keydown-P", () => { this.paused = !this.paused; this.pauseLabel.setVisible(this.paused); });
    // 矢印キーでの画面スクロール抑止
    this.input.keyboard.addCapture("UP,DOWN,LEFT,RIGHT,SPACE");
  }

  _readInput(keys) {
    const J = Phaser.Input.Keyboard.JustDown;
    return {
      left: keys.left.isDown,
      right: keys.right.isDown,
      down: keys.down.isDown,
      up: J(keys.up),
      punch: J(keys.punch),
      kick: J(keys.kick),
      special: J(keys.special),
    };
  }

  /* ----- HUD ----- */
  _buildHUD() {
    const mk = (x, anchor, f, idx) => {
      const w = 380;
      const bx = anchor === "left" ? x : x - w;
      this.add.rectangle(bx, 30, w, 22, 0x000000, 0.6).setOrigin(0, 0.5);
      const bar = this.add.rectangle(
        anchor === "left" ? bx + 2 : bx + w - 2, 30, w - 4, 18,
        0x39d353, 1
      ).setOrigin(anchor === "left" ? 0 : 1, 0.5);
      this.add.text(anchor === "left" ? bx + 6 : bx + w - 6, 56, f.char.name, {
        fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff",
      }).setOrigin(anchor === "left" ? 0 : 1, 0.5).setShadow(1, 1, "#000", 3);
      // 勝利ランプ
      for (let i = 0; i < WINS_NEEDED; i++) {
        const lx = anchor === "left" ? bx + 6 + i * 22 : bx + w - 6 - i * 22;
        const lamp = this.add.circle(lx, 80, 7, 0x333333).setStrokeStyle(2, 0xffffff, 0.6)
          .setOrigin(anchor === "left" ? 0 : 1, 0.5);
        (idx === 0 ? (this.lamps1 = this.lamps1 || []) : (this.lamps2 = this.lamps2 || [])).push(lamp);
      }
      return { bar, w, anchor, bx };
    };
    this.hud1 = mk(30, "left", this.fighters[0], 0);
    this.hud2 = mk(GAME_W - 30, "right", this.fighters[1], 1);
    this._refreshLamps();

    this.timerText = this.add.text(GAME_W / 2, 30, ROUND_TIME, {
      fontFamily: "monospace", fontSize: "40px", color: "#ffffff",
      stroke: "#000", strokeThickness: 5,
    }).setOrigin(0.5);

    this.comboText1 = this.add.text(120, 130, "", { fontFamily: "serif", fontSize: "30px", color: "#f4d03f", stroke: "#5a2410", strokeThickness: 5 }).setOrigin(0.5).setAlpha(0);
    this.comboText2 = this.add.text(GAME_W - 120, 130, "", { fontFamily: "serif", fontSize: "30px", color: "#f4d03f", stroke: "#5a2410", strokeThickness: 5 }).setOrigin(0.5).setAlpha(0);

    this.announceText = this.add.text(GAME_W / 2, GAME_H / 2 - 20, "", {
      fontFamily: "serif", fontSize: "72px", color: "#ffffff", stroke: "#b5302a", strokeThickness: 8,
    }).setOrigin(0.5).setAlpha(0);

    this.pauseLabel = this.add.text(GAME_W / 2, GAME_H / 2, "PAUSE", {
      fontFamily: "serif", fontSize: "60px", color: "#ffffff",
    }).setOrigin(0.5).setVisible(false);

    // 操作ヒント
    const hint = this.cfg.mode === "2p"
      ? "1P: WASD移動 F弱 G強 H必殺   |   2P: ←↑↓→移動 J弱 K強 L必殺   |   ガード:後ろ入力"
      : "移動: A/D  ジャンプ: W  しゃがみ: S  弱:F 強:G 必殺:H  ガード:後退入力  Pで一時停止";
    this.add.text(GAME_W / 2, GAME_H - 16, hint, {
      fontFamily: "sans-serif", fontSize: "13px", color: "#dfe6ee",
    }).setOrigin(0.5).setShadow(1, 1, "#000", 3);
  }

  _refreshLamps() {
    (this.lamps1 || []).forEach((l, i) => l.setFillStyle(i < this.wins[0] ? 0xf4d03f : 0x333333));
    (this.lamps2 || []).forEach((l, i) => l.setFillStyle(i < this.wins[1] ? 0xf4d03f : 0x333333));
  }

  /* ----- 演出ヘルパ ----- */
  announce(txt, color, dur, after) {
    this.announceText.setText(txt).setColor(color).setAlpha(0).setScale(1.6);
    this.tweens.add({ targets: this.announceText, alpha: 1, scale: 1, duration: 200 });
    this.tweens.add({
      targets: this.announceText, alpha: 0, delay: dur - 200, duration: 200,
      onComplete: () => after && after(),
    });
  }

  showText(x, y, txt, color) {
    const t = this.add.text(x, y, txt, {
      fontFamily: "sans-serif", fontSize: "20px",
      color: "#" + color.toString(16).padStart(6, "0"), stroke: "#000", strokeThickness: 4,
    }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  hitSpark(x, y) {
    const g = this.add.graphics();
    g.fillStyle(0xfff2a8, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.fillCircle(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 5);
    }
    g.fillStyle(0xffffff, 1); g.fillCircle(x, y, 10);
    this.tweens.add({ targets: g, scale: 2.2, alpha: 0, duration: 220, onComplete: () => g.destroy() });
    this.cameras.main.shake(120, 0.006);
  }

  sfx(kind) {
    try {
      const ctx = this._actx || (this._actx = new (window.AudioContext || window.webkitAudioContext)());
      const o = ctx.createOscillator(), g = ctx.createGain();
      const map = {
        swing: [220, "triangle", 0.06], hit: [140, "square", 0.12],
        block: [320, "sawtooth", 0.05], special: [110, "sawtooth", 0.16],
        ko: [80, "square", 0.3],
      };
      const [f, type, life] = map[kind] || map.swing;
      o.type = type; o.frequency.value = f;
      g.gain.value = 0.07;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      o.frequency.exponentialRampToValueAtTime(Math.max(40, f * 0.5), ctx.currentTime + life);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + life);
      o.stop(ctx.currentTime + life);
    } catch (e) { /* オーディオ未許可時は無音 */ }
  }

  onHit(defender) {
    const ai = this.fighters[0] === defender ? 1 : 0;
    this.combo[ai]++;
    this.comboTimer[ai] = 1200;
    this.hitStop = 60;
    if (this.combo[ai] >= 2) {
      const t = ai === 0 ? this.comboText1 : this.comboText2;
      t.setText(`${this.combo[ai]} HIT!`).setAlpha(1).setScale(1.4);
      this.tweens.add({ targets: t, scale: 1, duration: 150 });
    }
  }

  spawnProjectile(owner) {
    const dir = owner.facing;
    const px = owner.x + dir * 40;
    const py = owner.y - 74;
    const g = this.add.graphics();
    const proj = { g, x: px, y: py, vx: dir * 520, owner, dmg: Math.round(12 * owner.char.power), life: 1600, dir };
    this.projectiles.push(proj);
    this.sfx("special");
  }

  _drawProjectile(p) {
    const g = p.g; g.clear();
    // 枡（ます）が回転しながら飛ぶ
    g.save(); g.translateCanvas(p.x, p.y);
    g.rotateCanvas(p.x / 30 * p.dir);
    g.fillStyle(0xdca86a, 1); g.fillRect(-12, -12, 24, 24);
    g.lineStyle(3, 0x6a4a28, 1); g.strokeRect(-12, -12, 24, 24);
    g.fillStyle(0xffffff, 0.85); g.fillRect(-7, -7, 14, 14);
    g.restore();
    g.fillStyle(0x9ec7e8, 0.4); g.fillCircle(p.x - p.dir * 16, p.y, 8);
  }

  /* ----- メインループ ----- */
  update(time, delta) {
    let dt = Math.min(delta, 40);
    if (this.paused) return;

    // ヒットストップ（演出の溜め）
    if (this.hitStop > 0) { this.hitStop -= dt; dt = 0; }

    // コンボ表示の減衰
    for (let i = 0; i < 2; i++) {
      if (this.comboTimer[i] > 0) {
        this.comboTimer[i] -= delta;
        if (this.comboTimer[i] <= 0) {
          this.combo[i] = 0;
          (i === 0 ? this.comboText1 : this.comboText2).setAlpha(0);
        }
      }
    }

    // タイマー
    if (this.roundState === "fight" && dt > 0) {
      this.roundTimer -= delta;
      if (this.roundTimer <= 0) { this.roundTimer = 0; this._endRound("time"); }
      this.timerText.setText(Math.ceil(this.roundTimer / 1000));
    }

    // 入力（操作可能なのは fight 中のみ）
    const active = this.roundState === "fight";
    const in1 = active ? this._readInput(this.keys1) : null;
    const in2 = (active && this.cfg.mode === "2p") ? this._readInput(this.keys2) : null;

    if (dt > 0) {
      this.fighters[0].update(dt, in1);
      this.fighters[1].update(dt, in2);
      this._resolveCombat();
      this._resolveProjectiles(dt);
      this._resolvePush();
    } else {
      // ヒットストップ中も描画だけ更新
      this.fighters.forEach((f) => f.draw());
    }

    // HUD更新
    this._updateBar(this.hud1, this.fighters[0]);
    this._updateBar(this.hud2, this.fighters[1]);

    // KO判定
    if (this.roundState === "fight") {
      const ko = this.fighters.find((f) => f.ko);
      if (ko) this._endRound("ko");
    }

    // ラウンド終了後の遷移
    if (this.roundState === "over") {
      this.overDelay -= delta;
      if (this.overDelay <= 0) this._afterRound();
    }
  }

  _updateBar(hud, f) {
    const fullW = hud.w - 4;
    const r = f.hpRatio;
    hud.bar.width = Math.max(0, fullW * r);
    const col = r > 0.5 ? 0x39d353 : r > 0.25 ? 0xf0c000 : 0xe23b30;
    hud.bar.setFillStyle(col);
  }

  _resolveCombat() {
    const [a, b] = this.fighters;
    this._checkHit(a, b);
    this._checkHit(b, a);
  }

  _checkHit(att, def) {
    if (att.attackHit || def.ko) return;
    const hr = att.getHitRect();
    if (!hr) return;
    if (att.attack && att.attack.isProjectile) return; // 飛び道具は別処理
    const br = def.getBodyRect();
    if (Phaser.Geom.Intersects.RectangleToRectangle(hr, br)) {
      att.attackHit = true;
      const a = att.attack;
      def.takeHit(a.damage, a.knock, a.stun, att.facing);
    }
  }

  _resolveProjectiles(dt) {
    const sec = dt / 1000;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * sec;
      p.life -= dt;
      this._drawProjectile(p);
      const target = p.owner.opponent;
      let hitOrGone = p.life <= 0 || p.x < STAGE_LEFT - 30 || p.x > STAGE_RIGHT + 30;
      if (target && !target.ko && !hitOrGone) {
        const pr = new Phaser.Geom.Rectangle(p.x - 12, p.y - 12, 24, 24);
        if (Phaser.Geom.Intersects.RectangleToRectangle(pr, target.getBodyRect())) {
          target.takeHit(p.dmg, 300, 380, p.dir);
          hitOrGone = true;
        }
      }
      if (hitOrGone) { p.g.destroy(); this.projectiles.splice(i, 1); }
    }
  }

  _resolvePush() {
    // 重なり防止（押し合い）
    const [a, b] = this.fighters;
    const minDist = (a.bodyW + b.bodyW) / 2 - 6;
    const d = b.x - a.x;
    const ad = Math.abs(d);
    if (ad < minDist && ad > 0.01) {
      const overlap = (minDist - ad) / 2;
      const dir = Math.sign(d);
      if (!a.ko) a.x -= dir * overlap;
      if (!b.ko) b.x += dir * overlap;
      a.x = Phaser.Math.Clamp(a.x, STAGE_LEFT, STAGE_RIGHT);
      b.x = Phaser.Math.Clamp(b.x, STAGE_LEFT, STAGE_RIGHT);
    }
  }

  _endRound(reason) {
    if (this.roundState !== "fight") return;
    this.roundState = "over";
    this.overDelay = 1900;

    const [p1, p2] = this.fighters;
    let winner; // 0,1, or -1 draw
    if (reason === "ko") winner = p1.ko && p2.ko ? -1 : (p1.ko ? 1 : 0);
    else winner = p1.hpRatio > p2.hpRatio ? 0 : (p2.hpRatio > p1.hpRatio ? 1 : -1);

    this.lastWinner = winner;
    if (winner >= 0) {
      this.wins[winner]++;
      this._refreshLamps();
      this.sfx("ko");
      this.announce(winner === 0 ? "1P WIN!" : (this.cfg.mode === "2p" ? "2P WIN!" : "YOU LOSE…"),
        winner === 0 ? "#f4d03f" : "#9ec7e8", 1800);
    } else {
      this.announce("DRAW", "#ffffff", 1800);
    }
    this.cameras.main.flash(200, 255, 255, 255);
  }

  _afterRound() {
    if (this.wins[0] >= WINS_NEEDED || this.wins[1] >= WINS_NEEDED) {
      const matchWinner = this.wins[0] >= WINS_NEEDED ? 0 : 1;
      this.scene.start("ResultScene", {
        mode: this.cfg.mode,
        winnerName: this.fighters[matchWinner].char.name,
        winnerKey: this.fighters[matchWinner].char.key,
        winnerSide: matchWinner,
        stage: this.cfg.stage,
        score: `${this.wins[0]} - ${this.wins[1]}`,
      });
    } else {
      this.round++;
      this._startRound(false);
    }
  }
}
