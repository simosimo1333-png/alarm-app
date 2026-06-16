/* =========================================================
 * 飛騨高山ファイター - エントリポイント
 * ========================================================= */
const config = {
  type: Phaser.AUTO,
  parent: "game-container",
  width: GAME_W,
  height: GAME_H,
  backgroundColor: "#11131a",
  pixelArt: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: { antialias: true },
  scene: [TitleScene, ModeScene, SelectScene, FightScene, ResultScene],
};

// eslint-disable-next-line no-unused-vars
const game = new Phaser.Game(config);
