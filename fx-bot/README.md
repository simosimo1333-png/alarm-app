# fx-bot — OANDA API 移動平均クロス自動売買ボット

OANDA証券の公式REST APIを使った、個人利用向けのFX自動売買ボットです(Node.js / TypeScript)。

## ⚠️ 必ず最初に読んでください

- **このボットは利益を保証しません。** 移動平均クロスは定番の戦略ですが、相場環境によっては損失が続きます。**失っても生活に影響しない資金**でのみ運用してください。
- **Playwrightによるブラウザ自動操作は採用していません。** FX業者のWeb取引画面の自動操作を規約で認めている業者は確認できず、多くの業者で禁止行為(口座凍結の対象)にあたります。一方、[OANDA証券はAPIによる自動売買を公式に提供](https://www.oanda.jp/fxproduct/api)しており、これが規約上認められた自動売買の方法です。
- **OANDAの本番口座でAPIトークンを発行するには条件があります**(口座残高など)。最新の条件は[公式の解説ページ](https://www.oanda.jp/lab-education/api/usage/rest_api_activation_procedure/)で確認してください。デモ口座(fxTrade Practice)でもAPIを利用できます。
- API取引はOANDAのカスタマーサポート対象外です。

## 仕組み

1. 指定した時間枠(デフォルト15分足)の確定足を定期取得
2. 短期SMA(10)と長期SMA(30)のクロスを判定
   - ゴールデンクロス → 買い(売りポジションがあればドテン決済)
   - デッドクロス → 売り(買いポジションがあればドテン決済)
3. 発注時に**損切り(SL)と利確(TP)を必ず同時設定**
4. 注文数量は「1回の損失 ≒ 残高×RISK_PERCENT%」になるよう自動計算(MAX_UNITSが上限)
5. 1日の損失がDAILY_LOSS_LIMIT_PERCENT%を超えたら、その日は新規取引を自動停止

## セットアップ

```bash
cd fx-bot
npm install
cp .env.example .env
# .env を編集して OANDA_API_TOKEN と OANDA_ACCOUNT_ID を設定
```

OANDAのAPIトークンは、OANDAのマイページ(お客様サイト)の「API」メニューから発行できます。

## 使い方

### 1. まずバックテストで戦略を確認

```bash
npm run backtest
```

過去約4000本のローソク足で戦略の成績(勝率・損益pips・最大ドローダウン)を確認できます。
**ここでマイナスの戦略設定のまま実資金を投入しないでください。**

### 2. DRY_RUNで動作確認

`.env` で `DRY_RUN=true`(デフォルト)のまま起動すると、発注せずログだけ出力します。

```bash
npm run trade
```

### 3. デモ口座で実発注テスト

`.env` で `OANDA_ENV=practice`、`DRY_RUN=false` にして数日動かし、想定どおり発注・決済されるか確認します。

### 4. 本番運用

`.env` で `OANDA_ENV=live`、`DRY_RUN=false` に変更します。
**最初は MAX_UNITS を小さく(例: 1000通貨)** して始めることを強く推奨します。

```bash
npm run trade        # 起動(Ctrl+Cで停止)
npm run status       # 残高・ポジションの確認
```

常時稼働させる場合はVPSなどで `pm2` や `systemd` を使って動かしてください。
ボットを停止しても、**発注済みのSL/TP注文はOANDA側で有効なまま**なので、ポジションが無限に放置されることはありません。

## 設定項目

| 環境変数 | 既定値 | 説明 |
|---|---|---|
| `OANDA_ENV` | practice | practice(デモ) / live(本番・実資金) |
| `INSTRUMENT` | USD_JPY | 通貨ペア |
| `GRANULARITY` | M15 | 足の時間枠 (M5/M15/M30/H1/H4/D) |
| `FAST_MA` / `SLOW_MA` | 10 / 30 | 移動平均の期間 |
| `RISK_PERCENT` | 0.5 | 1取引あたりの許容損失(残高比%) |
| `STOP_LOSS_PIPS` / `TAKE_PROFIT_PIPS` | 20 / 40 | 損切り・利確幅 |
| `MAX_UNITS` | 10000 | 注文数量の上限(通貨単位) |
| `DAILY_LOSS_LIMIT_PERCENT` | 2 | 日次損失の上限(超えたら当日停止) |
| `DRY_RUN` | true | true=発注しない(ログのみ) |

## 免責

本ソフトウェアは現状有姿で提供され、その利用により生じたいかなる損失についても作成者は責任を負いません。投資判断は自己責任で行ってください。
