/* タイトル画面 */
class TitleScene extends Phaser.Scene {
  constructor() { super("TitleScene"); }

  create() {
    drawStage(this, "festival");
    // 暗幕
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.35);

    this.add.text(GAME_W / 2, 150, "飛騨高山", {
      fontFamily: "serif", fontSize: "92px", color: "#ffffff",
      stroke: "#b5302a", strokeThickness: 10,
    }).setOrigin(0.5).setShadow(4, 6, "#000000", 8);

    this.add.text(GAME_W / 2, 232, "ファイター", {
      fontFamily: "serif", fontSize: "60px", color: "#f4d03f",
      stroke: "#5a2410", strokeThickness: 8,
    }).setOrigin(0.5).setShadow(3, 4, "#000000", 6);

    this.add.text(GAME_W / 2, 300, "HIDA TAKAYAMA FIGHTER", {
      fontFamily: "sans-serif", fontSize: "18px", color: "#cdd6e0", letterSpacing: 6,
    }).setOrigin(0.5);

    const prompt = this.add.text(GAME_W / 2, 410, "▶ クリック / Enter でスタート", {
      fontFamily: "sans-serif", fontSize: "26px", color: "#ffffff",
    }).setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });

    this.add.text(GAME_W / 2, 500, "古い町並み・高山祭・酒蔵・飛騨牛 … 飛騨の世界で殴り合え", {
      fontFamily: "sans-serif", fontSize: "15px", color: "#9aa6b2",
    }).setOrigin(0.5);

    const go = () => this.scene.start("ModeScene");
    this.input.once("pointerdown", go);
    this.input.keyboard.once("keydown-ENTER", go);
    this.input.keyboard.once("keydown-SPACE", go);
  }
}
