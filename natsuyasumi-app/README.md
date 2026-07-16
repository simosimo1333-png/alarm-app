# 夏休み調整アプリ(natsuyasumi-app)

夏季休暇の希望をカレンダーで共有・調整するための業務改善アプリです。
ゲーム集とは別の独立プロジェクトとして公開します。

- 要件・設計: `../docs/summer-vacation-scheduler/` を参照
- 画面: `index.html`(カレンダー/入力)・`admin.html`(管理)
- API: `api/*.js`(Vercel Functions)
- データ: Neon(Postgres)。Vercel の Storage 連携で接続

## 主な仕様

- 2つの課(課A/課B)、各課に課長・係長・係員。組織は将来「部＞課＞係」に拡張可能なデータ構造
- 休み希望は ◎(絶対)/○(できれば)/△(候補)の3段階。候補は上限を超えて出せる
- 「確定」は1人あたり上限(既定3日)まで。残り日数はこの確定分で自動計算
- 警告(カレンダーに ⚠️ 表示):
  - 同じ課で課長と係長が同じ日に休み
  - 同じ課で係員が全員休み希望(在席0人)
- 本人以外は編集不可。各メンバーの4桁PINで本人確認。管理操作は管理用PINで保護

## セットアップ手順(初回のみ)

1. **Vercel で新規プロジェクトを作成**し、このGitリポジトリをImport
   - **Root Directory** を `natsuyasumi-app` に設定(ゲームとは別プロジェクトになる)
   - Framework Preset は「Other」でよい(ビルド不要)
2. 作成後、プロジェクトの **Storage** タブ → **Create Database** → **Neon (Postgres)** を接続
   - 接続すると `DATABASE_URL` などの環境変数が自動で設定される
   - 反映のため一度 **Redeploy** する
3. デプロイ先URLの **`/admin`** を開く → **初期セットアップ**で管理用PIN(4桁)を決めて実行
   - テーブル作成と「課A・課B」の登録が自動で行われる
4. 管理画面でメンバー(名前・課・役職・PIN)を登録
5. 各メンバーにURLと自分のPINを共有 → カレンダー画面で希望を入力

## ローカル確認(任意)

Vercel CLI があれば、Neon の接続文字列を環境変数に入れて動作確認できます。

```bash
cd natsuyasumi-app
npm install
DATABASE_URL="postgres://..." vercel dev
```

## データ構成(テーブル)

| テーブル | 役割 |
|----------|------|
| organizations | 組織(課)。parent_id で将来の階層化に対応 |
| members | メンバー(課・役職・PINハッシュ) |
| leave_requests | 休み希望(メンバー×日付で1件、状態=◎/○/△/確定) |
| events | 業務予定(課別または全体) |
| settings | 対象期間・上限日数・管理用PINハッシュ |
