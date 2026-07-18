# 検証スクリプト（Playwright / Chromium）

`fallflat.html`（ふにゃふにゃアスレチック）の動作検証に使った Playwright スクリプト集。
設計・API・落とし穴は `../docs/DESIGN.md` を参照。

## 実行環境

- Chromium はプリインストール済み: `executablePath: '/opt/pw-browsers/chromium'`（`playwright install` 不要）
- Playwright は作業ディレクトリで `npm i playwright` してから `node tests/xxx.mjs`
- 事前にローカルサーバを起動:
  ```bash
  python3 -m http.server 8899 --directory /home/user/alarm-app
  ```
  スクリプトは `http://127.0.0.1:8899/fallflat.html`（マルチは `?local=1`）を開く前提。

## ⚠ 重要: `window.__dbg` フックについて

多くのスクリプトは、ゲームに一時的に仕込んでいた**デバッグフック `window.__dbg`**（`tp(x,y,z)`でテレポート、剛体の位置/角度を read 等）を前提にしている。**このフックは本番コードから削除済み**。再検証するときは:

1. `fallflat.js` のメインループ（`animate`）末尾あたりに一時的に復活させる。最低限の例:
   ```js
   window.__dbg = {
     tp: (x, y, z) => { const d = dolls.get(myId); if (d) { d.torso.position.set(x, y, z); d.torso.velocity.setZero(); } },
     doll: () => { const d = dolls.get(myId); return d && { x: d.torso.position.x, y: d.torso.position.y, z: d.torso.position.z, cp: d.cp, goal: d.goal }; },
     obj: (i) => { const o = dynObjects[i]; return o && o.body && { x: o.body.position.x, y: o.body.position.y, z: o.body.position.z }; },
     hinge: (i) => hingeAngle(i),
     dolls, dynObjects, GIM,
   };
   ```
   （過去の完全版は git 履歴の「デバッグフック削除」コミットの1つ前を参照）
2. 検証が終わったら**必ず削除してからコミット**する。

フックなしでも、UI操作（キーボード/タッチ/ポインタ合成）＋スクリーンショット＋`page.evaluate` での DOM/コンソール観測だけで多くは検証できる。

## スクリプト一覧

| ファイル | 目的 |
|---|---|
| `qa.mjs` | 基本スモーク（起動・ソロ開始・移動・エラー収集） |
| `final-smoke.mjs` | フック削除後の3コース起動＋マルチのスモーク |
| `box-c1-gim.mjs` | コース1の全ギミック（ドア・ボタン・床スイッチ・的当て・シーソー・つり橋・きのこ・ターザン・CP両ルート・ゴール） |
| `box-c2.mjs` | コース2の全ギミック・両ルート通し・CP・ゴール・俯瞰 |
| `box-c3.mjs` | コース3のCP通し（ルートA）＋ルートBゾーン＋ゴール＋接地スポット |
| `gim-c3.mjs` | コース3の個別ギミック（くさり・カタパルト・跳ね橋1/2・柱とび・ターザン・すいどうばし・つり橋・落とし格子・寄り道） |
| `box-climb.mjs` | よじ登り必須9点×「ジャンプ不可＋掴んで登れる」両判定 |
| `climb9.mjs` | 9点の登坂＋所要時間＋テレポート/壁侵入検査 |
| `climbstates.mjs` | よじ登りの3状態（掴む静止／前進で上昇／中断で停止）＝入力駆動の確認 |
| `regrab2.mjs` | 1登坂あたりの掴み直し回数（＝1回のはず）の計測 |
| `handswap.mjs` | 意図的な手の掛け替え（片手離し→上を掴む）の成立確認 |
| `grabplayer.mjs` | 他プレイヤーの胴体を掴めるか |
| `lr-test.mjs` | つかみボタンの左右対応（画面左の手＝左ボタン） |
| `mtoggle.mjs` | モバイルのつかみトグル（オン/オフ・りょうて・ハイライト・脱力/リスポーンで解除） |
| `v-mp.mjs` | `?local=1` ホスト/ゲストの動的オブジェクト位置同期 |
| `v-mp-c3.mjs` | コース3のゲスト構築一致（剛体数）＋跳ね橋の開閉同期 |

## 検証チェックリスト

`../docs/DESIGN.md` §9 を参照。コース変更後は最初から最後まで通すこと。
