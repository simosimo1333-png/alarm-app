# GMOコイン 外国為替FX 自動売買ボット（個人利用）

GMOコイン 外国為替FX API を使った、Python 製の自動売買ボットです。
**最初は安全のため `DRY_RUN=true`（注文を送信せず判断とログ出力のみ）で動作します。**
実発注は `DRY_RUN=false` のときだけ行われます。

> ⚠️ **免責**: 本ソフトウェアは個人利用・学習目的のサンプルです。FX 取引には元本を
> 上回る損失リスクがあります。実弾運用は完全に自己責任で行い、必ず `DRY_RUN` で
> 十分に検証してから移行してください。エンドポイントやパラメータは
> [GMOコイン外国為替FX API 仕様](https://api.coin.z.com/fxdocs/) で最新の内容を必ず確認してください。

---

## 1. ディレクトリ構成

```
fx_bot/
├── main.py             # エントリーポイント / メインループ
├── config.py           # 環境変数・設定の一元管理
├── broker_gmo_fx.py    # GMO FX API クライアント（Public/Private/WebSocket）
├── strategy.py         # 指標計算（MA/RSI/変化率）とシグナル判定
├── risk_manager.py     # リスク管理・損切り利確・自動停止
├── notifier.py         # LINE / メール通知
├── logger.py           # ログ基盤（コンソール＋日次ローテーション）
├── data_store.py       # ティックのCSV保存と足（1分/5分）生成
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

実行時に `data/`（CSV）と `logs/`（ログ）が自動生成されます。

## 2. 処理フロー

`POLL_INTERVAL_SEC`（既定 60 秒）ごとに以下を繰り返します。

1. **停止チェック** … `stop.txt` の存在、停止フラグを確認。あれば即停止。
2. **価格取得** … Public API（または WebSocket）で ticker を取得し CSV 保存、1分足/5分足を更新。
3. **決済判定** … 建玉があれば利確/損切り（pips）を判定し、条件成立で決済。
4. **シグナル判定** … MA クロス・RSI・スプレッドから BUY/SELL/NONE を決定。
5. **新規エントリー** … リスクチェック通過時のみ発注。
   - `DRY_RUN=true`: 注文予定をログ出力のみ（送信しない）。
   - `DRY_RUN=false`: 発注前に建玉/証拠金維持率/有効注文を確認 → Private API で発注。
6. **異常時** … API/通信/想定外レスポンスを検知したら通知して安全停止。

## 3. 必要な環境変数

| 変数 | 説明 | 既定 |
|------|------|------|
| `GMO_API_KEY` / `GMO_API_SECRET` | API 認証情報（本番時必須） | （空） |
| `DRY_RUN` | `true` で注文せず判断のみ | `true` |
| `USE_WEBSOCKET` | `true` で WS リアルタイム購読 | `false` |
| `SYMBOL` | 通貨ペア | `USD_JPY` |
| `POLL_INTERVAL_SEC` | 価格取得間隔（秒） | `60` |
| `MA_SHORT` / `MA_LONG` | 短期/長期移動平均の本数 | `5` / `20` |
| `RSI_PERIOD` / `RSI_UPPER` / `RSI_LOWER` | RSI 設定 | `14` / `70` / `30` |
| `ORDER_SIZE` / `MAX_ORDER_SIZE` | 注文数量 / 1回上限 | `10000` |
| `PIP_VALUE` | 1pip の価格幅（USD_JPY=0.01） | `0.01` |
| `TAKE_PROFIT_PIPS` / `STOP_LOSS_PIPS` | 利確 / 損切り pips | `10` / `7` |
| `MAX_DAILY_LOSS_JPY` | 1日の最大損失額（超過で停止） | `5000` |
| `MAX_SPREAD_PIPS` | 許容スプレッド上限 | `0.5` |
| `MIN_MARGIN_RATIO` | 証拠金維持率の下限(%) | `200` |
| `NEWS_WINDOWS` | 経済指標 回避時間帯 `HH:MM-HH:MM,...` | （空） |
| `TZ_NAME` | タイムゾーン | `Asia/Tokyo` |
| `NOTIFY_CHANNEL` | `none`/`line`/`email` | `none` |
| `LINE_NOTIFY_TOKEN` | LINE Notify トークン | （空） |
| `SMTP_*` / `MAIL_*` | メール通知設定 | （空） |
| `DATA_DIR` / `LOG_DIR` / `STOP_FILE` | 各種パス | `data`/`logs`/`stop.txt` |

詳細は `.env.example` を参照してください。

## 4. DRY_RUN 設計

- 既定は `DRY_RUN=true`。**この間は Private API（発注系）を一切呼び出しません。**
- BUY/SELL の判断・注文予定内容・決済判定はすべて実行され、ログと通知に出力されます。
- 検証性を高めるため、DRY_RUN でも「内部的に建玉を持った」とみなして利確/損切りロジックを
  シミュレーションします（実口座には影響しません）。
- `DRY_RUN=false` に切り替えるには、API キー/シークレットが設定されている必要があり、
  起動時に `config.validate()` でチェックされます。

## 5. リスク管理設計（`risk_manager.py`）

| 安全装置 | 内容 |
|----------|------|
| 注文数量上限 | `MAX_ORDER_SIZE` で 1 回の発注量を制限（`clamp_size`） |
| 日次損失上限 | 確定損益を集計し `MAX_DAILY_LOSS_JPY` 超過で自動停止 |
| 連続エントリー禁止 | 直前と同方向の新規を禁止（`consecutive_same_direction`） |
| スプレッド制限 | `MAX_SPREAD_PIPS` 超過時は取引しない |
| 経済指標 回避 | `NEWS_WINDOWS` の時間帯は新規を行わない |
| 証拠金維持率 | 本番発注前に `MIN_MARGIN_RATIO` を下回らないか確認 |
| 損切り/利確 | `STOP_LOSS_PIPS` / `TAKE_PROFIT_PIPS` で必ず決済条件を設定 |
| 発注前確認 | 本番時は建玉・有効注文・証拠金を実 API で再確認 |
| 異常時停止 | API/通信/想定外レスポンスで安全停止し通知 |
| 手動停止 | `stop.txt` を置くと次ループで即停止 |

## 6. 実装順序（このリポジトリの作成順）

1. `config.py` … 設定・環境変数
2. `logger.py` … ログ基盤
3. `data_store.py` … CSV 保存・足生成
4. `strategy.py` … 指標・シグナル
5. `broker_gmo_fx.py` … API クライアント
6. `notifier.py` … 通知
7. `risk_manager.py` … リスク管理
8. `main.py` … 全体統合・ループ

---

## セットアップ & 実行

```bash
cd fx_bot
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # 値を編集（まずは DRY_RUN=true のまま）

# 環境変数を読み込んで起動（dotenv を使う場合）
set -a && . ./.env && set +a
python main.py
```

### 停止方法

- `Ctrl+C`（SIGINT）/ SIGTERM … 次ループ後に安全終了。
- `touch stop.txt` … 次ループで即時停止。

### 本番運用へ移行する前のチェックリスト

- [ ] `DRY_RUN=true` で数日分のログを確認し、シグナルと損益感覚を把握した
- [ ] `broker_gmo_fx.py` のエンドポイント・パラメータを公式仕様と照合した
- [ ] `ORDER_SIZE` を最小単位にし、`MAX_DAILY_LOSS_JPY` を小さく設定した
- [ ] 通知（LINE/メール）が届くことを確認した
- [ ] 経済指標カレンダーを `NEWS_WINDOWS` に反映した
