/* モード選択（1人プレイ / 2人対戦） */
class ModeScene extends Phaser.Scene {
  constructor() { super("ModeScene"); }

  create() {
    drawStage(this, "sanmachi");
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0d14, 0.45);

    this.add.text(GAME_W / 2, 80, "モード選択", {
      fontFamily: "serif", fontSize: "46px", color: "#ffffff",
      stroke: "#b5302a", strokeThickness: 6,
    }).setOrigin(0.5);

    this._card(GAME_W / 2 - 200, 300, "1人プレイ", "vs CPU", 0xb5302a, () => {
      this.scene.start("SelectScene", { mode: "1p" });
    });
    this._card(GAME_W / 2 + 200, 300, "2人対戦", "ローカル対戦", 0x214a73, () => {
      this.scene.start("SelectScene", { mode: "2p" });
    });

    this.add.text(GAME_W / 2, 500, "クリックで選択", {
      fontFamily: "sans-serif", fontSize: "16px", color: "#cdd6e0",
    }).setOrigin(0.5);

    this.add.text(20, GAME_H - 26, "戻る: Esc", { fontSize: "14px", color: "#aab" });
    this.input.keyboard.once("keydown-ESC", () => this.scene.start("TitleScene"));
    this.input.keyboard.once("keydown-ONE", () => this.scene.start("SelectScene", { mode: "1p" }));
    this.input.keyboard.once("keydown-TWO", () => this.scene.start("SelectScene", { mode: "2p" }));
  }

  _card(x, y, title, sub, color, onClick) {
    const w = 280, h = 200;
    const box = this.add.rectangle(x, y, w, h, color, 0.92)
      .setStrokeStyle(4, 0xffffff, 0.85).setInteractive({ useHandCursor: true });
    this.add.text(x, y - 30, title, {
      fontFamily: "serif", fontSize: "40px", color: "#ffffff",
    }).setOrigin(0.5);
    this.add.text(x, y + 36, sub, {
      fontFamily: "sans-serif", fontSize: "20px", color: "#ffe9b0",
    }).setOrigin(0.5);
    box.on("pointerover", () => box.setScale(1.05));
    box.on("pointerout", () => box.setScale(1.0));
    box.on("pointerdown", onClick);
  }
}
