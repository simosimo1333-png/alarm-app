/* キャラクター & ステージ選択 */
class SelectScene extends Phaser.Scene {
  constructor() { super("SelectScene"); }

  init(data) {
    this.mode = data.mode || "1p";
    this.step = "p1"; // p1 -> p2/stage
    this.pick = { p1: null, p2: null, stage: null };
  }

  create() {
    drawStage(this, "satoyama");
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0d14, 0.5);

    this.title = this.add.text(GAME_W / 2, 50, "", {
      fontFamily: "serif", fontSize: "40px", color: "#ffffff",
      stroke: "#b5302a", strokeThickness: 6,
    }).setOrigin(0.5);

    this.hint = this.add.text(GAME_W / 2, GAME_H - 30, "クリック または 1〜4キーで選択", {
      fontFamily: "sans-serif", fontSize: "15px", color: "#cdd6e0",
    }).setOrigin(0.5);

    this.cardLayer = this.add.container(0, 0);
    this._showCharacters();

    this.input.keyboard.on("keydown", (e) => {
      const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };
      if (e.code in map) this._choose(map[e.code]);
      if (e.code === "Escape") this.scene.start("ModeScene");
    });
  }

  _label() {
    if (this.step === "stage") return "ステージ選択";
    if (this.step === "p2") return "PLAYER 2  キャラクター選択";
    return this.mode === "2p" ? "PLAYER 1  キャラクター選択" : "キャラクター選択";
  }

  _showCharacters() {
    this.title.setText(this._label());
    this.cardLayer.removeAll(true);
    const startX = GAME_W / 2 - (CHARACTERS.length - 1) * 110;
    CHARACTERS.forEach((ch, i) => {
      this._charCard(startX + i * 220, 270, ch, i);
    });
  }

  _charCard(x, y, ch, idx) {
    const w = 196, h = 280;
    const col = ch.colors.body;
    const box = this.add.rectangle(x, y, w, h, 0x1a2030, 0.95)
      .setStrokeStyle(3, col, 1).setInteractive({ useHandCursor: true });

    // アバター（簡易ファイター描画）
    const g = this.add.graphics();
    this._drawAvatar(g, ch, x, y - 40);

    const name = this.add.text(x, y + 56, ch.name, {
      fontFamily: "sans-serif", fontSize: "18px", color: "#ffffff", align: "center",
      wordWrap: { width: w - 16 },
    }).setOrigin(0.5);
    const title = this.add.text(x, y + 86, ch.title, {
      fontFamily: "sans-serif", fontSize: "12px", color: "#9ec7e8",
    }).setOrigin(0.5);

    // ステータスバー
    const stat = (sy, label, val, max, color) => {
      this.add.text(x - w / 2 + 14, sy, label, { fontSize: "11px", color: "#cdd6e0" });
      this.add.rectangle(x - w / 2 + 56, sy + 6, 110, 8, 0x000000, 0.5).setOrigin(0, 0.5);
      this.add.rectangle(x - w / 2 + 56, sy + 6, 110 * (val / max), 8, color, 1).setOrigin(0, 0.5);
    };
    stat(y + 104, "体力", ch.maxHp, 130, 0x55cc66);
    stat(y + 120, "速さ", ch.speed, 330, 0x55aaee);
    stat(y + 136, "力 ", ch.power, 1.4, 0xee6655);

    box.on("pointerover", () => box.setScale(1.04));
    box.on("pointerout", () => box.setScale(1.0));
    box.on("pointerdown", () => this._choose(idx));

    this.cardLayer.add([box, g, name, title]);
    box._desc = ch.desc;
  }

  _drawAvatar(g, ch, x, y) {
    const c = ch.colors;
    // 胴
    g.fillStyle(c.body, 1); g.fillRoundedRect(x - 18, y - 6, 36, 50, 8);
    g.fillStyle(c.accent, 1); g.fillRect(x - 18, y + 30, 36, 8);
    // 腕
    g.lineStyle(10, c.body, 1);
    g.lineBetween(x - 16, y, x - 26, y + 26);
    g.lineBetween(x + 16, y, x + 26, y + 26);
    // 脚
    g.lineBetween(x - 8, y + 44, x - 12, y + 74);
    g.lineBetween(x + 8, y + 44, x + 12, y + 74);
    // 頭
    g.fillStyle(c.skin, 1); g.fillCircle(x, y - 26, 18);
    if (!ch.faceless) {
      g.fillStyle(c.hair, 1); g.fillRoundedRect(x - 18, y - 44, 36, 14, 6);
      g.fillStyle(0x222, 1); g.fillCircle(x - 6, y - 24, 2.6); g.fillCircle(x + 6, y - 24, 2.6);
    } else {
      g.fillStyle(c.trim, 1); g.fillCircle(x, y - 24, 5);
    }
    // 頭装備（簡易）
    if (ch.headgear === "hachimaki") { g.fillStyle(0xffffff, 1); g.fillRect(x - 19, y - 32, 38, 6); }
    if (ch.headgear === "horns") {
      g.fillStyle(0xeae0cf, 1);
      g.fillTriangle(x - 16, y - 34, x - 30, y - 50, x - 8, y - 40);
      g.fillTriangle(x + 16, y - 34, x + 30, y - 50, x + 8, y - 40);
    }
    if (ch.headgear === "tenugui") { g.fillStyle(c.trim, 1); g.fillRoundedRect(x - 19, y - 44, 38, 16, 6); }
    if (ch.faceless) { g.fillStyle(c.trim, 1); g.fillRoundedRect(x - 18, y - 46, 36, 12, 6); }
  }

  _choose(idx) {
    const ch = CHARACTERS[idx];
    if (!ch) return;

    if (this.step === "p1") {
      this.pick.p1 = ch.key;
      if (this.mode === "2p") { this.step = "p2"; this._showCharacters(); }
      else { this.pick.p2 = CHARACTERS[Phaser.Math.Between(0, CHARACTERS.length - 1)].key; this.step = "stage"; this._showStages(); }
    } else if (this.step === "p2") {
      this.pick.p2 = ch.key;
      this.step = "stage"; this._showStages();
    }
  }

  _showStages() {
    this.title.setText("ステージ選択");
    this.hint.setText("対戦ステージをクリック / 1〜4キー");
    this.cardLayer.removeAll(true);
    const startX = GAME_W / 2 - (STAGES.length - 1) * 115;
    STAGES.forEach((st, i) => {
      const x = startX + i * 230, y = 260, w = 210, h = 150;
      // サムネイル（縮小ステージ）
      const rt = this.add.renderTexture(x - w / 2, y - h / 2, w, h);
      const tmp = drawStage(this, st.key);
      tmp.setScale(w / GAME_W, h / GAME_H);
      rt.draw(tmp, 0, 0);
      tmp.destroy();
      rt.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
      rt.setOrigin(0);

      const frame = this.add.rectangle(x, y, w, h, 0xffffff, 0)
        .setStrokeStyle(3, 0xffffff, 0.8).setInteractive({ useHandCursor: true });
      this.add.text(x, y + h / 2 + 18, st.name, {
        fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff",
      }).setOrigin(0.5);

      const start = () => this._startMatch(st.key);
      frame.on("pointerover", () => frame.setStrokeStyle(4, 0xf4d03f, 1));
      frame.on("pointerout", () => frame.setStrokeStyle(3, 0xffffff, 0.8));
      frame.on("pointerdown", start);
      rt.on("pointerdown", start);
      this.cardLayer.add([rt, frame]);
    });

    // キー選択
    this.input.keyboard.removeAllListeners("keydown");
    this.input.keyboard.on("keydown", (e) => {
      const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };
      if (e.code in map && STAGES[map[e.code]]) this._startMatch(STAGES[map[e.code]].key);
      if (e.code === "Escape") this.scene.start("ModeScene");
    });
  }

  _startMatch(stageKey) {
    this.scene.start("FightScene", {
      mode: this.mode,
      p1: this.pick.p1,
      p2: this.pick.p2,
      stage: stageKey,
    });
  }
}
