/* 勝敗結果 */
class ResultScene extends Phaser.Scene {
  constructor() { super("ResultScene"); }

  init(data) { this.data_ = data; }

  create() {
    const d = this.data_;
    drawStage(this, d.stage);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.55);

    const isLose = d.mode === "1p" && d.winnerSide === 1;
    this.add.text(GAME_W / 2, 110, isLose ? "GAME OVER" : "WINNER!", {
      fontFamily: "serif", fontSize: "80px",
      color: isLose ? "#9aa6b2" : "#f4d03f",
      stroke: "#5a2410", strokeThickness: 8,
    }).setOrigin(0.5).setShadow(3, 5, "#000", 8);

    // 勝者アバター
    const ch = CHARACTERS.find((c) => c.key === d.winnerKey);
    const g = this.add.graphics();
    this._bigAvatar(g, ch, GAME_W / 2, 250);

    this.add.text(GAME_W / 2, 340, ch.name, {
      fontFamily: "serif", fontSize: "36px", color: "#ffffff",
    }).setOrigin(0.5);
    this.add.text(GAME_W / 2, 380, `${d.mode === "2p" ? (d.winnerSide === 0 ? "1P" : "2P") + " の勝利" : (isLose ? "またの挑戦を待つ" : "飛騨の頂点に立った！")}   ［ ${d.score} ］`, {
      fontFamily: "sans-serif", fontSize: "18px", color: "#cdd6e0",
    }).setOrigin(0.5);

    const btn = (x, label, color, cb) => {
      const b = this.add.rectangle(x, 450, 220, 56, color, 0.95)
        .setStrokeStyle(3, 0xffffff, 0.8).setInteractive({ useHandCursor: true });
      this.add.text(x, 450, label, { fontFamily: "sans-serif", fontSize: "22px", color: "#fff" }).setOrigin(0.5);
      b.on("pointerover", () => b.setScale(1.05));
      b.on("pointerout", () => b.setScale(1));
      b.on("pointerdown", cb);
    };
    btn(GAME_W / 2 - 130, "もう一度", 0xb5302a, () => this.scene.start("SelectScene", { mode: d.mode }));
    btn(GAME_W / 2 + 130, "タイトルへ", 0x214a73, () => this.scene.start("TitleScene"));

    this.input.keyboard.once("keydown-ENTER", () => this.scene.start("SelectScene", { mode: d.mode }));
    this.input.keyboard.once("keydown-ESC", () => this.scene.start("TitleScene"));

    // 紙吹雪
    if (!isLose) this._confetti();
  }

  _bigAvatar(g, ch, x, y) {
    const c = ch.colors, s = 1.7;
    g.fillStyle(c.body, 1); g.fillRoundedRect(x - 18 * s, y - 6 * s, 36 * s, 50 * s, 10);
    g.fillStyle(c.accent, 1); g.fillRect(x - 18 * s, y + 28 * s, 36 * s, 8 * s);
    g.lineStyle(16, c.body, 1);
    g.lineBetween(x - 26, y - 6, x - 44, y + 40);
    g.lineBetween(x + 26, y - 6, x + 44, y + 40);
    g.lineBetween(x - 14, y + 80, x - 20, y + 130);
    g.lineBetween(x + 14, y + 80, x + 20, y + 130);
    g.fillStyle(c.skin, 1); g.fillCircle(x, y - 46, 30);
    if (!ch.faceless) {
      g.fillStyle(c.hair, 1); g.fillRoundedRect(x - 30, y - 76, 60, 22, 8);
      g.fillStyle(0x222, 1); g.fillCircle(x - 10, y - 42, 4); g.fillCircle(x + 10, y - 42, 4);
      // 笑み
      g.lineStyle(3, 0x222, 1); g.beginPath(); g.arc(x, y - 34, 9, 0.15 * Math.PI, 0.85 * Math.PI); g.strokePath();
    } else {
      g.fillStyle(c.trim, 1); g.fillCircle(x + 2, y - 42, 8);
    }
    if (ch.headgear === "horns") {
      g.fillStyle(0xeae0cf, 1);
      g.fillTriangle(x - 26, y - 58, x - 48, y - 86, x - 12, y - 68);
      g.fillTriangle(x + 26, y - 58, x + 48, y - 86, x + 12, y - 68);
    }
    if (ch.headgear === "hachimaki") { g.fillStyle(0xffffff, 1); g.fillRect(x - 32, y - 56, 64, 9); }
    if (ch.headgear === "tenugui") { g.fillStyle(c.trim, 1); g.fillRoundedRect(x - 32, y - 78, 64, 26, 8); }
    if (ch.faceless) { g.fillStyle(c.trim, 1); g.fillRoundedRect(x - 30, y - 80, 60, 20, 8); }
  }

  _confetti() {
    const colors = [0xf4d03f, 0xe23b30, 0x214a73, 0xffffff, 0x39d353];
    for (let i = 0; i < 60; i++) {
      const r = this.add.rectangle(
        Phaser.Math.Between(0, GAME_W), Phaser.Math.Between(-200, 0),
        8, 12, colors[i % colors.length]
      ).setAngle(Phaser.Math.Between(0, 360));
      this.tweens.add({
        targets: r, y: GAME_H + 40, angle: r.angle + 360,
        duration: Phaser.Math.Between(2200, 4200), delay: Phaser.Math.Between(0, 1500),
        repeat: -1,
      });
    }
  }
}
